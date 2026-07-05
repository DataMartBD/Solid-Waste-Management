import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useData } from '../context/DataContext.jsx'
import FloatingAI from './FloatingAI.jsx'
import {
  IconDashboard, IconHome, IconMap, IconRoute, IconAlert, IconBill,
  IconTruck, IconUsers, IconChart, IconLogout, IconBell, IconSearch,
  IconSun, IconMoon,
} from './Icons.jsx'

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: IconDashboard },
      { to: '/app/live', label: 'Live Map', icon: IconMap },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/app/households', label: 'Households', icon: IconHome },
      { to: '/app/routes', label: 'Routes', icon: IconRoute },
      { to: '/app/complaints', label: 'Complaints', icon: IconAlert, badgeKey: 'complaints' },
      { to: '/app/billing', label: 'Billing', icon: IconBill },
    ],
  },
  {
    label: 'Fleet & People',
    items: [
      { to: '/app/fleet', label: 'Fleet & Vans', icon: IconTruck },
      { to: '/app/drivers', label: 'Drivers', icon: IconUsers },
    ],
  },
  {
    label: 'Insight',
    items: [
      { to: '/app/reports', label: 'Reports', icon: IconChart },
    ],
  },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { complaints } = useData()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const openComplaints = complaints.filter((c) => ['open', 'assigned', 'in_progress'].includes(c.status)).length
  const initials = (user?.name || 'FO').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <span className="logo-mark" style={{ width: 34, height: 34, fontSize: 19, background: 'var(--brand)' }}>♻</span>
          <div>
            <div style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Smart Sweep</div>
            <div className="tiny">SWMS · KCC</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map(({ to, label, icon: Icon, badgeKey }) => {
                const badge = badgeKey === 'complaints' ? openComplaints : 0
                return (
                  <NavLink key={to} to={to} className="nav-item" onClick={() => setOpen(false)}>
                    <Icon size={19} />
                    <span>{label}</span>
                    {badge > 0 && <span className="nav-badge">{badge}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="scope-card">
            <div className="tiny">Access scope</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.scope || 'Assigned zone'}</div>
          </div>
        </div>
      </aside>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="hamburger" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <div className="topbar-search">
            <IconSearch size={17} />
            <input placeholder="Search households, vans, complaints…" />
          </div>
          <div className="grow" />
          <button className="icon-btn" onClick={toggle} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">
            {theme === 'dark' ? <IconSun size={19} /> : <IconMoon size={19} />}
          </button>
          <button className="icon-btn" aria-label="Notifications">
            <IconBell size={19} />
            <span className="ping" />
          </button>
          <div className="user-pill">
            <div className="avatar">{initials}</div>
            <div className="user-meta">
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.name}</div>
              <div className="tiny muted-3">{user?.role}</div>
            </div>
            <button className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <IconLogout size={18} />
            </button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <FloatingAI />
    </div>
  )
}
