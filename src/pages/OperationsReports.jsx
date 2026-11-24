// Operations Reports — "Is the waste being collected, by whom, and with what?"
// For the agency admin, the supervisor and the super admin. Six groups:
//
// Collection — Daily collection (per day, or per day and collector; this
//   replaces the old Reports → Service collection) · Missed & skipped · Route completion
// Staff      — Collector scorecard (monthly score; or by period, which is the old
//   Reports → Waste collection) · Attendance
// Complaints — Complaints (City Dashboard tab, narrowed) · Repeat complaints
// Fleet      — Fuel · Maintenance
// Records    — Survey progress · Customers (old Reports → Customers) · Registers
// Contract   — Targets & KPIs (old KPI scorecard + what the City sees) · Monthly report (PDF)
//
// Money lives in Finance Reports. The server fixes agency users to their own
// agency (and a supervisor to their wards); the super admin picks an agency,
// and that pick is sent with every request on every tab.

import { useState } from 'react'
import { PageHeader, Section, StatCard } from '../components/ui.jsx'
import { IconAlert, IconChart, IconCheck, IconClipboard, IconClock, IconDownload, IconFuel, IconHome, IconRoute, IconTruck, IconUsers, IconWrench } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { ExportButtons, Failed, Loading } from './oversightParts.jsx'
import { Table, useLoad } from './Oversight.jsx'
import { AgencyPicker, DateRange, TabBar, daysAgo, isoDay, monthStart, thisMonth } from './reportsShared.jsx'
import { Complaints, Registers, Summary } from './Oversight.jsx'
import { CustomerReports, KpiScorecard, WasteByCollector } from './Reports.jsx'

const GROUPS = {
  collection: ['daily', 'missed', 'routes'],
  staff: ['scorecard', 'attendance'],
  complaints: ['complaints', 'repeat'],
  fleet: ['fuel', 'maintenance'],
  records: ['survey', 'customers', 'registers'],
  contract: ['targets', 'pack'],
}
const AGENCY_REGISTERS = ['collectors', 'supervisors', 'vans', 'documents']

export default function OperationsReports() {
  const { t } = useLang()
  const { api, agencies = [] } = useData()
  const { isSuperAdmin } = useAuth()
  const [group, setGroup] = useState('collection')
  const [tab, setTab] = useState('daily')
  const [agency, setAgency] = useState('')
  const extra = agency ? { agency } : {}
  const source = api.reports.agency
  // Grouping by agency only makes sense when looking across agencies.
  const groups = isSuperAdmin && !agency ? ['agency', 'collector', 'supervisor', 'ward'] : ['collector', 'supervisor', 'ward']

  return (
    <div className="fade-in">
      <PageHeader title={t('agencyReports.title')} subtitle={t('agencyReports.subtitle')}
        actions={isSuperAdmin && <AgencyPicker agencies={agencies} value={agency} onChange={setAgency} />} />
      <TabBar groups={GROUPS} group={group} tab={tab} prefix="agencyReports"
        onGroup={(id) => { setGroup(id); setTab(GROUPS[id][0]) }} onTab={setTab} />
      {tab === 'daily' && <DailyCollection extra={extra} />}
      {tab === 'missed' && <MissedHoldings extra={extra} />}
      {tab === 'routes' && <RouteCompletion extra={extra} />}
      {tab === 'scorecard' && <ScorecardTab extra={extra} />}
      {tab === 'attendance' && <AttendanceReport extra={extra} />}
      {/* Keyed so a new agency or grouping list starts the tab afresh. */}
      {tab === 'complaints' && <Complaints key={`${agency}-${groups[0]}`} source={source} extra={extra} groups={groups} />}
      {tab === 'repeat' && <RepeatComplaints extra={extra} />}
      {tab === 'fuel' && <FuelReport extra={extra} />}
      {tab === 'maintenance' && <MaintenanceReport extra={extra} />}
      {tab === 'survey' && <SurveyProgress extra={extra} />}
      {tab === 'customers' && <CustomerReports key={agency} extra={extra} />}
      {tab === 'registers' && <Registers key={agency} source={source} extra={extra} kinds={AGENCY_REGISTERS} />}
      {tab === 'targets' && <TargetsTab extra={extra} />}
      {tab === 'pack' && <MonthlyPack extra={extra} />}
    </div>
  )
}

// Collector scorecard: this month's score and rank, or field work by period.
function ScorecardTab({ extra }) {
  const { t } = useLang()
  const [view, setView] = useState('month')
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['month', 'period'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{t(`agencyReports.score.by.${v}`)}</button>)}
        </div>
      </div>
      {view === 'month' ? <Scorecard extra={extra} /> : <WasteByCollector key={extra.agency || ''} extra={extra} />}
    </>
  )
}

// Targets & KPIs: the KPI scorecard, then what the City sees about the agency.
function TargetsTab({ extra }) {
  return (
    <>
      <KpiScorecard extra={extra} />
      <div className="mt-24"><Contract extra={extra} /></div>
    </>
  )
}

