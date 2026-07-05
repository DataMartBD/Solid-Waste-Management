import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { operators } from '../data/mockData.js'

const AuthContext = createContext(null)
const STORAGE_KEY = 'swms.session'

// Roles → what they can reach. Mirrors the RBAC section of the spec.
export const ROLE_HOME = {
  Collector: '/app/dashboard',
  Supervisor: '/app/dashboard',
  'Agency Admin': '/app/dashboard',
  'KCC Viewer': '/app/reports',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch { /* ignore */ }
    setReady(true)
  }, [])

  // Step 1 — "send" an OTP. In a real build this hits the SMS gateway.
  // Here we generate a 6-digit code and return it so the UI can hint it (demo only).
  const requestOtp = useCallback((phone) => {
    const normalized = phone.replace(/\D/g, '').replace(/^88/, '')
    // deterministic-ish demo code so it's reproducible without a backend (4-digit)
    const seed = [...normalized].reduce((a, c) => a + c.charCodeAt(0), 0)
    const code = String(((seed * 7919) % 9000) + 1000)
    const known = operators.find((o) => o.phone === normalized)
    return { phone: normalized, code, known }
  }, [])

  // Step 2 — verify the code and establish a session.
  const verifyOtp = useCallback((phone, code, expected) => {
    if (code !== expected) return { ok: false, error: 'Incorrect code. Please try again.' }
    const normalized = phone.replace(/\D/g, '').replace(/^88/, '')
    const known = operators.find((o) => o.phone === normalized)
    const session = {
      phone: normalized,
      name: known?.name || 'Field Operator',
      role: known?.role || 'Collector',
      scope: known?.scope || 'Assigned zone',
      loginAt: new Date().toISOString(),
    }
    setUser(session)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    return { ok: true, session }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ user, ready, requestOtp, verifyOtp, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
