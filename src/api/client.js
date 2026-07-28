// HTTP plumbing for the Django backend.
//
// Everything the app sends goes through `request`, which adds the access token,
// unwraps the `{ detail, code, fields }` error envelope the server always
// returns, and transparently refreshes an expired token.
//
// Token refresh is deliberately funnelled through a single in-flight promise.
// The app fires several requests at once on page load; without that, each 401
// would start its own refresh, and because the server rotates refresh tokens the
// second one to arrive would be rejected and log the user out.

const BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

const TOKEN_KEY = 'swms.tokens'

export class ApiError extends Error {
  constructor({ status, code, detail, fields }) {
    super(detail || 'Request failed')
    this.name = 'ApiError'
    this.status = status
    // A stable key the UI can translate, e.g. 'wrong_pin' or 'token_invalid'.
    this.code = code || 'error'
    this.detail = detail
    // { fieldName: [message, ...] } for form-level errors.
    this.fields = fields || {}
  }

  get isAuth() {
    return this.status === 401 || this.status === 403
  }

  get isOffline() {
    return this.status === 0
  }

  // The first message for a field, for inline form errors.
  fieldError(name) {
    const messages = this.fields[name]
    return Array.isArray(messages) ? messages[0] : messages
  }
}

// --- token store ----------------------------------------------------------

export function readTokens() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null')
    return parsed && parsed.access ? parsed : null
  } catch { return null }
}

export function writeTokens(tokens) {
  try {
    if (tokens?.access) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens))
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* private mode — the session just won't survive a reload */ }
  return tokens
}

export function clearTokens() { writeTokens(null) }

export const accessToken = () => readTokens()?.access || null

// Called when refresh fails, so AuthProvider can drop the session without every
// caller having to handle it.
let onSessionExpired = () => {}
export function setSessionExpiredHandler(fn) { onSessionExpired = fn || (() => {}) }

// --- refresh --------------------------------------------------------------

let refreshing = null

async function refreshAccessToken() {
  if (refreshing) return refreshing
  const refresh = readTokens()?.refresh
  if (!refresh) return null

  refreshing = (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
      if (!response.ok) throw new Error('refresh rejected')
      const data = await response.json()
      // The server rotates the refresh token, so store whatever came back.
      return writeTokens({ access: data.access, refresh: data.refresh || refresh })
    } catch {
      clearTokens()
      onSessionExpired()
      return null
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

// --- request --------------------------------------------------------------

function buildUrl(path, params) {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!params) return url
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item))
    else query.append(key, value)
  })
  const qs = query.toString()
  return qs ? `${url}?${qs}` : url
}

async function parseError(response) {
  let body = null
  try { body = await response.json() } catch { /* HTML error page or empty body */ }
  return new ApiError({
    status: response.status,
    code: body?.code,
    detail: body?.detail || response.statusText || 'Request failed',
    fields: body?.fields,
  })
}

export async function request(path, options = {}) {
  const { method = 'GET', body, params, signal, auth = true, retry = true } = options
  const isForm = body instanceof FormData
  const headers = { ...(options.headers || {}) }

  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = accessToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    // Status 0 lets the UI distinguish "backend unreachable" from "rejected".
    throw new ApiError({ status: 0, code: 'network', detail: 'Cannot reach the server.' })
  }

  // One retry after a refresh; `retry: false` on the second pass stops a loop.
  if (response.status === 401 && auth && retry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return request(path, { ...options, retry: false })
  }

  if (response.status === 204) return null
  if (!response.ok) throw await parseError(response)

  // A download always wants bytes. CSV arrives as `text/csv`, so without this
  // the content-type sniffing below would hand back a string and the caller
  // would have nothing to save.
  if (options.blob) return response.blob()

  const type = response.headers.get('Content-Type') || ''
  if (type.includes('application/json')) return response.json()
  if (type.startsWith('text/')) return response.text()
  return response.blob()
}

export const get = (path, params, options) => request(path, { ...options, params })
export const post = (path, body, options) => request(path, { ...options, method: 'POST', body })
export const patch = (path, body, options) => request(path, { ...options, method: 'PATCH', body })
export const put = (path, body, options) => request(path, { ...options, method: 'PUT', body })
export const del = (path, options) => request(path, { ...options, method: 'DELETE' })

// Collections the app holds entirely in memory ask for `page_size=all`, which
// the server answers with a bare array. Paginated responses are unwrapped to the
// same shape so callers never branch on it.
export async function list(path, params, options) {
  const data = await get(path, { page_size: 'all', ...params }, options)
  return Array.isArray(data) ? data : (data?.results ?? [])
}

// Trigger a browser download for a server-generated report. The filename comes
// from the server's Content-Disposition header, so `download=""` is deliberate —
// setting a name here would override a better one.
export async function download(path, params) {
  const { filename, ...query } = params || {}
  const blob = await request(path, { params: query, blob: true })
  if (!(blob instanceof Blob)) return false
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || ''
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}

// Absolute URL for a websocket, carrying the access token — browsers cannot set
// an Authorization header on a WebSocket handshake.
export function socketUrl(path = '/ws/live/') {
  const configured = import.meta.env.VITE_WS_URL
  const origin = configured || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
  const token = accessToken()
  return `${origin.replace(/\/$/, '')}${path}${token ? `?token=${encodeURIComponent(token)}` : ''}`
}