function Scorecard({ extra }) {
  const { t, n, percent } = useLang()
  const { api } = useData()
  const [period, setPeriod] = useState(thisMonth())
  const params = { ...extra, period }
  const report = useLoad(() => api.reports.agency.scorecard.load(params), [api, period, extra.agency])
  const score = (v) => {
    const tone = v >= 75 ? 'ok' : v >= 50 ? 'warn' : 'danger'
    return <span className={`badge badge-${tone}`}>{n(v)}</span>
  }
  const columns = [
    { key: 'rank', label: t('agencyReports.col.rank'), get: (r) => n(r.rank) },
    { key: 'name', label: t('agencyReports.col.collector'), get: (r) => <b>{r.name}</b> },
    ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }]),
    { key: 'wards', label: t('oversight.col.wards'), get: (r) => n(r.wards) },
    { key: 'holdings', label: t('agencyReports.col.holdings'), get: (r) => n(r.holdings) },
    { key: 'served', label: t('agencyReports.col.served'), get: (r) => n(r.served) },
    { key: 'coverage', label: t('agencyReports.col.coverage'), get: (r) => percent(r.coverage) },
    { key: 'skipped', label: t('agencyReports.col.skipped'), get: (r) => n(r.skipped) },
    { key: 'complaints', label: t('agencyReports.col.complaints'), get: (r) => n(r.complaints) },
    { key: 'billed', label: t('agencyReports.col.billed'), get: (r) => n(r.billed) },
    { key: 'received', label: t('agencyReports.col.received'), get: (r) => n(r.received) },
    { key: 'collectionPct', label: t('agencyReports.col.collectionPct'), get: (r) => percent(r.collectionPct) },
    { key: 'onTime', label: t('agencyReports.col.onTime'), get: (r) => percent(r.onTime) },
    { key: 'score', label: t('agencyReports.col.score'), get: (r) => score(r.score) },
  ]
  const w = report.data?.weights
  return (
    <>
      <div className="filter-bar">
        <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())}
          aria-label={t('oversight.col.period')} />
        <div className="grow" />
        <ExportButtons filename={`collector_scorecard_${period}`}
          exporter={(p) => api.reports.agency.scorecard.export({ ...params, ...p })} />
      </div>
      <Section title={t('agencyReports.scorecardTitle', { period })} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={report.data?.rows} rowKey={(r) => r.id} />}
        {w && (
          <div className="tiny muted-3" style={{ padding: '12px 20px' }}>
            {t('agencyReports.scoreNote', { coverage: n(w.coverage), collection: n(w.collection), onTime: n(w.onTime), complaints: n(w.complaints) })}
          </div>
        )}
      </Section>
    </>
  )
}

function Contract({ extra }) {
  const { t, n, percent } = useLang()
  const { api } = useData()
  const report = useLoad(() => api.reports.agency.contract(extra), [api, extra.agency])
  if (report.loading) return <Loading />
  if (report.error || !report.data) return <Failed error={report.error} onRetry={report.retry} />
  const d = report.data
  const tone = { good: 'ok', fair: 'warn', poor: 'danger' }
  const targetColumns = [
    { key: 'name', label: t('oversight.col.agency') },
    { key: 'target', label: t('oversight.col.target'), get: (r) => (r.target == null ? t('oversight.noTarget') : n(r.target)) },
    { key: 'served', label: t('oversight.col.served'), get: (r) => n(r.served) },
    { key: 'achievement', label: t('oversight.col.achievement'), get: (r) => (r.achievement == null ? '—'
      : <span className={`badge badge-${tone[r.status] || 'muted'}`}>{percent(r.achievement)}</span>) },
    { key: 'new', label: t('oversight.col.new'), get: (r) => n(r.new) },
    { key: 'dropped', label: t('oversight.col.dropped'), get: (r) => n(r.dropped) },
  ]
  return (
    <>
      {extra.agency || d.rank != null ? (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconChart size={18} />} tone="brand" label={t('agencyReports.tab.contract')}
            value={d.rank ? t('agencyReports.rank', { rank: n(d.rank), of: n(d.of) }) : t('agencyReports.rankNone')}
            sub={t('agencyReports.rankSub')} />
        </div>
      ) : null}
      <Summary report={report} />
      <div className="mt-24">
        <Section title={t('agencyReports.targetsTitle')} pad={false}>
          <Table columns={targetColumns} rows={d.targets} rowKey={(r) => r.agency} />
          <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.contractNote')}</div>
        </Section>
      </div>
    </>
  )
}

