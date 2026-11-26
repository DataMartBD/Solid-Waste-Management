// City Oversight → Collection: one city's waste pickup (formerly the City
// Collection page).
//
// Everything comes from GET /api/reports/city-collection/. Closed days are read
// from the daily summary the server writes at each city's cut-off; today, until
// its cut-off, is counted live. The tab keeps three kinds of "collected" apart
// on purpose — confirmed by the agency, assumed at the cut-off, missed by
// complaint — because the city's question is which contractors prove their work.
//
// The city comes from the page's picker. Complaints and the per-agency figures
// live on the Overview (complaints card, league table), so they are not repeated
// here; this tab adds the day-by-day picture and the ward breakdown.
//
// Admins get "Mark all collected": the cut-off close, run by hand for a chosen
// day. It always previews first (a dry run), then writes on confirm.

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Section, StatCard, EmptyState, CHART_TOOLTIP } from '../components/ui.jsx'
import { Modal, ModalActions } from '../components/Modal.jsx'
import { IconCheck, IconHome, IconAlert, IconClock, IconUsers } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { ExportButtons, Failed, Loading } from './oversightParts.jsx'

const MODES = ['daily', 'weekly', 'monthly']

export default function CollectionTab({ city }) {
  const { api } = useData()
  const { isAdmin, isSuperAdmin } = useAuth()
  const { t, n, percent, date, period, digits, wardName } = useLang()
  const [mode, setMode] = useState('daily')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [closing, setClosing] = useState(false)
  const [notice, setNotice] = useState('')
  const params = { mode, ...(city ? { city } : {}) }

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
  const controls = (
    <div className="filter-bar">
      <div className="seg">
        {MODES.map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t(`reports.mode.${m}`)}</button>
        ))}
      </div>
      {data && (
        <span className="small muted">
          {t('city.subtitle', { cutoff: digits(data.city.cutoff), deadline: digits(data.city.complaintDeadline) })}
        </span>
      )}
      <div className="grow" />
      {isAdmin && data && (
        <button className="btn btn-primary btn-sm" onClick={() => { setNotice(''); setClosing(true) }}>
          <IconCheck size={15} /> {t('city.close.button')}
        </button>
      )}
      <ExportButtons filename={`city_collection_${data?.city.id || city || 'city'}_${mode}`}
        exporter={(p) => api.reports.cityCollection.export({ ...params, ...p })} />
    </div>
  )

  if (state.loading && !data) return <>{controls}<Loading /></>
  if (state.error || !data) {
    return <>{controls}<Failed error={state.error} onRetry={() => setAttempt((v) => v + 1)} /></>
  }

  const { today, totals, byWard, rows } = data

  return (
    <>
      {controls}
      {notice && <div className="form-note ok" style={{ marginBottom: 16 }}><span>{notice}</span></div>}

      {closing && (
        <CloseDayModal
          api={api}
          city={data.city.id}
          today={today.date}
          ownAgency={!isSuperAdmin}
          onClose={() => setClosing(false)}
          onDone={(result) => {
            setClosing(false)
            setNotice(t('city.close.done', { count: n(result.autoCollected), missed: n(result.autoMissed) }))
            setAttempt((v) => v + 1)
          }}
        />
      )}

      <Section
        title={t('city.today.title', { date: date(today.date) })}
        actions={today.closed
          ? <span className="badge badge-ok"><span className="dot" />{t('city.today.closed')}</span>
          : <span className="badge badge-warn"><span className="dot" />{t('city.today.open', { cutoff: digits(today.cutoff) })}</span>}
      >
        <div className="stat-grid">
          <StatCard icon={<IconHome size={18} />} vivid tone="info" label={t('city.today.due')} value={n(today.due)}
            sub={t('city.today.dueSub')} />
          <StatCard icon={<IconCheck size={18} />} vivid tone="brand" label={t('city.today.confirmed')} value={n(today.confirmed)}
            sub={t('city.today.confirmedSub')} progress={today.due ? Math.round((today.confirmed / today.due) * 100) : 0} />
          <StatCard icon={<IconClock size={18} />} vivid tone="warn" label={t('city.today.pending')} value={n(today.pending)}
            sub={today.closed ? t('city.today.pendingClosed') : t('city.today.pendingSub', { cutoff: digits(today.cutoff) })} />
          {!today.closed && today.auto > 0 && (
            <StatCard icon={<IconCheck size={18} />} vivid tone="cyan" label={t('city.today.auto')} value={n(today.auto)}
              sub={t('city.today.autoSub')} />
          )}
        </div>
      </Section>

      <div className="stat-grid mt-24">
        <StatCard icon={<IconCheck size={18} />} vivid tone="brand" label={t('city.kpi.collected')} value={percent(totals.collectedPct)}
          sub={t('city.kpi.collectedSub', { done: n(totals.collected), total: n(totals.due) })} progress={totals.collectedPct} />
        <StatCard icon={<IconUsers size={18} />} vivid tone="violet" label={t('city.kpi.confirmed')} value={percent(totals.confirmedPct)}
          sub={t('city.kpi.confirmedSub', { n: n(totals.confirmed) })} progress={totals.confirmedPct} />
        <StatCard icon={<IconClock size={18} />} vivid tone="info" label={t('city.kpi.auto')} value={n(totals.auto)}
          sub={t('city.kpi.autoSub')} />
        <StatCard icon={<IconAlert size={18} />} vivid tone="danger" label={t('city.kpi.missed')} value={n(totals.missed)}
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
                <Bar dataKey="confirmed" stackId="c" name={t('city.col.confirmed')} fill="var(--viz-1)" />
                <Bar dataKey="auto" stackId="c" name={t('city.col.auto')} fill="var(--viz-2)" />
                <Bar dataKey="missed" stackId="c" name={t('city.col.missed')} fill="var(--viz-5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>
      </div>

      <div className="mt-24">
        <Section title={t('city.byWard')} pad={false}>
          <BreakdownTable rows={byWard} rowKey="ward" nameLabel={t('city.col.ward')}
            label={(r) => (wardName(r.ward) === r.ward ? r.wardName : wardName(r.ward))} />
        </Section>
      </div>
    </>
  )
}

