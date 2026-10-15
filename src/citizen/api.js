// The citizen portal's API calls.
//
// A citizen token is kept apart from the staff session (its own storage key)
// and sent by hand, so the staff client's refresh logic never touches it and
// a citizen signing in can never disturb a staff login in the same browser.

import { request } from '../api/client.js'

const KEY = 'swms.citizen'

export function readCitizenToken() {
  try { return localStorage.getItem(KEY) || null } catch { return null }
}

export function writeCitizenToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch { /* private mode: the session will not survive a reload */ }
}

const call = (path, options = {}) => {
  const token = readCitizenToken()
  return request(`/citizen${path}`, {
    ...options,
    auth: false,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

export const citizenApi = {
  login: (phone, pin) => request('/citizen/login/', { method: 'POST', body: { phone, pin }, auth: false }),
  me: () => call('/me/'),
  changePin: (currentPin, pin) => call('/pin/', { method: 'PUT', body: { currentPin, pin } }),
  holding: (id) => call(`/holdings/${id}/`),
  complaints: (holding) => call('/complaints/', { params: { holding } }),
  complain: (body) => call('/complaints/', { method: 'POST', body }),
  reopen: (id) => call(`/complaints/${id}/reopen/`, { method: 'POST', body: {} }),
  photos: (id, files) => {
    const form = new FormData()
    files.forEach((file) => form.append('images', file))
    return call(`/complaints/${id}/photos/`, { method: 'POST', body: form })
  },
}