function DailyCollection({ extra }) {
  const { t, n, percent, date } = useLang()
  const { api } = useData()
  const [by, setBy] = useState('day')
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, by, from, to }
  const report = useLoad(() => api.reports.agency.collectionSheet.load(params), [api, by, from, to, extra.agency])
  const d = report.data
  const tone = (pct) => (pct >= 90 ? 'ok' : pct >= 75 ? 'warn' : 'danger')
  const columns = [
    { key: 'day', label: t('agencyReports.sheet.day'), get: (r) => date(r.day) },
    ...(by === 'day'
      ? [{ key: 'collectors', label: t('agencyReports.sheet.collectors'), get: (r) => n(r.collectors) }]
      : [{ key: 'name', label: t('agencyReports.col.collector'), get: (r) => (r.name ? <b>{r.name}</b> : <span className="muted">{t('agencyReports.sheet.noCollector')}</span>) },
        ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }])]),
    { key: 'due', label: t('city.col.due'), get: (r) => n(r.due) },
    { key: 'confirmed', label: t('city.col.confirmed'), get: (r) => n(r.confirmed) },
    { key: 'auto', label: t('city.col.auto'), get: (r) => n(r.auto) },
    { key: 'skipped', label: t('agencyReports.col.skipped'), get: (r) => n(r.skipped) },
    { key: 'missed', label: t('city.col.missed'), get: (r) => (r.missed ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{n(r.missed)}</span> : n(0)) },
    { key: 'notRecorded', label: t('agencyReports.sheet.notRecorded'), get: (r) => n(r.notRecorded) },
    { key: 'collectedPct', label: t('city.col.collectedPct'), get: (r) => <span className={`badge badge-${tone(r.collectedPct)}`}>{percent(r.collectedPct)}</span> },
  ]
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['day', 'collector'].map((g) => <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>{t(`agencyReports.daily.by.${g}`)}</button>)}
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`daily_collection_${by}_${from}_${to}`} exporter={(p) => api.reports.agency.collectionSheet.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconHome size={18} />} tone="brand" label={t('city.col.due')} value={n(d.totals.due)} />
          <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('city.col.collectedPct')} value={percent(d.totals.collectedPct)}
            sub={t('agencyReports.sheet.collectedSub', { confirmed: n(d.totals.confirmed), auto: n(d.totals.auto) })} progress={d.totals.collectedPct} />
          <StatCard icon={<IconAlert size={18} />} tone={d.totals.missed ? 'danger' : 'warn'} label={t('agencyReports.sheet.notServed')}
            value={n(d.totals.missed + d.totals.skipped)} sub={t('agencyReports.sheet.notServedSub', { missed: n(d.totals.missed), skipped: n(d.totals.skipped) })} />
          <StatCard icon={<IconClock size={18} />} tone="info" label={t('agencyReports.sheet.notRecorded')} value={n(d.totals.notRecorded)}
            sub={t('agencyReports.sheet.notRecordedSub')} />
        </div>
      )}
      <Section title={t('agencyReports.tab.daily')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => `${r.day}-${r.collector ?? ''}`} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.sheet.note')}</div>
      </Section>
    </>
  )
}

function MissedHoldings({ extra }) {
  const { t, n, date } = useLang()
  const { api } = useData()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, from, to }
  const report = useLoad(() => api.reports.agency.missedHoldings.load(params), [api, from, to, extra.agency])
  const d = report.data
  const reasons = (r) => Object.entries(r.reasonCounts || {})
    .map(([k, count]) => `${k ? t(`collection.skip.${k}`) : t('agencyReports.missed.noReason')} ×${n(count)}`).join(', ') || '—'
  const columns = [
    { key: 'holdingNo', label: t('agencyReports.dues.holding'), get: (r) => <b>{r.holdingNo}</b> },
    { key: 'owner', label: t('agencyReports.dues.owner'), get: (r) => r.owner || '—' },
    { key: 'phone', label: t('oversight.col.phone'), mono: true, get: (r) => r.phone || '—' },
    { key: 'road', label: t('agencyReports.dues.road'), get: (r) => `${r.road || '—'} · ${r.wardName || ''}` },
    { key: 'collectorName', label: t('agencyReports.col.collector'), get: (r) => r.collectorName || <span className="muted">{t('agencyReports.sheet.noCollector')}</span> },
    { key: 'missed', label: t('city.col.missed'), get: (r) => (r.missed ? <span className="badge badge-danger">{n(r.missed)}</span> : n(0)) },
    { key: 'skipped', label: t('agencyReports.col.skipped'), get: (r) => n(r.skipped) },
    { key: 'reasons', label: t('agencyReports.missed.reasons'), get: reasons },
    { key: 'last', label: t('agencyReports.missed.last'), get: (r) => date(r.last) },
  ]
  return (
    <>
      <div className="filter-bar">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`missed_holdings_${from}_${to}`} exporter={(p) => api.reports.agency.missedHoldings.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconHome size={18} />} tone="warn" label={t('agencyReports.missed.holdings')} value={n(d.holdings)} />
          <StatCard icon={<IconAlert size={18} />} tone={d.repeat ? 'danger' : 'ok'} label={t('agencyReports.missed.repeat')} value={n(d.repeat)}
            sub={t('agencyReports.missed.repeatSub')} />
          <StatCard icon={<IconAlert size={18} />} tone="danger" label={t('city.col.missed')} value={n(d.missed)} sub={t('agencyReports.missed.missedSub')} />
          <StatCard icon={<IconClock size={18} />} tone="info" label={t('agencyReports.col.skipped')} value={n(d.skipped)} sub={t('agencyReports.missed.skippedSub')} />
        </div>
      )}
      <Section title={t('agencyReports.tab.missed')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.holding} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.missed.note')}</div>
      </Section>
    </>
  )
}