// Preview (dry run) on open and whenever the date changes; confirm writes.
function CloseDayModal({ api, city, today, ownAgency, onClose, onDone }) {
  const { t, n, date } = useLang()
  const [day, setDay] = useState(today)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setBusy(true)
    setError('')
    api.collection.closeDay({ city, day, dryRun: true })
      .then((result) => { if (live) setPreview(result) })
      .catch((err) => { if (live) { setPreview(null); setError(err?.detail || err?.message || 'unknown') } })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [api, city, day])

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      onDone(await api.collection.closeDay({ city, day, dryRun: false }))
    } catch (err) {
      setError(err?.detail || err?.message || 'unknown')
      setBusy(false)
    }
  }

  const nothing = preview && preview.autoCollected + preview.autoMissed === 0

  return (
    <Modal title={t('city.close.title', { date: date(day) })} subtitle={t('city.close.subtitle')}
      onClose={onClose} width={480}>
      <div className="field">
        <label htmlFor="close-day">{t('city.close.day')}</label>
        <input id="close-day" className="input" type="date" value={day} max={today}
          onChange={(e) => e.target.value && setDay(e.target.value)} />
      </div>

      {preview && (
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>{t('city.close.due')}</dt><dd>{n(preview.due)}</dd>
          <dt>{t('city.close.already')}</dt><dd>{n(preview.alreadyVisited)}</dd>
          <dt>{t('city.close.willCollect')}</dt><dd><b style={{ fontSize: 16 }}>{n(preview.autoCollected)}</b></dd>
          <dt>{t('city.close.willMiss')}</dt>
          <dd style={preview.autoMissed ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{n(preview.autoMissed)}</dd>
        </dl>
      )}

      {error && <div className="form-note bad" style={{ marginTop: 12 }}><span>{error === 'unknown' ? t('common.loadFailedUnknown') : error}</span></div>}
      {preview && (
        <div className={`form-note ${nothing ? 'ok' : 'info'}`} style={{ marginTop: 12 }}>
          <span>
            {nothing ? t('city.close.nothing') : t('city.close.lateComplaint')}
            {ownAgency && <> {t('city.close.ownAgency')}</>}
          </span>
        </div>
      )}

      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy && !preview}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || !preview || nothing} onClick={confirm}>
          {busy ? <span className="spinner" /> : t('city.close.confirm', { count: n(preview?.autoCollected ?? 0) })}
        </button>
      </ModalActions>
    </Modal>
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
