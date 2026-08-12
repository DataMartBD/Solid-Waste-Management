// Small reusable presentational components used across pages.
import { useLang } from '../i18n/index.jsx'

// Shared recharts <Tooltip contentStyle>. Recharts' built-in default is an
// inline white background with dark text, so omitting background/color here
// leaves a white tooltip card on every chart in dark mode.
export const CHART_TOOLTIP = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  fontSize: 13,
  background: 'var(--surface)',
  color: 'var(--text)',
}

// `sticky` is for a long form: the heading pins under the topbar and carries the
// save button with it, so the operator never has to scroll back up to submit.
// It is a thin bar rather than the usual block — a header that stays on screen
// is paying for its height on every row of the form below it, so the subtitle
// moves onto the same line as the title instead of taking one of its own.
export function PageHeader({ title, subtitle, actions, sticky }) {
  if (sticky) {
    return (
      <div className="page-head-sticky row between wrap gap-16">
        <div className="row gap-12 wrap" style={{ alignItems: 'baseline' }}>
          <h1>{title}</h1>
          {subtitle && <span className="tiny muted">{subtitle}</span>}
        </div>
        {actions && <div className="row gap-8 wrap">{actions}</div>}
      </div>
    )
  }
  return (
    <div className="row between wrap gap-16" style={{ marginBottom: 20 }}>
      <div>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        {subtitle && <div className="muted mt-4">{subtitle}</div>}
      </div>
      {actions && <div className="row gap-8 wrap">{actions}</div>}
    </div>
  )
}

export function StatCard({ icon, label, value, sub, tone = 'brand', progress }) {
  const tones = {
    brand: 'var(--brand)', ok: 'var(--ok)', warn: 'var(--warn)',
    danger: 'var(--danger)', info: 'var(--info)',
  }
  const color = tones[tone] || tones.brand
  return (
    <div className="card card-pad fade-in">
      <div className="row between">
        <span className="muted small" style={{ fontWeight: 600 }}>{label}</span>
        {icon && <span style={{ color, display: 'flex' }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div className="tiny muted-3 mt-4">{sub}</div>}
      {progress != null && (
        <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, marginTop: 12, overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: color, borderRadius: 99, transition: 'width .6s' }} />
        </div>
      )}
    </div>
  )
}

const BADGE_MAP = {
  active: 'ok', paid: 'ok', collected: 'ok', resolved: 'ok', checked_in: 'ok', on_route: 'ok',
  closed: 'muted', inactive: 'muted', idle: 'muted', retired: 'muted',
  in_progress: 'info', assigned: 'info', partial: 'info',
  open: 'warn', unpaid: 'warn', in_maintenance: 'warn', skipped: 'warn', pending: 'warn',
  overdue: 'danger', off_route: 'danger', absent: 'danger', unsynced: 'danger',
}

export function Status({ value }) {
  const { t } = useLang()
  const tone = BADGE_MAP[value] || 'muted'
  // translate() falls back to the key, so an unmapped status still reads as the
  // old underscore-stripped text rather than "status.foo".
  const key = `status.${value}`
  const label = t(key) === key ? String(value).replace(/_/g, ' ') : t(key)
  return <span className={`badge badge-${tone}`}><span className="dot" />{label}</span>
}

export function EmptyState({ children }) {
  return <div className="center muted-3" style={{ padding: '48px 16px' }}>{children}</div>
}

export function Section({ title, actions, children, pad = true }) {
  return (
    <div className="card fade-in">
      {(title || actions) && (
        <div className="row between" style={{ padding: '15px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 15 }}>{title}</h3>
          {actions}
        </div>
      )}
      <div style={pad ? { padding: 20 } : undefined}>{children}</div>
    </div>
  )
}
