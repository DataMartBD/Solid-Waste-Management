import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, ROLE_HOME, PIN_LENGTH, normalizePhone, validatePin } from '../context/AuthContext.jsx'
import { get } from '../api/client.js'
import { useLang, LANGUAGES, digitsOnly } from '../i18n/index.jsx'
import { IconPhone, IconArrow, IconLock } from '../components/Icons.jsx'

const OTP_LEN = 4

// Shared cell input for both the SMS code and the PIN. `masked` hides the PIN
// from anyone looking over a collector's shoulder in the field.
function CodeCells({ length, value, onChange, masked, autoFocus, inputsRef }) {
  const local = useRef([])
  const inputs = inputsRef || local

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputs.current[0]?.focus(), 50)
  }, [autoFocus, inputs])

  function setAt(i, raw) {
    const cleaned = digitsOnly(raw)
    const next = [...value]
    if (!cleaned) { next[i] = ''; onChange(next); return }
    let idx = i
    for (const ch of cleaned.split('')) {
      if (idx >= length) break
      next[idx] = ch
      idx += 1
    }
    onChange(next)
    inputs.current[Math.min(idx, length - 1)]?.focus()
  }

  function onKey(i, e) {
    if (e.key === 'Backspace' && !value[i] && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < length - 1) inputs.current[i + 1]?.focus()
  }

  function onPaste(e) {
    const text = digitsOnly(e.clipboardData.getData('text') || '').slice(0, length)
    if (!text) return
    e.preventDefault()
    const next = Array(length).fill('')
    text.split('').forEach((c, i) => { next[i] = c })
    onChange(next)
    inputs.current[Math.min(text.length, length - 1)]?.focus()
  }

  return (
    <div className="otp-row" onPaste={onPaste}>
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => { inputs.current[i] = el }}
          className="otp-cell"
          inputMode="numeric"
          type={masked ? 'password' : 'text'}
          autoComplete={masked ? 'off' : 'one-time-code'}
          maxLength={1}
          value={d}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
        />
      ))}
    </div>
  )
}