function RouteCompletion({ extra }) {
  const { t, n, percent, date } = useLang()
  const { api } = useData()
  const [by, setBy] = useState('day')
  const [from, setFrom] = useState(daysAgo(6))
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, by, from, to }
  const report = useLoad(() => api.reports.agency.routeCompletion.load(params), [api, by, from, to, extra.agency])
  const d = report.data
  const tone = (pct) => (pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'danger')
  const onTime = (r) => (r.onTime == null ? <span className="muted">{t('agencyReports.routes.notStarted')}</span>
    : <span className={`badge badge-${r.onTime ? 'ok' : 'danger'}`}>{t(r.onTime ? 'agencyReports.routes.onTime' : 'agencyReports.routes.late')}</span>)
  const collector = (r) => r.collectorName || <span className="muted">{t('agencyReports.sheet.noCollector')}</span>
  const columns = by === 'route'
    ? [
        { key: 'routeName', label: t('agencyReports.routes.route'), get: (r) => <b>{r.routeName}</b> },
        { key: 'wardName', label: t('oversight.col.ward') },
        { key: 'collectorName', label: t('agencyReports.col.collector'), get: collector },
        { key: 'stops', label: t('agencyReports.routes.stops'), get: (r) => n(r.stops) },
        { key: 'days', label: t('agencyReports.survey.days'), get: (r) => n(r.days) },
        { key: 'notStarted', label: t('agencyReports.routes.notStarted'), get: (r) => (r.notStarted ? <b>{n(r.notStarted)}</b> : n(0)) },
        { key: 'completion', label: t('agencyReports.routes.completion'), get: (r) => <span className={`badge badge-${tone(r.completion)}`}>{percent(r.completion)}</span> },
        { key: 'onTimePct', label: t('agencyReports.col.onTime'), get: (r) => percent(r.onTimePct) },
      ]
    : [
        { key: 'day', label: t('agencyReports.sheet.day'), get: (r) => date(r.day) },
        { key: 'routeName', label: t('agencyReports.routes.route'), get: (r) => <b>{r.routeName}</b> },
        { key: 'collectorName', label: t('agencyReports.col.collector'), get: collector },
        { key: 'stops', label: t('agencyReports.routes.stops'), get: (r) => n(r.stops) },
        { key: 'served', label: t('agencyReports.routes.scanned'), get: (r) => n(r.served) },
        { key: 'notServed', label: t('agencyReports.sheet.notServed'), get: (r) => n(r.notServed) },
        { key: 'completion', label: t('agencyReports.routes.completion'), get: (r) => <span className={`badge badge-${tone(r.completion)}`}>{percent(r.completion)}</span> },
        { key: 'times', label: t('agencyReports.routes.times'), get: (r) => (r.first ? `${r.first} – ${r.last}` : '—') },
        { key: 'windowEnd', label: t('agencyReports.routes.windowEnd') },
        { key: 'onTime', label: t('agencyReports.col.onTime'), get: onTime },
      ]
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['day', 'route'].map((g) => <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>{t(`agencyReports.routes.by.${g}`)}</button>)}
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`route_completion_${by}_${from}_${to}`} exporter={(p) => api.reports.agency.routeCompletion.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconRoute size={18} />} tone="brand" label={t('agencyReports.routes.completion')} value={percent(d.totals.completion)}
            progress={d.totals.completion} />
          <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('agencyReports.routes.started')} value={n(d.totals.started)}
            sub={t('agencyReports.routes.startedSub', { total: n(d.totals.routeDays) })} />
          <StatCard icon={<IconClock size={18} />} tone="info" label={t('agencyReports.col.onTime')} value={percent(d.totals.onTimePct)}
            sub={t('agencyReports.routes.onTimeSub', { n: n(d.totals.onTime) })} />
        </div>
      )}
      <Section title={t('agencyReports.tab.routes')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => `${r.route}-${r.day || ''}`} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.routes.note')}</div>
      </Section>
    </>
  )
}

