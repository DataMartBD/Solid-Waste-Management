import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, ROLE_HOME } from '../context/AuthContext.jsx'
import { operators } from '../data/mockData.js'
import { IconPhone, IconArrow } from '../components/Icons.jsx'

export default function Login() {
  const { requestOtp, verifyOtp } = useAuth()
  const navigate = useNavigate()

  const OTP_LEN = 4
  const [step, setStep] = useState('phone') // 'phone' | 'otp'
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(Array(OTP_LEN).fill(''))
  const [pending, setPending] = useState(null) // { phone, code, known }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const inputs = useRef([])

  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  const validPhone = /^01\d{9}$/.test(phone.replace(/\D/g, ''))

  function sendCode(e) {
    e?.preventDefault()
    if (!validPhone) { setError('Enter a valid 11-digit mobile number (01XXXXXXXXX).'); return }
    setError('')
    setBusy(true)
    setTimeout(() => {
      const res = requestOtp(phone)
      setPending(res)
      setStep('otp')
      setSeconds(30)
      setBusy(false)
      setTimeout(() => inputs.current[0]?.focus(), 50)
    }, 700) // simulate SMS gateway latency
  }

  function onOtpChange(i, val) {
    const cleaned = val.replace(/\D/g, '')
    if (!cleaned) { // clearing the cell
      const next = [...otp]; next[i] = ''; setOtp(next); return
    }
    // support typing/pasting multiple digits into one cell
    const next = [...otp]
    const chars = cleaned.split('')
    let idx = i
    for (const ch of chars) { if (idx >= OTP_LEN) break; next[idx] = ch; idx += 1 }
    setOtp(next)
    setError('')
    const focusAt = Math.min(idx, OTP_LEN - 1)
    inputs.current[focusAt]?.focus()
  }

  function onOtpKey(i, e) {
    if (e.key === 'Backspace' && !otp[i] && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < OTP_LEN - 1) inputs.current[i + 1]?.focus()
  }

  function onOtpPaste(e) {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, OTP_LEN)
    if (!text) return
    e.preventDefault()
    const next = Array(OTP_LEN).fill('')
    text.split('').forEach((c, i) => { next[i] = c })
    setOtp(next)
    inputs.current[Math.min(text.length, OTP_LEN - 1)]?.focus()
  }

  function submitOtp(e) {
    e?.preventDefault()
    const code = otp.join('')
    if (code.length < OTP_LEN) { setError(`Enter the full ${OTP_LEN}-digit code.`); return }
    setBusy(true)
    setTimeout(() => {
      const res = verifyOtp(pending.phone, code, pending.code)
      if (!res.ok) { setError(res.error); setBusy(false); return }
      navigate(ROLE_HOME[res.session.role] || '/app/dashboard', { replace: true })
    }, 500)
  }

  return (
    <div className="login-wrap">
      <div className="login-brand-panel">
        <div className="brand-inner">
          <div className="brand-logo">
            <span className="logo-mark">♻</span> Smart Sweep
          </div>
          <h2 className="brand-tagline">Verifiable waste collection for cleaner cities.</h2>
          <p className="brand-sub">
            Every visit QR-scanned, GPS-stamped and time-verified — real proof of service
            for households, agencies and the City Corporation.
          </p>
          <ul className="brand-points">
            <li><b>QR + GPS verified</b> collection events</li>
            <li><b>Offline-first</b> field capture &amp; sync</li>
            <li><b>Live</b> fleet, billing &amp; complaint tracking</li>
          </ul>
          <div className="brand-foot">Khulna City Corporation · Pilot deployment</div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="login-card fade-in">
          {step === 'phone' ? (
            <>
              <h1 className="login-title">Sign in</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                Enter your registered mobile number. We&apos;ll send a one-time code by SMS.
              </p>
              <form onSubmit={sendCode} style={{ marginTop: 24 }}>
                <div className="field">
                  <label>Mobile number</label>
                  <div className="phone-input">
                    <span className="cc">🇧🇩 +88</span>
                    <input
                      className="input"
                      style={{ border: 'none', boxShadow: 'none', paddingLeft: 8 }}
                      inputMode="numeric"
                      placeholder="01XXXXXXXXX"
                      value={phone}
                      maxLength={13}
                      autoFocus
                      onChange={(e) => { setPhone(e.target.value); setError('') }}
                    />
                    <span style={{ color: 'var(--brand)', display: 'flex', paddingRight: 4 }}><IconPhone size={18} /></span>
                  </div>
                </div>
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
                  {busy ? <span className="spinner" /> : <>Send code <IconArrow size={16} /></>}
                </button>
              </form>

              <div className="demo-box">
                <div className="tiny" style={{ fontWeight: 700, color: 'var(--text-2)' }}>Demo accounts — tap to use</div>
                <div className="demo-grid">
                  {operators.map((o) => (
                    <button key={o.phone} type="button" className="demo-chip" onClick={() => { setPhone(o.phone); setError('') }}>
                      <span className="mono">{o.phone}</span>
                      <span className="tiny muted-3">{o.role}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className="login-title">Verify code</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                Enter the {OTP_LEN}-digit code sent to <b>+88{pending.phone}</b>.
              </p>

              {/* Demo helper — a real deployment never shows the code */}
              <div className="otp-hint">
                Demo mode — your code is <b className="mono">{pending.code}</b>
                {pending.known && <span> · {pending.known.name} ({pending.known.role})</span>}
              </div>

              <form onSubmit={submitOtp} style={{ marginTop: 20 }}>
                <div className="otp-row" onPaste={onOtpPaste}>
                  {otp.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => (inputs.current[i] = el)}
                      className="otp-cell"
                      inputMode="numeric"
                      maxLength={1}
                      value={d}
                      onChange={(e) => onOtpChange(i, e.target.value)}
                      onKeyDown={(e) => onOtpKey(i, e)}
                    />
                  ))}
                </div>
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
                  {busy ? <span className="spinner" /> : 'Verify & continue'}
                </button>
              </form>

              <div className="row between" style={{ marginTop: 16 }}>
                <button className="link-btn" type="button" onClick={() => { setStep('phone'); setOtp(Array(OTP_LEN).fill('')); setError('') }}>
                  ← Change number
                </button>
                <button className="link-btn" type="button" disabled={seconds > 0} onClick={sendCode}>
                  {seconds > 0 ? `Resend in ${seconds}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>
        <div className="login-legal tiny muted-3">
          By continuing you agree to the data-security protocol between KCC and the service operator.
        </div>
      </div>
    </div>
  )
}
