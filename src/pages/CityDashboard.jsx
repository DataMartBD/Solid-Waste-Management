// City Corporation dashboard — one city's waste collection, at a glance.
//
// Everything comes from GET /api/reports/city-collection/. Closed days are read
// from the daily summary the server writes at each city's cut-off; today, until
// its cut-off, is counted live. The page keeps three kinds of "collected" apart
// on purpose — confirmed by the agency, assumed at the cut-off, missed by
// complaint — because the city's question is which contractors prove their work.
//
// A City Viewer bound to one city gets no picker: the server ignores `city` for
// them and `cities` comes back empty.

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { PageHeader, Section, StatCard, EmptyState, CHART_TOOLTIP } from '../components/ui.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { IconCheck, IconHome, IconAlert, IconClock, IconRefresh, IconUsers } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

const MODES = ['daily', 'weekly', 'monthly']

export default function CityDashboard() {
  const { api } = useData()
  const { t, n, percent, date, period, digits, lang, wardName } = useLang()
  const [mode, setMode] = useState('daily')
  const [city, setCity] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true, error: null, data: null })

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api.reports.cityCollection.load({ mode, ...(city ? { city } : {}) })
      .then((data) => { if (live) setState({ loading: false, error: null, data }) })
      .catch((error) => { if (live) setState({ loading: false, error, data: null }) })
    return () => { live = false }
  }, [api, mode, city, attempt])

  const periodLabel = (value) => {
    const label = String(value ?? '')
    if (mode === 'monthly') return period(label)
    if (mode === 'weekly') {
      const [year, week] = label.split('-W')
      return t('reports.service.weekLabel', { week: n(Number(week)), year: digits(year) })
    }
    return date(label)
  }

  const data = state.data
  const cityName = data ? (lang === 'bn' && data.city.nameBn) || data.city.name : ''

  const controls = (
    <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
      {data?.cities?.length > 1 && (
        <select className="select" style={{ width: 'auto' }} value={city || data.city.id}
          onChange={(e) => setCity(e.target.value)} aria-label={t('city.pickCity')}>
          {data.cities.map((c) => (
            <option key={c.id} value={c.id}>{(lang === 'bn' && c.nameBn) || c.name}</option>
          ))}
        </select>
      )}
      <div className="seg">
        {MODES.map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t(`reports.mode.${m}`)}</button>
        ))}
      </div>
      {data && (
        <ExportMenu
          title={t('city.exportTitle', { city: cityName })}
          subtitle={`${date(data.from)} – ${date(data.to)}`}
          columns={[
            { key: 'period', label: t('city.col.period'), get: (r) => periodLabel(r.period) },
            { key: 'due', label: t('city.col.due') },
            { key: 'confirmed', label: t('city.col.confirmed') },
            { key: 'auto', label: t('city.col.auto') },
            { key: 'missed', label: t('city.col.missed') },
            { key: 'skipped', label: t('city.col.skipped') },
            { key: 'collectedPct', label: t('city.col.collectedPct') },
            { key: 'complaints', label: t('city.col.complaints') },
          ]}
          rows={data.rows}
          filename={`city_collection_${data.city.id}_${mode}`}
        />
      )}
    </div>
  )

  const header = (
    <PageHeader
      title={data ? t('city.title', { city: cityName }) : t('city.titlePlain')}
      subtitle={data ? t('city.subtitle', { cutoff: digits(data.city.cutoff), deadline: digits(data.city.complaintDeadline) }) : ''}
      actions={controls}
    />
  )

  if (state.loading && !data) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center row gap-8" style={{ padding: '48px 16px', justifyContent: 'center' }}>
          <span className="spinner spinner-dark" /> <span className="muted">{t('common.loading')}</span>
        </div>
      </div>
    )
  }

  if (state.error || !data) {
    return (
      <div className="fade-in">
        {header}
        <div className="card card-pad center" style={{ padding: '40px 20px' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('common.loadFailed')}</div>
          <div className="small muted mt-8">{state.error?.detail || state.error?.message || t('common.loadFailedUnknown')}</div>
          <button className="btn btn-ghost btn-sm mt-16" onClick={() => setAttempt((v) => v + 1)}>
            <IconRefresh size={15} /> {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  const { today, totals, byAgency, byWard, rows } = data

  return (
    <div className="fade-in">
      {header}

      <Section
        title={t('city.today.title', { date: date(today.date) })}
        actions={today.closed
          ? <span className="badge badge-ok"><span className="dot" />{t('city.today.closed')}</span>
          : <span className="badge badge-warn"><span className="dot" />{t('city.today.open', { cutoff: digits(today.cutoff) })}</span>}
      >
        <div className="stat-grid">
          <StatCard icon={<IconHome size={18} />} tone="brand" label={t('city.today.due')} value={n(today.due)}
            sub={t('city.today.dueSub')} />
          <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('city.today.confirmed')} value={n(today.confirmed)}
            sub={t('city.today.confirmedSub')} progress={today.due ? Math.round((today.confirmed / today.due) * 100) : 0} />
          <StatCard icon={<IconClock size={18} />} tone="info" label={t('city.today.pending')} value={n(today.pending)}
            sub={today.closed ? t('city.today.pendingClosed') : t('city.today.pendingSub', { cutoff: digits(today.cutoff) })} />
          <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('city.today.complaints')} value={n(today.complaints)}
            sub={t('city.today.complaintsSub')} />
        </div>
      </Section>

      <div className="stat-grid mt-24">
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('city.kpi.collected')} value={percent(totals.collectedPct)}
          sub={t('city.kpi.collectedSub', { done: n(totals.collected), total: n(totals.due) })} progress={totals.collectedPct} />
        <StatCard icon={<IconUsers size={18} />} tone="brand" label={t('city.kpi.confirmed')} value={percent(totals.confirmedPct)}
          sub={t('city.kpi.confirmedSub', { n: n(totals.confirmed) })} progress={totals.confirmedPct} />
        <StatCard icon={<IconClock size={18} />} tone="info" label={t('city.kpi.auto')} value={n(totals.auto)}
          sub={t('city.kpi.autoSub')} />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('city.kpi.missed')} value={n(totals.missed)}
          sub={t('city.kpi.missedSub', { pct: percent(totals.missedPct) })} />
      </div>

      <div className="mt-24">
        <Section title={t('city.trend.title')}>
          {rows.length === 0 ? (
            <EmptyState>{t('city.empty')}</EmptyState>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={rows} margin={{ left: -18, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => n(v)} tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} labelFormatter={periodLabel} formatter={(value, name) => [n(value), name]} />
                <Legend />
                <Bar dataKey="confirmed" stackId="c" name={t('city.col.confirmed')} fill="var(--brand)" />
                <Bar dataKey="auto" stackId="c" name={t('city.col.auto')} fill="var(--info, #60a5fa)" />
                <Bar dataKey="missed" stackId="c" name={t('city.col.missed')} fill="var(--danger)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title={t('city.byAgency')} pad={false}>
          <BreakdownTable rows={byAgency} rowKey="agency" nameLabel={t('city.col.agency')}
            label={(r) => (lang === 'bn' && r.agencyNameBn) || r.agencyName} />
        </Section>
        <Section title={t('city.byWard')} pad={false}>
          <BreakdownTable rows={byWard} rowKey="ward" nameLabel={t('city.col.ward')}
            label={(r) => (wardName(r.ward) === r.ward ? r.wardName : wardName(r.ward))} />
        </Section>
      </div>
    </div>
  )
}

function BreakdownTable({ rows, rowKey, nameLabel, label }) {
  const { t, n, percent } = useLang()
  if (!rows.length) return <EmptyState>{t('city.empty')}</EmptyState>
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{nameLabel}</th>
            <th>{t('city.col.due')}</th>
            <th>{t('city.col.confirmed')}</th>
            <th>{t('city.col.auto')}</th>
            <th>{t('city.col.missed')}</th>
            <th>{t('city.col.collectedPct')}</th>
            <th>{t('city.col.confirmedPct')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[rowKey] ?? 'none'}>
              <td><b>{label(r)}</b></td>
              <td>{n(r.due)}</td>
              <td>{n(r.confirmed)}</td>
              <td>{n(r.auto)}</td>
              <td style={r.missed ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{n(r.missed)}</td>
              <td>{percent(r.collectedPct)}</td>
              <td>{percent(r.confirmedPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
