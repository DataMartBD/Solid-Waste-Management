import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth, ROLE_HOME, validatePin, normalizePhone } from './AuthContext.jsx'

// The provider talks to the server through the API client, so that is what gets
// stubbed. The assertions are about the contract the pages depend on, not about
// the shape of any particular fetch.
vi.mock('../api/client.js', () => {
  const store = { tokens: null, expiredHandler: null }
  return {
    ApiError: class ApiError extends Error {
      constructor({ status, code, detail, fields }) {
        super(detail)
        this.status = status
        this.code = code
        this.detail = detail
        this.fields = fields || {}
      }
      fieldError(name) {
        const value = this.fields[name]
        return Array.isArray(value) ? value[0] : value
      }
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    request: vi.fn(),
    readTokens: vi.fn(() => store.tokens),
    writeTokens: vi.fn((tokens) => { store.tokens = tokens; return tokens }),
    clearTokens: vi.fn(() => { store.tokens = null }),
    setSessionExpiredHandler: vi.fn((fn) => { store.expiredHandler = fn }),
    __store: store,
  }
})

const client = await import('../api/client.js')

const USER = {
  id: 1,
  phone: '01711000042',
  name: 'Rafiqul Islam',
  role: 'Collector',
  roleKey: 'collector',
  scope: 'Ward 14',
  hasPin: true,
  home: '/app/collection',
  readOnly: false,
}

async function setupReady() {
  const hook = renderHook(() => useAuth(), { wrapper: AuthProvider })
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

beforeEach(() => {
  vi.clearAllMocks()
  client.__store.tokens = null
})

describe('validatePin', () => {
  it('rejects a PIN of the wrong length', () => {
    expect(validatePin('12')).toBe('tooShort')
    expect(validatePin('12345')).toBe('tooShort')
    expect(validatePin('')).toBe('tooShort')
  })

  it('rejects PINs that offer no protection', () => {
    expect(validatePin('1111')).toBe('tooSimple')
    expect(validatePin('1234')).toBe('tooSimple')
    expect(validatePin('4321')).toBe('tooSimple')
  })

  it('accepts a non-obvious PIN of the right length', () => {
    expect(validatePin('1470')).toBeNull()
    expect(validatePin('9182')).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('reduces every written form of a number to the same key', () => {
    expect(normalizePhone('+8801711-000042')).toBe('01711000042')
    expect(normalizePhone('8801711000042')).toBe('01711000042')
    expect(normalizePhone('01711000042')).toBe('01711000042')
  })
})

describe('ROLE_HOME', () => {
  it('sends a collector to their round and a viewer to reports', () => {
    expect(ROLE_HOME.Collector).toBe('/app/collection')
    expect(ROLE_HOME['KCC Viewer']).toBe('/app/reports')
  })
})

describe('session restore', () => {
  it('reports ready with no user when there are no tokens', async () => {
    const { result } = await setupReady()
    expect(result.current.user).toBeNull()
    expect(client.get).not.toHaveBeenCalled()
  })

  // Role and scope decide what the UI offers, so they are fetched on every load
  // rather than read from a cached copy the user could edit.
  it('fetches the user from the server when tokens exist', async () => {
    client.__store.tokens = { access: 'a', refresh: 'r' }
    client.get.mockResolvedValueOnce(USER)
    const { result } = await setupReady()
    expect(client.get).toHaveBeenCalledWith('/auth/me/')
    expect(result.current.user.name).toBe('Rafiqul Islam')
  })

  it('drops the session when the server rejects the stored token', async () => {
    client.__store.tokens = { access: 'stale', refresh: 'stale' }
    client.get.mockRejectedValueOnce(new client.ApiError({ status: 401, detail: 'expired' }))
    const { result } = await setupReady()
    expect(result.current.user).toBeNull()
    expect(client.clearTokens).toHaveBeenCalled()
  })
})

describe('OTP sign-in', () => {
  it('surfaces hasPin so the login screen can pick the PIN fast path', async () => {
    const { result } = await setupReady()
    client.post.mockResolvedValueOnce({
      phone: '01711000042', known: true, hasPin: true, ttl: 300,
      devCode: '4821', operator: { name: 'Rafiqul Islam', role: 'Collector' },
    })
    let response
    await act(async () => { response = await result.current.requestOtp('+8801711-000042') })
    expect(response.ok).toBe(true)
    expect(response.hasPin).toBe(true)
    expect(response.code).toBe('4821')
    expect(response.known.name).toBe('Rafiqul Islam')
  })

  // The session is held back so a first-time user can be offered a PIN before
  // the router leaves the login screen.
  it('stores tokens but does not publish the user until activate()', async () => {
    const { result } = await setupReady()
    client.post.mockResolvedValueOnce({ access: 'a', refresh: 'r', user: { ...USER, hasPin: false } })

    let response
    await act(async () => { response = await result.current.verifyOtp('01711000042', '4821') })
    expect(response.ok).toBe(true)
    expect(response.hasPin).toBe(false)
    expect(client.writeTokens).toHaveBeenCalledWith({ access: 'a', refresh: 'r' })
    expect(result.current.user).toBeNull()

    act(() => { result.current.activate(response.session) })
    expect(result.current.user.phone).toBe('01711000042')
  })

  it('returns a translatable key when the code is wrong', async () => {
    const { result } = await setupReady()
    client.post.mockRejectedValueOnce(new client.ApiError({
      status: 400,
      code: 'invalid',
      detail: 'Some fields need attention.',
      fields: { code: ['auth.wrongOtp'] },
    }))
    let response
    await act(async () => { response = await result.current.verifyOtp('01711000042', '0000') })
    expect(response).toEqual({ ok: false, error: 'auth.wrongOtp' })
    expect(result.current.user).toBeNull()
  })
})

describe('PIN sign-in', () => {
  it('publishes the session immediately — no PIN step is needed', async () => {
    const { result } = await setupReady()
    client.post.mockResolvedValueOnce({ access: 'a', refresh: 'r', user: USER })
    let response
    await act(async () => { response = await result.current.signInWithPin('01711000042', '1470') })
    expect(response.ok).toBe(true)
    expect(result.current.user.name).toBe('Rafiqul Islam')
  })

  it('flags a lockout so the screen can fall back to SMS', async () => {
    const { result } = await setupReady()
    client.post.mockRejectedValueOnce(new client.ApiError({
      status: 400, code: 'pin_locked', detail: 'auth.pinLocked',
    }))
    let response
    await act(async () => { response = await result.current.signInWithPin('01711000042', '1470') })
    expect(response).toMatchObject({ ok: false, locked: true, error: 'auth.pinLocked' })
    expect(result.current.user).toBeNull()
  })
})

describe('PIN management', () => {
  it('refuses a weak PIN without calling the server', async () => {
    const { result } = await setupReady()
    let response
    await act(async () => { response = await result.current.setPin('1234') })
    expect(response).toEqual({ ok: false, error: 'auth.tooSimple' })
    expect(client.post).not.toHaveBeenCalled()
  })

  it('marks the user as having a PIN once one is saved', async () => {
    client.__store.tokens = { access: 'a', refresh: 'r' }
    client.get.mockResolvedValueOnce({ ...USER, hasPin: false })
    const { result } = await setupReady()
    client.post.mockResolvedValueOnce({ hasPin: true })

    await act(async () => { await result.current.setPin('1470') })
    expect(result.current.user.hasPin).toBe(true)
  })

  it('reports a wrong current PIN against the profile key', async () => {
    const { result } = await setupReady()
    client.request.mockRejectedValueOnce(new client.ApiError({
      status: 400, code: 'wrong_pin', detail: 'auth.wrongPin',
    }))
    let response
    await act(async () => { response = await result.current.changePin('0000', '1470') })
    expect(response).toEqual({ ok: false, error: 'profile.wrongCurrentPin' })
  })
})

describe('profile', () => {
  it('replaces the user with the server copy so nothing drifts', async () => {
    client.__store.tokens = { access: 'a', refresh: 'r' }
    client.get.mockResolvedValueOnce(USER)
    const { result } = await setupReady()
    client.patch.mockResolvedValueOnce({ ...USER, email: 'rafiq@kcc.gov.bd', bloodGroup: 'B+' })

    await act(async () => { await result.current.updateProfile({ email: 'rafiq@kcc.gov.bd' }) })
    expect(result.current.user.email).toBe('rafiq@kcc.gov.bd')
    expect(result.current.user.name).toBe('Rafiqul Islam')
  })
})

describe('logout', () => {
  it('clears the session locally without waiting on the server', async () => {
    client.__store.tokens = { access: 'a', refresh: 'r' }
    client.get.mockResolvedValueOnce(USER)
    const { result } = await setupReady()
    client.post.mockResolvedValueOnce({ ok: true })

    await act(async () => { await result.current.logout() })
    expect(result.current.user).toBeNull()
    expect(client.clearTokens).toHaveBeenCalled()
  })
})

describe('role helpers', () => {
  it('exposes flags so pages do not compare role strings', async () => {
    client.__store.tokens = { access: 'a', refresh: 'r' }
    client.get.mockResolvedValueOnce({
      ...USER, roleKey: 'kcc_viewer', role: 'KCC Viewer', readOnly: true,
    })
    const { result } = await setupReady()
    expect(result.current.isAdmin).toBe(false)
    expect(result.current.isCollector).toBe(false)
    expect(result.current.canWrite).toBe(false)
  })
})