function AttendanceReport({ extra }) {
  const { t, n, percent, date } = useLang()
  const { api } = useData()
  const [by, setBy] = useState('collector')
  const [period, setPeriod] = useState(thisMonth())
  const params = { ...extra, by, period }
  const report = useLoad(() => api.reports.agency.attendance.load(params), [api, by, period, extra.agency])
  const d = report.data
  const tone = { present: 'ok', absent: 'danger', noRecord: 'muted' }
  const columns = by === 'day'
    ? [
        { key: 'day', label: t('agencyReports.sheet.day'), get: (r) => date(r.day) },
        { key: 'name', label: t('agencyReports.col.collector'), get: (r) => <b>{r.name}</b> },
        { key: 'status', label: t('oversight.col.status'), get: (r) => <span className={`badge badge-${tone[r.status]}`}>{t(`agencyReports.att.${r.status}`)}</span> },
        { key: 'checkIn', label: t('agencyReports.att.checkIn'), get: (r) => r.checkIn || '—' },
        { key: 'firstScan', label: t('agencyReports.att.firstScan'), get: (r) => r.firstScan || '—' },
        { key: 'startsAt', label: t('agencyReports.att.startsAt') },
        { key: 'late', label: t('agencyReports.att.late'), get: (r) => (r.late ? <span className="badge badge-warn">{t('agencyReports.att.late')}</span> : '—') },
      ]
    : [
        { key: 'name', label: t('agencyReports.col.collector'), get: (r) => <b>{r.name}</b> },
        ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }]),
        { key: 'days', label: t('agencyReports.survey.days'), get: (r) => n(r.days) },
        { key: 'present', label: t('agencyReports.att.present'), get: (r) => n(r.present) },
        { key: 'absent', label: t('agencyReports.att.absent'), get: (r) => (r.absent ? <b style={{ color: 'var(--danger)' }}>{n(r.absent)}</b> : n(0)) },
        { key: 'noRecord', label: t('agencyReports.att.noRecord'), get: (r) => n(r.noRecord) },
        { key: 'late', label: t('agencyReports.att.late'), get: (r) => n(r.late) },
        { key: 'attendancePct', label: t('agencyReports.att.pct'), get: (r) => (
          <span className={`badge badge-${r.attendancePct >= 90 ? 'ok' : r.attendancePct >= 75 ? 'warn' : 'danger'}`}>{percent(r.attendancePct)}</span>) },
        { key: 'startsAt', label: t('agencyReports.att.startsAt') },
      ]
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['collector', 'day'].map((g) => <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>{t(`agencyReports.att.by.${g}`)}</button>)}
        </div>
        <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())}
          aria-label={t('oversight.col.period')} />
        <div className="grow" />
        <ExportButtons filename={`attendance_${by}_${period}`} exporter={(p) => api.reports.agency.attendance.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconUsers size={18} />} tone="brand" label={t('agencyReports.att.pct')} value={percent(d.totals.attendancePct)}
            sub={t('agencyReports.att.pctSub', { present: n(d.totals.present), days: n(d.totals.days) })} progress={d.totals.attendancePct} />
          <StatCard icon={<IconAlert size={18} />} tone={d.totals.absent ? 'danger' : 'ok'} label={t('agencyReports.att.absent')} value={n(d.totals.absent)} />
          <StatCard icon={<IconClock size={18} />} tone="warn" label={t('agencyReports.att.late')} value={n(d.totals.late)}
            sub={t('agencyReports.att.lateSub', { min: n(d.graceMinutes) })} />
          <StatCard icon={<IconClipboard size={18} />} tone="info" label={t('agencyReports.att.noRecord')} value={n(d.totals.noRecord)}
            sub={d.recordingSince ? t('agencyReports.att.since', { date: date(d.recordingSince) }) : t('agencyReports.att.notYet')} />
        </div>
      )}
      <Section title={t('agencyReports.tab.attendance')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => `${r.collector}-${r.day || ''}`} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.att.note', { min: n(d?.graceMinutes ?? 15) })}</div>
      </Section>
    </>
  )
}

function RepeatComplaints({ extra }) {
  const { t, n, date } = useLang()
  const { api } = useData()
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, from, to }
  const report = useLoad(() => api.reports.agency.repeatComplaints.load(params), [api, from, to, extra.agency])
  const d = report.data
  const types = (r) => Object.entries(r.typeCounts || {}).map(([k, c]) => `${t(`complaints.type.${k}`)} ×${n(c)}`).join(', ')
  const columns = [
    { key: 'holdingNo', label: t('agencyReports.dues.holding'), get: (r) => <b>{r.holdingNo}</b> },
    { key: 'owner', label: t('agencyReports.dues.owner'), get: (r) => r.owner || '—' },
    { key: 'phone', label: t('oversight.col.phone'), mono: true, get: (r) => r.phone || '—' },
    { key: 'road', label: t('agencyReports.dues.road'), get: (r) => `${r.road || '—'} · ${r.wardName || ''}` },
    { key: 'complaints', label: t('agencyReports.col.complaints'), get: (r) => <span className="badge badge-danger">{n(r.complaints)}</span> },
    { key: 'open', label: t('oversight.col.openNow'), get: (r) => n(r.open) },
    { key: 'types', label: t('agencyReports.repeat.types'), get: types },
    { key: 'last', label: t('agencyReports.missed.last'), get: (r) => date(r.last) },
    { key: 'assigned', label: t('oversight.col.assigned'), get: (r) => r.assigned || t('oversight.unassigned') },
  ]
  return (
    <>
      <div className="filter-bar">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`repeat_complaints_${from}_${to}`} exporter={(p) => api.reports.agency.repeatComplaints.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconHome size={18} />} tone={d.holdings ? 'danger' : 'ok'} label={t('agencyReports.repeat.holdings')} value={n(d.holdings)}
            sub={t('agencyReports.repeat.holdingsSub', { min: n(d.minimum) })} />
          <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('agencyReports.col.complaints')} value={n(d.complaints)}
            sub={t('agencyReports.repeat.openSub', { open: n(d.open) })} />
        </div>
      )}
      <Section title={t('agencyReports.tab.repeat')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.holding} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.repeat.note')}</div>
      </Section>
    </>
  )
}

