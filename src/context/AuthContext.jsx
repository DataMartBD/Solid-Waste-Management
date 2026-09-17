import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import {
  ApiError, clearTokens, get, patch, post, readTokens, request,
  setSessionExpiredHandler, writeTokens,
} from '../api/client.js'

const AuthContext = createContext(null)

export const PIN_LENGTH = 4
export const MAX_PIN_ATTEMPTS = 5

// Landing route per role. The server also returns this as `user.home`; this map
// stays as the fallback so the router never has nowhere to go.
export const ROLE_HOME = {
  Collector: '/app/collection',
  Supervisor: '/app/dashboard',
  'Agency Admin': '/app/dashboard',
  'KCC Viewer': '/app/reports',
}

export const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '').replace(/^88/, '')

// Kept for the login form's inline validation so a bad PIN is caught before a
// round trip. The server applies the same rules and is the real gate — this is a
// convenience, not the check that matters.
export function validatePin(pin) {
  const digits = String(pin || '')
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(digits)) return 'tooShort'
  if (new Set(digits).size === 1) return 'tooSimple'
  const codes = [...digits].map(Number)
  const ascending = codes.every((d, i) => i === 0 || d === codes[i - 1] + 1)
  const descending = codes.every((d, i) => i === 0 || d === codes[i - 1] - 1)
  if (ascending || descending) return 'tooSimple'
  return null
}

// Map a server error code to the i18n key the auth dictionaries already carry.
const ERROR_KEYS = {
  wrong_pin: 'auth.wrongPin',
  pin_locked: 'auth.pinLocked',
  no_pin: 'auth.noPin',
  wrong_password: 'auth.wrongPassword',
  account_disabled: 'auth.accountDisabled',
  network: 'auth.offline',
}

