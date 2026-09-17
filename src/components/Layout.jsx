import { useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { canAccess } from '../access.js'
import { useLang } from '../i18n/index.jsx'
import FloatingAI from './FloatingAI.jsx'
import {
  IconDashboard, IconHome, IconMap, IconRoute, IconAlert, IconBill,
  IconTruck, IconUsers, IconChart, IconLogout, IconBell, IconSearch,
  IconSun, IconMoon, IconUser, IconQr, IconClipboard,
} from './Icons.jsx'

// Labels are translation keys; the sidebar resolves them at render time so the
// nav re-labels itself the moment the language toggle flips.
const NAV_GROUPS = [
  {
    label: 'nav.group.overview',
    items: [
      { to: '/app/dashboard', label: 'nav.dashboard', icon: IconDashboard },
      { to: '/app/live', label: 'nav.live', icon: IconMap },
    ],
  },
  {
    label: 'nav.group.operations',
    items: [
      // The register is entered through the building: a household only means
      // anything in relation to its holding, so the families are a page you
      // reach from a row here rather than a city-wide list of their own.
      { to: '/app/holdings', label: 'nav.holdings', icon: IconHome },
      // Surveys feed the two lists above them: a door is surveyed, then the
      // holding is registered, then the households inside it.
      { to: '/app/surveys', label: 'nav.surveys', icon: IconClipboard },
      { to: '/app/collection', label: 'nav.collection', icon: IconQr },
      { to: '/app/routes', label: 'nav.routes', icon: IconRoute },
      { to: '/app/route-plan', label: 'nav.routePlan', icon: IconMap },
      { to: '/app/complaints', label: 'nav.complaints', icon: IconAlert, badgeKey: 'complaints' },
      { to: '/app/billing', label: 'nav.billing', icon: IconBill },
    ],
  },
  {
    label: 'nav.group.fleet',
    items: [
      { to: '/app/fleet', label: 'nav.fleet', icon: IconTruck },
      { to: '/app/collectors', label: 'nav.collectors', icon: IconUsers },
      // Agencies employ the collectors above them, so they sit together.
      { to: '/app/agencies', label: 'nav.agencies', icon: IconUsers },
    ],
  },
  {
    label: 'nav.group.insight',
    items: [
      { to: '/app/reports', label: 'nav.reports', icon: IconChart },
      { to: '/app/reports-customer', label: 'nav.reportsCustomer', icon: IconBill },
    ],
  },
  {
    label: 'nav.group.system',
    items: [
      // Only an agency admin can reach it, and `canAccess` filters the nav, so
      // nobody else is shown a link that would bounce them.
      { to: '/app/users', label: 'nav.users', icon: IconUsers },
      { to: '/app/profile', label: 'nav.profile', icon: IconUser },
    ],
  },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { complaints, loading, ready, lastError, clearError, refresh } = useData()
  const { t, n, lang, toggle: toggleLang } = useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)

  const openComplaints = complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status)).length
  const initials = (user?.name || 'FO').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const roleLabel = user?.role ? t(`opt.role.${user.role}`) : ''

  // The sidebar only offers pages this role can actually open — the router
  // redirects the rest, and a dead link is worse than no link.
  const groups = useMemo(() => NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccess(item.to, user)) }))
    .filter((group) => group.items.length > 0), [user])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          {/* color must track --brand: it goes pale mint in dark mode, where the
              inherited white glyph dropped to 1.93:1. aria-hidden because the
              app name sits right beside it. */}
          <span className="logo-mark" aria-hidden="true" style={{ width: 34, height: 34, fontSize: 19, background: 'var(--brand)', color: 'var(--on-brand)' }}>♻</span>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>{t('app.name')}</div>
            <div className="tiny">{t('app.tagline')}</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{t(group.label)}</div>
              {group.items.map(({ to, label, icon: Icon, badgeKey }) => {
                const badge = badgeKey === 'complaints' ? openComplaints : 0
                return (
                  <NavLink key={to} to={to} className="nav-item" onClick={() => setOpen(false)}>
                    <Icon size={19} />
                    <span>{t(label)}</span>
                    {badge > 0 && <span className="nav-badge">{n(badge)}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="scope-card">
            <div className="tiny">{t('nav.accessScope')}</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {user?.scope ? t(`opt.scope.${user.scope}`) : t('nav.defaultScope')}
            </div>
          </div>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((o) => !o)} aria-label={t('nav.menu')}>
            <span /><span /><span />
          </button>
          <div className="topbar-search">
            <IconSearch size={17} />
            <input placeholder={t('nav.searchPlaceholder')} />
          </div>
          <div className="grow" />
          <button
            className="lang-toggle"
            onClick={toggleLang}
            title={lang === 'bn' ? t('nav.switchToEnglish') : t('nav.switchToBangla')}
            aria-label={t('nav.language')}
          >
            <span className={lang === 'bn' ? 'on' : ''}>বাং</span>
            <span className={lang === 'en' ? 'on' : ''}>EN</span>
          </button>
          <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')} aria-label={t('nav.toggleTheme')}>
            {theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
          </button>
          <button className="icon-btn" aria-label={t('nav.notifications')}>
            <IconBell size={19} />
            <span className="ping" />
          </button>

          <div className="user-pill">
            <button className="user-trigger" onClick={() => setMenu((m) => !m)} aria-label={t('nav.account')} aria-expanded={menu}>
              <div className="avatar">{initials}</div>
              <div className="user-meta">
                <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
                <div className="tiny muted-3">{roleLabel}</div>
              </div>
            </button>
            {menu && (
              <>
                <div className="export-backdrop" onClick={() => setMenu(false)} />
                <div className="export-pop user-pop">
                  <button onClick={() => { setMenu(false); navigate('/app/profile') }}>
                    <IconUser size={16} /> {t('nav.profile')}
                  </button>
                  <button onClick={handleLogout}>
                    <IconLogout size={16} /> {t('nav.signOut')}
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="content">
          {/* One place to surface a failed write. Individual pages show field
              errors inline; this catches everything else so a request never
              fails silently. */}
          {lastError && (
            <div className="app-banner error" role="alert">
              <span>{lastError.detail || t('common.requestFailed')}</span>
              <span className="grow" />
              {lastError.status === 0 && (
                <button className="link-btn" type="button" onClick={refresh}>{t('common.retry')}</button>
              )}
              <button className="link-btn" type="button" onClick={clearError} aria-label={t('common.close')}>✕</button>
            </div>
          )}
          {loading && !ready
            ? <div className="center" style={{ padding: 48 }}><span className="spinner" /></div>
            : <Outlet />}
        </main>
      </div>

      <FloatingAI />
    </div>
  )
}