function FuelReport({ extra }) {
  const { t, n, taka } = useLang()
  const { api } = useData()
  const [period, setPeriod] = useState(thisMonth())
  const params = { ...extra, period }
  const report = useLoad(() => api.reports.agency.fuel.load(params), [api, period, extra.agency])
  const d = report.data
  const dash = (v, fmt) => (v == null ? '—' : fmt(v))
  const columns = [
    { key: 'id', label: t('oversight.col.van'), mono: true },
    { key: 'plate', label: t('oversight.col.plate'), mono: true },
    ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }]),
    { key: 'driver', label: t('oversight.col.driver'), get: (r) => r.driver || '—' },
    { key: 'fills', label: t('agencyReports.fuel.fills'), get: (r) => n(r.fills) },
    { key: 'litres', label: t('agencyReports.fuel.litres'), get: (r) => n(r.litres) },
    { key: 'cost', label: t('agencyReports.fuel.cost'), get: (r) => <b>{taka(r.cost)}</b> },
    { key: 'costBefore', label: t('agencyReports.fuel.costBefore'), get: (r) => taka(r.costBefore) },
    { key: 'km', label: t('agencyReports.fuel.km'), get: (r) => n(r.km) },
    { key: 'kmpl', label: t('agencyReports.fuel.kmpl'), get: (r) => (r.kmpl == null ? '—' : r.check
      ? <span className="badge badge-danger" title={t('agencyReports.fuel.checkTip', { usual: n(r.usualKmpl) })}>{n(r.kmpl)} · {t('agencyReports.fuel.check')}</span>
      : n(r.kmpl)) },
    { key: 'costPerKm', label: t('agencyReports.fuel.costPerKm'), get: (r) => dash(r.costPerKm, taka) },
    { key: 'holdings', label: t('agencyReports.fuel.holdings'), get: (r) => n(r.holdings) },
    { key: 'costPerHolding', label: t('agencyReports.fuel.costPerHolding'), get: (r) => dash(r.costPerHolding, taka) },
  ]
  const change = d && d.totals.costBefore ? Math.round(((d.totals.cost - d.totals.costBefore) / d.totals.costBefore) * 100) : null
  return (
    <>
      <div className="filter-bar">
        <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())}
          aria-label={t('oversight.col.period')} />
        <div className="grow" />
        <ExportButtons filename={`fuel_${period}`} exporter={(p) => api.reports.agency.fuel.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconFuel size={18} />} tone="brand" label={t('agencyReports.fuel.cost')} value={taka(d.totals.cost)}
            sub={change == null ? t('agencyReports.fuel.noBefore') : t('agencyReports.fuel.vsBefore', { pct: `${change > 0 ? '+' : ''}${n(change)}` })} />
          <StatCard icon={<IconTruck size={18} />} tone="info" label={t('agencyReports.fuel.km')} value={n(d.totals.km)}
            sub={t('agencyReports.fuel.litresSub', { litres: n(d.totals.litres), vans: n(d.totals.vans) })} />
          <StatCard icon={<IconChart size={18} />} tone="ok" label={t('agencyReports.fuel.costPerKm')}
            value={d.totals.costPerKm == null ? '—' : taka(d.totals.costPerKm)} />
          <StatCard icon={<IconAlert size={18} />} tone={d.totals.check ? 'danger' : 'ok'} label={t('agencyReports.fuel.toCheck')}
            value={n(d.totals.check)} sub={t('agencyReports.fuel.toCheckSub', { pct: n(d.dropPct) })} />
        </div>
      )}
      <Section title={t('agencyReports.tab.fuel')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.id} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.fuel.note')}</div>
      </Section>
    </>
  )
}

