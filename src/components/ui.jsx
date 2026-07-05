// Small reusable presentational components used across pages.

export function PageHeader({ title, subtitle, actions }) {
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
  open: 'warn', unpaid: 'warn', in_maintenance: 'warn', skipped: 'warn',
  overdue: 'danger', off_route: 'danger', absent: 'danger', unsynced: 'danger',
}

export function Status({ value }) {
  const tone = BADGE_MAP[value] || 'muted'
  const label = String(value).replace(/_/g, ' ')
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