export default function Login() {
  const { requestOtp, verifyOtp, pinStatus, signInWithPin, setPin, activate } = useAuth()
  const { t, n, digits, lang, setLang } = useLang()
  const navigate = useNavigate()

  // 'phone' → 'pin' (when one is set) or 'otp' → 'createPin' (first sign-in)
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState(Array(OTP_LEN).fill(''))
  const [pin, setPinCells] = useState(Array(PIN_LENGTH).fill(''))
  const [newPin, setNewPin] = useState(Array(PIN_LENGTH).fill(''))
  const [confirmPin, setConfirmPin] = useState(Array(PIN_LENGTH).fill(''))
  const [pending, setPending] = useState(null) // { phone, code, known, hasPin }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  // Demo shortcuts come from the server, which only serves them in development.
  const [demoAccounts, setDemoAccounts] = useState([])

  useEffect(() => {
    get('/auth/demo-operators/', undefined, { auth: false })
      .then((rows) => setDemoAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => setDemoAccounts([]))
  }, [])

  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [seconds])

  const normalized = normalizePhone(phone)
  const validPhone = /^01\d{9}$/.test(normalized)

  function goHome(session) {
    navigate(ROLE_HOME[session.role] || '/app/dashboard', { replace: true })
  }

  // Step 1 — decide between the PIN fast path and an SMS code. Whether a PIN
  // exists and whether the number is locked out are both answered by the server;
  // a browser-side counter would reset on reload, which is no cap at all.
  async function submitPhone(e) {
    e?.preventDefault()
    if (!validPhone) { setError(t('auth.invalidPhone')); return }
    setError('')
    setBusy(true)
    const status = await pinStatus(normalized)
    setBusy(false)
    if (status.hasPin && !status.locked) { setStep('pin'); return }
    // A locked-out number goes straight to SMS recovery.
    sendCode()
  }

  async function sendCode({ keepError = false } = {}) {
    if (!keepError) setError('')
    setBusy(true)
    const result = await requestOtp(normalized)
    setBusy(false)
    if (!result.ok) { setError(t(result.error)); return }
    setPending(result)
    setOtp(Array(OTP_LEN).fill(''))
    setStep('otp')
    setSeconds(30)
  }

  async function submitPin(e) {
    e?.preventDefault()
    const entered = pin.join('')
    if (entered.length < PIN_LENGTH) { setError(t('auth.pinTooShort', { length: n(PIN_LENGTH) })); return }
    setBusy(true)
    const res = await signInWithPin(normalized, entered)
    if (res.ok) { goHome(res.session); return }
    setPinCells(Array(PIN_LENGTH).fill(''))
    setBusy(false)
    // Falling back to SMS beats locking a collector out of their round — but say
    // so, rather than silently teleporting them to the code screen.
    if (res.locked) { setError(t('auth.pinLocked')); sendCode({ keepError: true }); return }
    const status = await pinStatus(normalized)
    setError(t('auth.wrongPin', { left: n(Math.max(0, status.attemptsLeft ?? 0)) }))
  }

  // The code is checked by the server, not compared in the browser.
  async function submitOtp(e) {
    e?.preventDefault()
    const code = otp.join('')
    if (code.length < OTP_LEN) { setError(t('auth.otpTooShort', { length: n(OTP_LEN) })); return }
    setBusy(true)
    const res = await verifyOtp(pending.phone, code)
    setBusy(false)
    if (!res.ok) { setError(t(res.error)); return }
    setError('')
    // The session is authenticated but deliberately not published yet, so a
    // first-time user can be offered a PIN before the router leaves this screen.
    setPending((prev) => ({ ...prev, session: res.session }))
    if (!res.hasPin) { setStep('createPin'); return }
    goHome(activate(res.session))
  }

  // Publish the held session and leave the login screen.
  function finish() {
    const session = pending?.session
    if (!session) { setStep('phone'); return }
    goHome(activate(session))
  }

  async function submitNewPin(e) {
    e?.preventDefault()
    const next = newPin.join('')
    if (next !== confirmPin.join('')) { setError(t('auth.pinMismatch')); return }
    const problem = validatePin(next)
    if (problem === 'tooShort') { setError(t('auth.pinTooShort', { length: n(PIN_LENGTH) })); return }
    if (problem === 'tooSimple') { setError(t('auth.pinTooSimple')); return }
    setBusy(true)
    const res = await setPin(next)
    setBusy(false)
    // A PIN is a convenience, not a gate — if saving it fails, say so but still
    // let the already-verified user in.
    if (!res.ok) { setError(t(res.error)); return }
    finish()
  }

  return (
    <div className="login-wrap">
      <div className="login-brand-panel">
        <div className="brand-inner">
          <div className="brand-logo">
            <span className="logo-mark">♻</span> {t('app.name')}
          </div>
          <h2 className="brand-tagline">{t('auth.brandTitle')}</h2>
          <p className="brand-sub">{t('auth.brandBody')}</p>
          <ul className="brand-points">
            <li>{t('auth.brandPoint1')}</li>
            <li>{t('auth.brandPoint2')}</li>
            <li>{t('auth.brandPoint3')}</li>
          </ul>
          <div className="brand-foot">{t('auth.brandFooter')}</div>
        </div>
      </div>

      <div className="login-form-panel">
        <div className="row" style={{ justifyContent: 'flex-end', width: '100%', maxWidth: 420, marginBottom: 12 }}>
          <div className="seg">
            {LANGUAGES.map((l) => (
              <button key={l.id} type="button" className={lang === l.id ? 'on' : ''} onClick={() => setLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="login-card fade-in">
          {step === 'phone' && (
            <>
              <h1 className="login-title">{t('auth.signIn')}</h1>
              <p className="muted" style={{ marginTop: 6 }}>{t('auth.phoneIntro')}</p>
              <form onSubmit={submitPhone} style={{ marginTop: 24 }}>
                <div className="field">
                  <label>{t('auth.mobileNumber')}</label>
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
                      onChange={(e) => { setPhone(digitsOnly(e.target.value)); setError('') }}
                    />
                    <span style={{ color: 'var(--brand)', display: 'flex', paddingRight: 4 }}><IconPhone size={18} /></span>
                  </div>
                </div>
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
                  {busy ? <span className="spinner" /> : <>{t('common.continue')} <IconArrow size={16} /></>}
                </button>
              </form>

              <div className="demo-box">
                <div className="tiny" style={{ fontWeight: 700, color: 'var(--text-2)' }}>{t('auth.demoAccounts')}</div>
                <div className="demo-grid">
                  {demoAccounts.map((o) => (
                    <button key={o.phone} type="button" className="demo-chip" onClick={() => { setPhone(o.phone); setError('') }}>
                      <span className="mono">{digits(o.phone)}</span>
                      <span className="tiny muted-3">{t(`opt.role.${o.role}`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 'pin' && (
            <>
              <h1 className="login-title row gap-8"><IconLock size={20} /> {t('auth.enterPin')}</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                {t('auth.pinIntro', { length: n(PIN_LENGTH), phone: `+88${digits(normalized)}` })}
              </p>
              <form onSubmit={submitPin} style={{ marginTop: 20 }}>
                <CodeCells length={PIN_LENGTH} value={pin} onChange={setPinCells} masked autoFocus />
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
                  {busy ? <span className="spinner" /> : t('auth.unlock')}
                </button>
              </form>
              <div className="row between" style={{ marginTop: 16 }}>
                <button className="link-btn" type="button" onClick={() => { setStep('phone'); setPinCells(Array(PIN_LENGTH).fill('')); setError('') }}>
                  {t('auth.changeNumber')}
                </button>
                <button className="link-btn" type="button" onClick={sendCode}>{t('auth.forgotPin')}</button>
              </div>
            </>
          )}

          {step === 'otp' && (
            <>
              <h1 className="login-title">{t('auth.verifyCode')}</h1>
              <p className="muted" style={{ marginTop: 6 }}>
                {t('auth.otpIntro', { phone: `+88${digits(pending.phone)}` })}
              </p>

              {/* Demo helper. The server only returns the code while running in
                  development; in production this block does not render at all. */}
              {pending.code && (
                <div className="otp-hint">
                  {pending.known
                    ? t('auth.demoCode', { code: digits(pending.code), name: pending.known.name, role: t(`opt.role.${pending.known.role}`) })
                    : t('auth.demoCodePlain', { code: digits(pending.code) })}
                </div>
              )}

              <form onSubmit={submitOtp} style={{ marginTop: 20 }}>
                <CodeCells length={OTP_LEN} value={otp} onChange={setOtp} autoFocus />
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
                  {busy ? <span className="spinner" /> : t('auth.verifyContinue')}
                </button>
              </form>

              <div className="row between" style={{ marginTop: 16 }}>
                <button className="link-btn" type="button" onClick={() => { setStep('phone'); setOtp(Array(OTP_LEN).fill('')); setError('') }}>
                  {t('auth.changeNumber')}
                </button>
                <button className="link-btn" type="button" disabled={seconds > 0} onClick={sendCode}>
                  {seconds > 0 ? t('auth.resendIn', { seconds: n(seconds) }) : t('auth.resend')}
                </button>
              </div>
            </>
          )}

          {step === 'createPin' && (
            <>
              <h1 className="login-title row gap-8"><IconLock size={20} /> {t('auth.createPin')}</h1>
              <p className="muted" style={{ marginTop: 6 }}>{t('auth.createPinIntro', { length: n(PIN_LENGTH) })}</p>
              <form onSubmit={submitNewPin} style={{ marginTop: 20 }}>
                <div className="field">
                  <label>{t('auth.newPin')}</label>
                  <CodeCells length={PIN_LENGTH} value={newPin} onChange={setNewPin} masked autoFocus />
                </div>
                <div className="field" style={{ marginTop: 14 }}>
                  <label>{t('auth.confirmPin')}</label>
                  <CodeCells length={PIN_LENGTH} value={confirmPin} onChange={setConfirmPin} masked />
                </div>
                {error && <div className="login-error">{error}</div>}
                <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }}>
                  {t('auth.setPin')}
                </button>
              </form>
              <div className="center" style={{ marginTop: 14 }}>
                <button className="link-btn" type="button" onClick={finish}>{t('auth.skipPin')}</button>
              </div>
            </>
          )}
        </div>
        <div className="login-legal tiny muted-3">{t('auth.legal')}</div>
      </div>
    </div>
  )
}
