// The front door: who is signing in?
//
// Staff (collectors, supervisors, admins, city viewers) go to the staff login;
// holding owners and residents go to the citizen portal. The two use separate
// accounts and separate tokens, so the choice is made here, before either form.

import { Link } from 'react-router-dom'
import { useLang, LANGUAGES } from '../i18n/index.jsx'
import { IconHome, IconShield, IconArrow } from '../components/Icons.jsx'

export default function Landing() {
  const { t, lang, setLang } = useLang()

  const choices = [
    { to: '/citizen', icon: IconHome, title: 'landing.citizen.title', body: 'landing.citizen.body' },
    { to: '/login', icon: IconShield, title: 'landing.staff.title', body: 'landing.staff.body' },
  ]

  return (
    <div className="login-wrap">
      <div className="login-brand-panel">
        <div className="brand-inner">
          <div className="brand-logo">
            <span className="logo-mark">♻</span> {t('app.name')}
          </div>
          <h2 className="brand-tagline">{t('auth.brandTitle')}</h2>
          <p className="brand-sub">{t('auth.brandBody')}</p>
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
          <h1 className="login-title">{t('landing.title')}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{t('landing.intro')}</p>

          <div className="landing-choices">
            {choices.map(({ to, icon: Icon, title, body }) => (
              <Link key={to} to={to} className="landing-choice">
                <span className="landing-icon"><Icon size={22} /></span>
                <span className="landing-text">
                  <b>{t(title)}</b>
                  <span className="small muted">{t(body)}</span>
                </span>
                <IconArrow size={18} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