function MaintenanceReport({ extra }) {
  const { t, n, taka, date } = useLang()
  const { api } = useData()
  const [from, setFrom] = useState(daysAgo(179))
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, from, to }
  const report = useLoad(() => api.reports.agency.maintenance.load(params), [api, from, to, extra.agency])
  const d = report.data
  const kind = (k) => t(`agencyReports.maint.kind.${k === 'scheduled' ? 'scheduled' : 'unscheduled'}`)
  const vanColumns = [
    { key: 'id', label: t('oversight.col.van'), mono: true },
    { key: 'plate', label: t('oversight.col.plate'), mono: true },
    ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }]),
    { key: 'jobs', label: t('agencyReports.maint.jobs'), get: (r) => n(r.jobs) },
    { key: 'unscheduled', label: t('agencyReports.maint.kind.unscheduled'), get: (r) => (r.unscheduled ? <b>{n(r.unscheduled)}</b> : n(0)) },
    { key: 'cost', label: t('agencyReports.maint.cost'), get: (r) => <b>{taka(r.cost)}</b> },
    { key: 'downtimeDays', label: t('agencyReports.maint.daysOff'), get: (r) => n(r.downtimeDays) },
    { key: 'open', label: t('agencyReports.maint.open'), get: (r) => (r.open ? <span className="badge badge-danger">{n(r.open)}</span> : n(0)) },
    { key: 'last', label: t('agencyReports.maint.last'), get: (r) => (r.last ? `${date(r.last)} · ${r.lastReason}` : '—') },
    { key: 'serviceDueIn', label: t('agencyReports.maint.serviceDue'), get: (r) => (r.serviceDueIn == null ? '—'
      : <span className={`badge badge-${r.serviceDueIn <= 0 ? 'danger' : r.serviceDueIn <= 500 ? 'warn' : 'muted'}`}>
        {r.serviceDueIn <= 0 ? t('agencyReports.maint.overdueKm', { km: n(-r.serviceDueIn) }) : t('agencyReports.maint.inKm', { km: n(r.serviceDueIn) })}</span>) },
  ]
  const jobColumns = [
    { key: 'opened', label: t('agencyReports.maint.opened'), get: (r) => date(r.opened) },
    { key: 'van', label: t('oversight.col.van'), mono: true },
    { key: 'kind', label: t('oversight.col.type'), get: (r) => kind(r.kind) },
    { key: 'reason', label: t('agencyReports.maint.reason') },
    { key: 'vendor', label: t('agencyReports.maint.vendor'), get: (r) => r.vendor || '—' },
    { key: 'cost', label: t('agencyReports.maint.cost'), get: (r) => taka(r.cost) },
    { key: 'downtimeH', label: t('agencyReports.maint.hoursOff'), get: (r) => n(r.downtimeH) },
    { key: 'closed', label: t('agencyReports.maint.closed'), get: (r) => (r.closed ? date(r.closed) : <span className="badge badge-warn">{t('agencyReports.maint.stillOpen')}</span>) },
  ]
  return (
    <>
      <div className="filter-bar">
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`maintenance_${from}_${to}`} exporter={(p) => api.reports.agency.maintenance.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconWrench size={18} />} tone="brand" label={t('agencyReports.maint.cost')} value={taka(d.totals.cost)}
            sub={t('agencyReports.maint.jobsSub', { n: n(d.totals.jobs) })} />
          <StatCard icon={<IconClock size={18} />} tone="warn" label={t('agencyReports.maint.daysOff')} value={n(d.totals.downtimeDays)} />
          <StatCard icon={<IconAlert size={18} />} tone={d.totals.open ? 'danger' : 'ok'} label={t('agencyReports.maint.open')} value={n(d.totals.open)} />
          <StatCard icon={<IconTruck size={18} />} tone={d.totals.serviceDue ? 'warn' : 'ok'} label={t('agencyReports.maint.serviceDueCard')}
            value={n(d.totals.serviceDue)} sub={t('agencyReports.maint.serviceDueSub')} />
        </div>
      )}
      <Section title={t('agencyReports.maint.perVan')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={vanColumns} rows={d?.rows} rowKey={(r) => r.id} />}
      </Section>
      {d && (
        <div className="mt-24">
          <Section title={t('agencyReports.maint.jobList')} pad={false}>
            <Table columns={jobColumns} rows={d.jobs} rowKey={(r) => r.id} />
          </Section>
        </div>
      )}
    </>
  )
}