function errorKey(error) {
  if (!(error instanceof ApiError)) return 'auth.unexpected'
  // Serializer-level failures already carry a translatable key as the message
  // (the server raises e.g. 'auth.wrongOtp'), so prefer that.
  const fieldMessage = error.fieldError('code') || error.fieldError('pin')
  if (typeof fieldMessage === 'string' && fieldMessage.startsWith('auth.')) return fieldMessage
  return ERROR_KEYS[error.code] || 'auth.unexpected'
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  // Restore the session from the stored tokens rather than from a cached copy of
  // the user: roles and scope are decided server-side and must not be trusted
  // from localStorage, where anyone could edit them.
  useEffect(() => {
    let cancelled = false
    async function restore() {
      if (!readTokens()) { setReady(true); return }
      try {
        const me = await get('/auth/me/')
        if (!cancelled) setUser(me)
      } catch {
        clearTokens()
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    restore()
    return () => { cancelled = true }
  }, [])

  // A failed token refresh drops the session here, so no caller has to.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null))
    return () => setSessionExpiredHandler(null)
  }, [])

  // --- sign in ------------------------------------------------------------

  const requestOtp = useCallback(async (phone) => {
    try {
      const data = await post('/auth/otp/request/', { phone: normalizePhone(phone) }, { auth: false })
      // `code` and the `known` operator object mirror the old shape so the demo
      // hint still renders. Outside development the server sends neither, and the
      // hint collapses to nothing rather than breaking.
      return { ok: true, ...data, code: data.devCode || null, known: data.operator || null }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  const pinStatus = useCallback(async (phone) => {
    try {
      return await get('/auth/pin/status/', { phone: normalizePhone(phone) }, { auth: false })
    } catch {
      return { known: false, hasPin: false, locked: false, attemptsLeft: MAX_PIN_ATTEMPTS }
    }
  }, [])

  // Tokens are stored but `user` is NOT published yet, so the router stays on
  // the login screen while a first-time user is offered a PIN. `activate()`
  // finishes the sign-in.
  const verifyOtp = useCallback(async (phone, code) => {
    try {
      const data = await post(
        '/auth/otp/verify/',
        { phone: normalizePhone(phone), code },
        { auth: false },
      )
      writeTokens({ access: data.access, refresh: data.refresh })
      return { ok: true, session: data.user, hasPin: data.user.hasPin }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  // The login screen's only sign-in call. Unlike verifyOtp this publishes the
  // session immediately — there is no PIN offer to hold the router back for.
  const signInWithPassword = useCallback(async (phone, password) => {
    try {
      const data = await post(
        '/auth/login/',
        { phone: normalizePhone(phone), password },
        { auth: false },
      )
      writeTokens({ access: data.access, refresh: data.refresh })
      setUser(data.user)
      return { ok: true, session: data.user }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  const signInWithPin = useCallback(async (phone, pin) => {
    try {
      const data = await post(
        '/auth/pin/login/',
        { phone: normalizePhone(phone), pin },
        { auth: false },
      )
      writeTokens({ access: data.access, refresh: data.refresh })
      setUser(data.user)
      return { ok: true, session: data.user }
    } catch (error) {
      const locked = error instanceof ApiError && error.code === 'pin_locked'
      return { ok: false, error: errorKey(error), locked }
    }
  }, [])

  // Publish a session that verifyOtp put on hold.
  const activate = useCallback((session) => {
    setUser(session)
    return session
  }, [])

  // --- password management (requires a token) ------------------------------

  const changePassword = useCallback(async (currentPassword, password) => {
    try {
      const data = await request('/auth/password/', {
        method: 'PUT',
        body: { currentPassword, password },
      })
      // The server revokes every refresh token on a password change, including
      // this tab's. It returns a replacement pair — store it or the next silent
      // refresh signs the user out of the session that just changed it.
      if (data?.access && data?.refresh) writeTokens({ access: data.access, refresh: data.refresh })
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        return { ok: false, error: 'profile.wrongCurrentPassword' }
      }
      // Django's password validators return prose, not keys. `t()` falls back to
      // its argument, so the message renders as written rather than as a blank.
      const fieldMessage = error instanceof ApiError ? error.fieldError('password') : null
      if (fieldMessage) return { ok: false, error: fieldMessage }
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  // --- PIN management (requires a token) ----------------------------------

  const setPin = useCallback(async (pin) => {
    const problem = validatePin(pin)
    if (problem) return { ok: false, error: `auth.${problem}` }
    try {
      await post('/auth/pin/', { pin })
      setUser((prev) => (prev ? { ...prev, hasPin: true } : prev))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  const changePin = useCallback(async (currentPin, nextPin) => {
    const problem = validatePin(nextPin)
    if (problem) return { ok: false, error: `auth.${problem}` }
    try {
      await request('/auth/pin/', { method: 'PUT', body: { currentPin, pin: nextPin } })
      setUser((prev) => (prev ? { ...prev, hasPin: true } : prev))
      return { ok: true }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_pin') {
        return { ok: false, error: 'profile.wrongCurrentPin' }
      }
      if (error instanceof ApiError && error.code === 'no_pin') {
        // No PIN yet, so there is nothing to verify — set one instead.
        return setPin(nextPin)
      }
      return { ok: false, error: errorKey(error) }
    }
  }, [setPin])

  const removePin = useCallback(async () => {
    try {
      await request('/auth/pin/', { method: 'DELETE' })
      setUser((prev) => (prev ? { ...prev, hasPin: false } : prev))
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  // --- profile ------------------------------------------------------------

  const updateProfile = useCallback(async (updates) => {
    try {
      const next = await patch('/auth/me/', updates)
      setUser(next)
      return { ok: true, user: next }
    } catch (error) {
      const fields = error instanceof ApiError ? error.fields : {}
      return { ok: false, error: errorKey(error), fields }
    }
  }, [])

  const uploadAvatar = useCallback(async (file) => {
    const body = new FormData()
    body.append('avatar', file)
    try {
      const next = await request('/auth/me/', { method: 'PATCH', body })
      setUser(next)
      return { ok: true, user: next }
    } catch (error) {
      return { ok: false, error: errorKey(error) }
    }
  }, [])

  const logout = useCallback(async () => {
    const refresh = readTokens()?.refresh
    setUser(null)
    clearTokens()
    // Revoke server-side too, but never block the UI on it: the local session is
    // already gone either way.
    if (refresh) post('/auth/logout/', { refresh }).catch(() => {})
  }, [])

  const value = useMemo(() => ({
    user, ready,
    signInWithPassword, changePassword,
    requestOtp, verifyOtp, pinStatus, signInWithPin, activate,
    setPin, changePin, removePin,
    updateProfile, uploadAvatar, logout,
    // Convenience flags the pages read instead of comparing role strings.
    // Either administrator. Both administer; the difference is how far, and
    // that is decided by the server's querysets rather than by this flag.
    isAdmin: user?.roleKey === 'agency_admin' || user?.roleKey === 'super_admin',
    isSuperAdmin: user?.roleKey === 'super_admin',
    isSupervisor: user?.roleKey === 'supervisor',
    isCollector: user?.roleKey === 'collector',
    canWrite: Boolean(user) && !user.readOnly,
  }), [
    user, ready, signInWithPassword, changePassword,
    requestOtp, verifyOtp, pinStatus, signInWithPin, activate,
    setPin, changePin, removePin, updateProfile, uploadAvatar, logout,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
