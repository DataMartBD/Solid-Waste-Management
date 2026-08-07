import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, ROLE_HOME, normalizePhone } from '../context/AuthContext.jsx'
import { get } from '../api/client.js'
import { useLang, LANGUAGES, digitsOnly } from '../i18n/index.jsx'
import { IconPhone, IconArrow, IconLock } from '../components/Icons.jsx'

export default function Login() {
  const { signInWithPassword } = useAuth()
  const { t, digits, lang, setLang } = useLang()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Demo shortcuts come from the server, which only serves them in development.
  const [demoAccounts, setDemoAccounts] = useState([])

  useEffect(() => {
    get('/auth/demo-operators/', undefined, { auth: false })
      .then((rows) => setDemoAccounts(Array.isArray(rows) ? rows : []))
      .catch(() => setDemoAccounts([]))
  }, [])

  const normalized = normalizePhone(phone)
  const validPhone = /^01\d{9}$/.test(normalized)

  async function submit(e) {
    e?.preventDefault()
    if (!validPhone) { setError(t('auth.invalidPhone')); return }
    if (!password) { setError(t('auth.passwordRequired')); return }
    setError('')
    setBusy(true)
    const res = await signInWithPassword(normalized, password)
    setBusy(false)
    if (!res.ok) { setPassword(''); setError(t(res.error)); return }
    navigate(ROLE_HOME[res.session.role] || '/app/dashboard', { replace: true })
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
          <h1 className="login-title">{t('auth.signIn')}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{t('auth.passwordIntro')}</p>

          <form onSubmit={submit} style={{ marginTop: 24 }}>
            <div className="field">
              <label>{t('auth.mobileNumber')}</label>
              <div className="phone-input">
                <span className="cc">🇧🇩 +88</span>
                <input
                  className="input"
                  style={{ border: 'none', boxShadow: 'none', paddingLeft: 8 }}
                  inputMode="numeric"
                  autoComplete="username"
                  placeholder="01XXXXXXXXX"
                  value={phone}
                  maxLength={13}
                  autoFocus
                  onChange={(e) => { setPhone(digitsOnly(e.target.value)); setError('') }}
                />
                <span style={{ color: 'var(--brand)', display: 'flex', paddingRight: 4 }}><IconPhone size={18} /></span>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>{t('auth.password')}</label>
              <div className="phone-input">
                <span style={{ color: 'var(--brand)', display: 'flex', paddingLeft: 10 }}><IconLock size={16} /></span>
                <input
                  className="input"
                  style={{ border: 'none', boxShadow: 'none', paddingLeft: 8 }}
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                />
                {/* Field staff type this on a phone, often in sunlight and often
                    one-handed — a reveal toggle prevents a lockout loop. */}
                <button
                  type="button"
                  className="link-btn tiny"
                  style={{ paddingRight: 10, whiteSpace: 'nowrap' }}
                  onClick={() => setReveal((v) => !v)}
                >
                  {t(reveal ? 'auth.hide' : 'auth.show')}
                </button>
              </div>
            </div>

            {error && <div className="login-error">{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, height: 44 }} disabled={busy}>
              {busy ? <span className="spinner" /> : <>{t('auth.signIn')} <IconArrow size={16} /></>}
            </button>
          </form>

          {demoAccounts.length > 0 && (
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
          )}
        </div>
        <div className="login-legal tiny muted-3">{t('auth.legal')}</div>
      </div>
    </div>
  )
}