function SurveyProgress({ extra }) {
  const { t, n, percent, date } = useLang()
  const { api } = useData()
  const [by, setBy] = useState('surveyor')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(isoDay(new Date()))
  const params = { ...extra, by, from, to }
  const report = useLoad(() => api.reports.agency.surveyProgress.load(params), [api, by, from, to, extra.agency])
  const d = report.data
  const columns = by === 'ward'
    ? [
        { key: 'wardName', label: t('oversight.col.ward'), get: (r) => <b>{r.wardName}</b> },
        { key: 'holdings', label: t('agencyReports.col.holdings'), get: (r) => n(r.holdings) },
        { key: 'surveyed', label: t('agencyReports.survey.surveyed'), get: (r) => n(r.surveyed) },
        { key: 'coverage', label: t('agencyReports.col.coverage'), get: (r) => (
          <span className={`badge badge-${r.coverage >= 90 ? 'ok' : r.coverage >= 50 ? 'warn' : 'danger'}`}>{percent(r.coverage)}</span>) },
        { key: 'notSurveyed', label: t('agencyReports.survey.notSurveyed'), get: (r) => n(r.notSurveyed) },
        { key: 'surveys', label: t('agencyReports.survey.inRange'), get: (r) => n(r.surveys) },
        { key: 'converted', label: t('agencyReports.survey.converted'), get: (r) => n(r.converted) },
      ]
    : [
        { key: 'name', label: t('agencyReports.survey.surveyor'), get: (r) => <b>{r.name || '—'}</b> },
        { key: 'surveys', label: t('agencyReports.survey.surveys'), get: (r) => n(r.surveys) },
        { key: 'daysWorked', label: t('agencyReports.survey.days'), get: (r) => n(r.daysWorked) },
        { key: 'perDay', label: t('agencyReports.survey.perDay'), get: (r) => n(r.perDay) },
        { key: 'reviewed', label: t('agencyReports.survey.reviewed'), get: (r) => n(r.reviewed) },
        { key: 'converted', label: t('agencyReports.survey.converted'), get: (r) => n(r.converted) },
        { key: 'rejected', label: t('agencyReports.survey.rejected'), get: (r) => n(r.rejected) },
        { key: 'draft', label: t('agencyReports.survey.draft'), get: (r) => n(r.draft) },
        { key: 'conversion', label: t('agencyReports.survey.conversion'), get: (r) => percent(r.conversion) },
        { key: 'last', label: t('agencyReports.missed.last'), get: (r) => date(r.last) },
      ]
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['surveyor', 'ward'].map((g) => <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>{t(`agencyReports.survey.by.${g}`)}</button>)}
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="grow" />
        <ExportButtons filename={`survey_progress_${by}`} exporter={(p) => api.reports.agency.surveyProgress.export({ ...params, ...p })} />
      </div>
      {d && by === 'ward' && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconClipboard size={18} />} tone="brand" label={t('agencyReports.col.coverage')} value={percent(d.totals.coverage)}
            sub={t('agencyReports.survey.coverageSub', { surveyed: n(d.totals.surveyed), holdings: n(d.totals.holdings) })} progress={d.totals.coverage} />
          <StatCard icon={<IconHome size={18} />} tone="ok" label={t('agencyReports.survey.converted')} value={n(d.totals.converted)}
            sub={t('agencyReports.survey.convertedSub')} />
        </div>
      )}
      {d && by === 'surveyor' && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconClipboard size={18} />} tone="brand" label={t('agencyReports.survey.surveys')} value={n(d.totals.surveys)} />
          <StatCard icon={<IconHome size={18} />} tone="ok" label={t('agencyReports.survey.converted')} value={n(d.totals.converted)}
            sub={t('agencyReports.survey.convertedSub')} />
          <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('agencyReports.survey.waiting')} value={n(d.totals.submitted)}
            sub={t('agencyReports.survey.waitingSub')} />
        </div>
      )}
      <Section title={t('agencyReports.tab.survey')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r, i) => r.ward || r.surveyor || `${r.name}-${i}`} />}
      </Section>
    </>
  )
}

function MonthlyPack({ extra }) {
  const { t, n } = useLang()
  const { api } = useData()
  const [period, setPeriod] = useState(thisMonth())
  const params = { ...extra, period }
  const report = useLoad(() => api.reports.agency.monthlyPack.load(params), [api, period, extra.agency])
  const d = report.data
  const shown = (v) => (typeof v === 'number' ? n(v) : v)
  return (
    <>
      <div className="filter-bar">
        <input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value || thisMonth())}
          aria-label={t('oversight.col.period')} />
        <div className="grow" />
        <button className="btn btn-primary btn-sm"
          onClick={() => api.reports.agency.monthlyPack.export({ ...params, format: 'pdf', filename: `monthly_report_${period}.pdf` })}>
          <IconDownload size={15} /> {t('agencyReports.pack.download')}
        </button>
      </div>
      {d?.partial && <div className="form-note info" style={{ marginBottom: 16 }}><span>{t('agencyReports.pack.partial')}</span></div>}
      <Section title={t('agencyReports.pack.figures', { period })} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={[
              { key: 'label', label: t('agencyReports.pack.figure') },
              { key: 'value', label: t('agencyReports.pack.value'), get: (r) => <b>{shown(r.value)}</b> },
            ]} rows={d?.figures} rowKey={(r) => r.label} />}
      </Section>
      {d && (
        <div className="mt-24">
          <Section title={t('agencyReports.pack.contents')}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {d.sections.map((s) => (
                <li key={s.title} className="small">{s.title} — {s.rows.length ? t('agencyReports.pack.rows', { n: n(s.rows.length) }) : t('agencyReports.pack.empty')}</li>
              ))}
            </ul>
            <div className="tiny muted-3 mt-8">{t('agencyReports.pack.note')}</div>
          </Section>
        </div>
      )}
    </>
  )
}
