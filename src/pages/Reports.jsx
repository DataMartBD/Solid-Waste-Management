// Reporting & Records.
//
// Every tab on this page is now one GET against /api/reports/. The rollups used
// to run in the browser over the whole visit / bill / payment history; they were
// ported to server/swms/reports/aggregates.py, which returns exactly the row keys
// these tables already render. Two consequences worth knowing:
//
//   * Reports are ward-scoped by the server from the signed-in user. There is no
//     ward filter to widen that from here, and adding one would not work.
//   * The same endpoint produces the export file (`?format=csv|xlsx|pdf`), so a
//     downloaded sheet is generated from the identical aggregate as the screen.
//     Where no server exporter covers what is on screen — a locally re-bucketed
//     series, or the multi-section reconciliation document — the client exporter
//     in utils/export.js still does the work, and that is called out inline.

import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { PageHeader, Section, StatCard, EmptyState, CHART_TOOLTIP } from '../components/ui.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import {
  IconChart, IconBill, IconDownload, IconHome, IconUsers, IconEye, IconTruck,
  IconCheck, IconAlert, IconRefresh,
} from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { downloadCSV, downloadExcel, printReport, viewReport, tableToHTML } from '../utils/export.js'
import { REPORT_MODES, isoWeek, totalsOf } from '../utils/reports.js'

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

// How much history to ask for at each granularity. /reports/service-series/ is
// deliberately one row per day — the finest truth — so a coarser view is a
// window size plus local grouping, not a different query.
const SERIES_DAYS = { daily: 30, weekly: 84, monthly: 365 }

function bucket(rows, mode) {
  if (mode === 'daily') return rows.map((r) => ({ label: r.date, ...r, days: 1 }))
  const map = new Map()
  rows.forEach((r) => {
    const key = mode === 'weekly' ? isoWeek(r.date) : r.date.slice(0, 7)
    const g = map.get(key) || { label: key, scheduled: 0, served: 0, billed: 0, collected: 0, days: 0 }
    g.scheduled += r.scheduled; g.served += r.served; g.billed += r.billed; g.collected += r.collected; g.days += 1
    map.set(key, g)
  })
  return [...map.values()]
}

/* ============ shared request plumbing ============ */

// One GET, three states. A request that failed shows the server's own message
// with a retry — never an empty table or a chart of zeros, which an operator
// would read as a genuinely quiet month.
function useReport(load, deps, { skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, error: null, data: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (skip) {
      setState({ loading: false, error: null, data: null })
      return undefined
    }
    let live = true
    setState({ loading: true, error: null, data: null })
    load()
      .then((data) => { if (live) setState({ loading: false, error: null, data }) })
      .catch((error) => { if (live) setState({ loading: false, error, data: null }) })
    return () => { live = false }
    // `load` closes over the current filters, so the dependency list is those
    // filters plus a counter the retry button bumps.
  }, [...deps, attempt, skip]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, retry: () => setAttempt((v) => v + 1) }
}

function Loading() {
  const { t } = useLang()
  return (
    <div className="card card-pad center row gap-8" style={{ padding: '48px 16px', justifyContent: 'center' }}>
      <span className="spinner spinner-dark" /> <span className="muted">{t('common.loading')}</span>
    </div>
  )
}

function LoadFailed({ error, onRetry }) {
  const { t } = useLang()
  return (
    <div className="card card-pad center" style={{ padding: '40px 20px' }}>
      <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{t('common.loadFailed')}</div>
      <div className="small muted mt-8">{error?.detail || error?.message || t('common.loadFailedUnknown')}</div>
      <button className="btn btn-ghost btn-sm mt-16" onClick={onRetry}>
        <IconRefresh size={15} /> {t('common.retry')}
      </button>
    </div>
  )
}

// The export buttons the report tabs share. `exporter(format)` hands the work to
// the server; pass null where no server exporter matches what is on screen and
// everything falls back to utils/export.js over the same rows.
function ExportBar({ title, subtitle, columns, rows, filename, exporter }) {
  const { t, lang } = useLang()
  const [failed, setFailed] = useState(null)
  const html = () => tableToHTML(title, subtitle, columns, rows)

  const local = {
    csv: () => downloadCSV(filename, rows, columns, { t }),
    xlsx: () => downloadExcel(filename, rows, columns, title, { t }),
    pdf: () => printReport(title, html(), { t, lang }),
  }

  const save = async (format) => {
    setFailed(null)
    if (exporter) {
      try {
        // client.js only saves a Blob, and the server answers CSV as text/csv —
        // a falsy result means "came back as text", so build that one here.
        if (await exporter(format)) return
      } catch (error) { setFailed(error); return }
    }
    local[format]()
  }

  return (
    <>
      {/* No server equivalent: this opens a printable preview, not a download. */}
      <button className="btn btn-ghost btn-sm" onClick={() => viewReport(title, html(), { t, lang })}>
        <IconEye size={15} /> {t('export.view')}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => save('xlsx')}>
        <IconDownload size={15} /> {t('export.excel')}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={() => save('csv')}>
        <IconDownload size={15} /> {t('export.csv')}
      </button>
      <button className="btn btn-primary btn-sm" onClick={() => save('pdf')}>
        <IconBill size={15} /> {t('export.pdf')}
      </button>
      {failed && (
        <span className="tiny" style={{ color: 'var(--danger)' }}>
          {failed.detail || failed.message}
        </span>
      )}
    </>
  )
}

const TABS = ['service', 'waste', 'bills', 'recon', 'customers', 'kpi']

export default function Reports() {
  const { t } = useLang()
  const [tab, setTab] = useState('service')
  return (
    <div className="fade-in">
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <div className="filter-bar">
        <div className="seg">
          {TABS.map((id) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{t(`reports.tab.${id}`)}</button>
          ))}
        </div>
      </div>
      {tab === 'service' && <ServiceCollection />}
      {tab === 'waste' && <WasteByCollector />}
      {tab === 'bills' && <BillsByCollector />}
      {tab === 'recon' && <Reconciliation />}
      {tab === 'customers' && <CustomerReports />}
      {tab === 'kpi' && <KpiScorecard />}
    </div>
  )
}

/* ============ shared chrome for the collector-wise reports ============ */

// Bucket keys stay machine-readable ("2026-07-05", "2026-W27", "2026-07", "2026");
// only the label an operator reads goes through the locale helpers.
function usePeriodLabel(mode) {
  const { t, n, date, period, digits } = useLang()
  return (value) => {
    const label = String(value ?? '')
    if (mode === 'yearly') return digits(label)
    if (mode === 'monthly') return period(label)
    if (mode === 'weekly') {
      const [year, week] = label.split('-W')
      return t('reports.service.weekLabel', { week: n(Number(week)), year: digits(year) })
    }
    return date(label)
  }
}

function ModeBar({ mode, setMode }) {
  const { t } = useLang()
  return (
    <div className="seg">
      {REPORT_MODES.map((m) => (
        <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} style={{ textTransform: 'capitalize' }}>{t(`reports.mode.${m}`)}</button>
      ))}
    </div>
  )
}

function ScopeBar({ scope, setScope }) {
  const { t } = useLang()
  return (
    <div className="seg">
      <button className={scope === 'collector' ? 'on' : ''} onClick={() => setScope('collector')}>{t('reports.scope.byCollector')}</button>
      <button className={scope === 'overall' ? 'on' : ''} onClick={() => setScope('overall')}>{t('reports.scope.overall')}</button>
    </div>
  )
}

function CollectorPicker({ value, onChange }) {
  const { t } = useLang()
  const { collectors } = useData()
  return (
    <select className="select" style={{ width: 'auto' }} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">{t('reports.filter.allCollectors')}</option>
      {collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  )
}

// One renderer driven by the same `columns` the export uses, so what is printed
// can never drift from what is on screen.
function ReportTable({ columns, rows, rowKey }) {
  const { t } = useLang()
  if (!rows.length) return <EmptyState>{t('reports.empty')}</EmptyState>
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {columns.map((c, ci) => (
                <td key={c.key} className={(c.mono ?? ci > 0) ? 'mono' : undefined}
                  style={ci === 0 ? { fontWeight: 600 } : undefined}>{c.get(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ============ 1. Waste collection by collector ============ */
function WasteByCollector() {
  const { t, n, percent } = useLang()
  const { api, collectorName } = useData()
  const [mode, setMode] = useState('daily')
  const [scope, setScope] = useState('collector')
  const [who, setWho] = useState('all')
  const labelFor = usePeriodLabel(mode)

  // Both the collector filter and the overall rollup are server-side parameters —
  // filtering first and then rolling up is the server's job, and asking it that
  // way keeps "overall for one collector" meaning that collector's totals.
  const params = useMemo(() => ({
    mode,
    collector: who === 'all' ? undefined : who,
    overall: scope === 'overall' ? true : undefined,
  }), [mode, who, scope])

  const report = useReport(() => api.reports.wasteCollection.load(params), [api, params])

  // The server sorts oldest-first; this screen has always read newest-first.
  const rows = useMemo(() => [...(report.data?.rows || [])].sort((a, b) => (a.period === b.period
    ? String(a.collector).localeCompare(String(b.collector))
    : b.period.localeCompare(a.period))), [report.data])

  const totals = useMemo(() => totalsOf(rows, ['planned', 'served', 'skipped', 'covered']), [rows])

  const columns = [
    { key: 'period', label: t('reports.col.period'), get: (r) => labelFor(r.period) },
    ...(scope === 'collector'
      ? [{ key: 'collector', label: t('reports.col.collector'), mono: false, get: (r) => collectorName(r.collector) }]
      : []),
    { key: 'planned', label: t('reports.waste.col.planned'), get: (r) => n(r.planned) },
    { key: 'served', label: t('reports.service.col.served'), get: (r) => n(r.served) },
    { key: 'skipped', label: t('reports.waste.col.skipped'), get: (r) => n(r.skipped) },
    { key: 'actioned', label: t('reports.waste.col.actioned'), get: (r) => n(r.actioned) },
    { key: 'covered', label: t('reports.waste.col.covered'), get: (r) => n(r.covered) },
    { key: 'coverage', label: t('reports.customers.col.coverage'), get: (r) => percent(r.coverage) },
  ]

  const title = t(`reports.waste.title.${mode}`)
  const filename = `waste_collection_${mode}`

  return (
    <>
      <div className="filter-bar">
        <ModeBar mode={mode} setMode={setMode} />
        <ScopeBar scope={scope} setScope={setScope} />
        <CollectorPicker value={who} onChange={setWho} />
        <div className="grow" />
        <ExportBar title={title} subtitle={t('reports.waste.exportSubtitle', { count: n(rows.length) })}
          columns={columns} rows={rows} filename={filename}
          exporter={(format) => api.reports.wasteCollection.export({ ...params, format, filename: `${filename}.${format}` })} />
      </div>

      {report.loading ? <Loading /> : report.error ? <LoadFailed error={report.error} onRetry={report.retry} /> : (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <StatCard icon={<IconTruck size={18} />} label={t('reports.waste.stat.served')} value={n(totals.served)}
              sub={t('reports.waste.stat.servedSub', { count: n(totals.planned) })} />
            <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('reports.waste.stat.skipped')} value={n(totals.skipped)}
              sub={t('reports.waste.stat.skippedSub')} />
            <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('reports.waste.stat.coverage')}
              value={percent(pct(totals.served, totals.planned))} sub={t('reports.waste.stat.coverageSub')}
              progress={pct(totals.served, totals.planned)} />
            <StatCard icon={<IconUsers size={18} />} tone="info" label={t('reports.waste.stat.covered')} value={n(totals.covered)}
              sub={t('reports.waste.stat.coveredSub')} />
          </div>

          <Section title={title} pad={false} actions={<span className="tiny muted">{t('reports.rows', { count: n(rows.length) })}</span>}>
            <ReportTable columns={columns} rows={rows} rowKey={(r) => `${r.period}|${r.collector ?? 'all'}`} />
            <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('reports.waste.note')}</div>
          </Section>
        </>
      )}
    </>
  )
}

/* ============ 2. Bill collection by collector ============ */
function BillsByCollector() {
  const { t, n, taka, percent } = useLang()
  const { api, collectorName } = useData()
  const [mode, setMode] = useState('monthly')
  const [scope, setScope] = useState('collector')
  const [who, setWho] = useState('all')
  const labelFor = usePeriodLabel(mode)

  // /reports/bill-collection/ takes no collector parameter — money is credited to
  // whoever took it, which the server has to resolve before it can be filtered —
  // so the collector picker narrows the returned rows here.
  const params = useMemo(() => ({
    mode,
    overall: scope === 'overall' ? true : undefined,
  }), [mode, scope])

  const report = useReport(() => api.reports.billCollection.load(params), [api, params])

  const rows = useMemo(() => {
    const all = report.data?.rows || []
    const picked = who === 'all' ? all : all.filter((r) => r.collector === who)
    return [...picked].sort((a, b) => (a.period === b.period
      ? String(a.collector).localeCompare(String(b.collector))
      : b.period.localeCompare(a.period)))
  }, [report.data, who])

  const totals = useMemo(() => {
    // `bills` is not part of the server's totals payload, and once the collector
    // picker narrows the rows the server's money totals would overstate the
    // table — so re-total the slice that is actually on screen.
    const money = who === 'all' && report.data?.totals ? report.data.totals : totalsOf(rows)
    return { ...money, bills: rows.reduce((a, r) => a + (r.bills || 0), 0) }
  }, [rows, who, report.data])

  // A bill whose holding sits on no active route has no planned collector; it is
  // still money owed, so it is named rather than dropped or shown as "null".
  const whoLabel = (r) => (r.collector ? collectorName(r.collector) : t('reports.unassigned'))

  const columns = [
    { key: 'period', label: t('reports.col.period'), get: (r) => labelFor(r.period) },
    ...(scope === 'collector'
      ? [{ key: 'collector', label: t('reports.col.collector'), mono: false, get: whoLabel }]
      : []),
    { key: 'bills', label: t('reports.bills.col.bills'), get: (r) => n(r.bills) },
    { key: 'billed', label: t('reports.service.col.billed'), get: (r) => taka(r.billed) },
    { key: 'received', label: t('reports.bills.col.received'), get: (r) => taka(r.received) },
    { key: 'outstanding', label: t('reports.customers.col.dues'), get: (r) => taka(r.outstanding) },
    { key: 'rate', label: t('reports.service.col.chargeRate'), get: (r) => percent(r.rate) },
  ]

  const title = t(`reports.bills.title.${mode}`)
  const filename = `bill_collection_${mode}`
  // The server exporter returns every collector's rows; once the picker narrows
  // the table, only the client exporter can produce the file on screen.
  const exporter = who === 'all'
    ? (format) => api.reports.billCollection.export({ ...params, format, filename: `${filename}.${format}` })
    : null

  return (
    <>
      <div className="filter-bar">
        <ModeBar mode={mode} setMode={setMode} />
        <ScopeBar scope={scope} setScope={setScope} />
        <CollectorPicker value={who} onChange={setWho} />
        <div className="grow" />
        <ExportBar title={title} subtitle={t('reports.bills.exportSubtitle', { count: n(rows.length) })}
          columns={columns} rows={rows} filename={filename} exporter={exporter} />
      </div>

      {report.loading ? <Loading /> : report.error ? <LoadFailed error={report.error} onRetry={report.retry} /> : (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <StatCard icon={<IconBill size={18} />} label={t('reports.service.stat.billed')} value={taka(totals.billed)}
              sub={t('reports.bills.stat.billedSub', { count: n(totals.bills) })} />
            <StatCard icon={<IconBill size={18} />} tone="ok" label={t('reports.service.stat.collected')} value={taka(totals.received)}
              sub={t('reports.bills.stat.receivedSub')} />
            <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('reports.bills.stat.outstanding')} value={taka(totals.outstanding)}
              sub={t('reports.bills.stat.outstandingSub')} />
            <StatCard icon={<IconChart size={18} />} tone="info" label={t('reports.bills.stat.rate')}
              value={percent(pct(totals.received, totals.billed))} sub={t('reports.bills.stat.rateSub')}
              progress={pct(totals.received, totals.billed)} />
          </div>

          <Section title={title} pad={false} actions={<span className="tiny muted">{t('reports.rows', { count: n(rows.length) })}</span>}>
            <ReportTable columns={columns} rows={rows} rowKey={(r) => `${r.period}|${r.collector ?? 'none'}`} />
            <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('reports.bills.note')}</div>
          </Section>
        </>
      )}
    </>
  )
}

/* ============ 3. Service reconciliation (monthly, two sections) ============ */
const RECON_METRICS = [
  { id: 'holdingsServed', kind: 'count' },
  { id: 'holdingsBilled', kind: 'count' },
  { id: 'stopsServed', kind: 'count' },
  { id: 'stopsSkipped', kind: 'count' },
  { id: 'billed', kind: 'money' },
  { id: 'received', kind: 'money' },
  { id: 'outstanding', kind: 'money' },
  { id: 'rate', kind: 'rate' },
]
const EXCEPTION_KINDS = ['servedNotBilled', 'billedNotServed', 'paidNotServed']

function Reconciliation() {
  const { t, n, taka, percent, period: fmtPeriod, optLabel, wardName, lang } = useLang()
  const { api, bills, paymentModes, collectorName } = useData()

  const months = useMemo(
    () => [...new Set(bills.map((b) => b.period).filter(Boolean))].sort().reverse(),
    [bills],
  )
  const [picked, setPicked] = useState('')
  const month = months.includes(picked) ? picked : months[0]

  const report = useReport(
    () => api.reports.reconciliation.load({ period: month }),
    [api, month],
    { skip: !month },
  )

  if (!months.length) return <EmptyState>{t('reports.recon.noMonths')}</EmptyState>
  if (report.loading) return <Loading />
  if (report.error || !report.data) return <LoadFailed error={report.error} onRetry={report.retry} />

  // This endpoint answers with the four sections directly, not with `{ rows }`.
  const { service, exceptions, cash, cashTotals } = report.data

  const metricValue = (m) => (m.kind === 'money' ? taka(service[m.id]) : m.kind === 'rate' ? percent(service[m.id]) : n(service[m.id]))
  const metricRows = RECON_METRICS.map((m) => ({ ...m, value: metricValue(m) }))
  const metricCols = [
    { key: 'metric', label: t('reports.recon.col.metric'), mono: false, get: (r) => t(`reports.recon.m.${r.id}`) },
    { key: 'value', label: t('reports.recon.col.value'), get: (r) => r.value },
  ]

  // Holding numbers, road names and household ids stay exactly as recorded. The
  // exception lists carry `{ id, head }`; the rest of the address is not part of
  // the payload, so those cells read as "none" rather than inventing a lookup.
  const hhCols = [
    { key: 'id', label: t('reports.col.id'), get: (r) => r.id },
    { key: 'head', label: t('reports.col.head'), mono: false, get: (r) => r.head || t('common.none') },
    { key: 'ward', label: t('reports.col.ward'), mono: false, get: (r) => (r.ward ? wardName(r.ward) : t('common.none')) },
    { key: 'road', label: t('reports.col.road'), mono: false, get: (r) => r.road || t('common.none') },
    { key: 'holding', label: t('reports.col.holding'), get: (r) => r.holding || t('common.none') },
  ]

  const methodText = (byMethod) => {
    const parts = Object.entries(byMethod || {}).map(([m, amount]) => `${optLabel(paymentModes, m)}: ${taka(amount)}`)
    return parts.length ? parts.join(' · ') : t('common.none')
  }
  const cashWho = (r) => (r._total
    ? t('reports.recon.cash.totals')
    : r.collector ? collectorName(r.collector) : t('reports.unassigned'))
  const cashRows = [...cash, { _total: true, collector: null, byMethod: {}, ...cashTotals }]
  const cashCols = [
    { key: 'collector', label: t('reports.col.collector'), get: cashWho },
    { key: 'collected', label: t('reports.recon.cash.col.collected'), get: (r) => taka(r.collected) },
    { key: 'deposited', label: t('reports.recon.cash.col.deposited'), get: (r) => taka(r.deposited) },
    { key: 'variance', label: t('reports.recon.cash.col.variance'), get: (r) => taka(r.variance) },
    { key: 'byMethod', label: t('reports.recon.cash.col.byMethod'), get: (r) => methodText(r.byMethod) },
  ]

  // ---- export: one printed document, section by section ----
  //
  // Deliberately still built here. The server's exporter for this report
  // flattens to the cash rows alone, which would drop the three exception lists —
  // and those lists are the reason the report exists.
  const docTitle = t('reports.recon.title', { period: fmtPeriod(month) })
  const docSub = t('reports.recon.exportSubtitle', { period: fmtPeriod(month) })
  const noteCols = [{ key: 'note', label: t('reports.recon.col.detail'), get: (r) => r.note }]
  // An empty exception list is a result, not a blank space — it prints as an
  // explicit "nothing outstanding" line so a signed-off report says so.
  const block = (title, why, cols, rows) => (rows.length
    ? tableToHTML(title, why, cols, rows)
    : tableToHTML(title, why, noteCols, [{ note: t('reports.recon.clean') }]))

  const docHTML = () => [
    tableToHTML(docTitle, `${t('reports.recon.secA')} · ${docSub}`, metricCols, metricRows),
    ...EXCEPTION_KINDS.map((k) => block(
      t(`reports.recon.exc.${k}`), t(`reports.recon.exc.${k}Why`), hhCols, exceptions[k],
    )),
    block(t('reports.recon.secB'), t('reports.recon.cash.note'), cashCols, cashRows),
  ].join('')

  // ---- export: one flat sheet for Excel / CSV ----
  const flatCols = [
    { key: 'section', label: t('reports.recon.col.section') },
    { key: 'item', label: t('reports.recon.col.item') },
    { key: 'detail', label: t('reports.recon.col.detail') },
    { key: 'value', label: t('reports.recon.col.value') },
  ]
  const flatRows = () => [
    ...metricRows.map((m) => ({ section: t('reports.recon.secA'), item: t(`reports.recon.m.${m.id}`), detail: '', value: m.value })),
    ...EXCEPTION_KINDS.flatMap((k) => {
      const section = t(`reports.recon.exc.${k}`)
      if (!exceptions[k].length) return [{ section, item: t('reports.recon.clean'), detail: '', value: '' }]
      return exceptions[k].map((h) => ({
        section,
        item: h.id,
        detail: h.head || t('common.none'),
        value: [h.ward ? wardName(h.ward) : null, h.road, h.holding].filter(Boolean).join(' · ') || t('common.none'),
      }))
    }),
    ...cashRows.flatMap((r) => {
      const item = cashWho(r)
      const section = t('reports.recon.secB')
      return [
        { section, item, detail: t('reports.recon.cash.col.collected'), value: taka(r.collected) },
        { section, item, detail: t('reports.recon.cash.col.deposited'), value: taka(r.deposited) },
        { section, item, detail: t('reports.recon.cash.col.variance'), value: taka(r.variance) },
        ...Object.entries(r.byMethod || {}).map(([m, amount]) => ({
          section, item, detail: optLabel(paymentModes, m), value: taka(amount),
        })),
      ]
    }),
  ]

  const file = `reconciliation_${month || 'all'}`

  return (
    <>
      <div className="filter-bar">
        <label className="tiny muted" htmlFor="recon-month">{t('reports.recon.month')}</label>
        <select id="recon-month" className="select" style={{ width: 'auto' }} value={month} onChange={(e) => setPicked(e.target.value)}>
          {months.map((p) => <option key={p} value={p}>{fmtPeriod(p)}</option>)}
        </select>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => viewReport(docTitle, docHTML(), { t, lang })}><IconEye size={15} /> {t('export.view')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadExcel(file, flatRows(), flatCols, docTitle, { t })}><IconDownload size={15} /> {t('export.excel')}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCSV(file, flatRows(), flatCols, { t })}><IconDownload size={15} /> {t('export.csv')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => printReport(docTitle, docHTML(), { t, lang })}><IconBill size={15} /> {t('export.pdf')}</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconTruck size={18} />} label={t('reports.recon.m.holdingsServed')} value={n(service.holdingsServed)}
          sub={t('reports.recon.m.holdingsBilled') + ': ' + n(service.holdingsBilled)} />
        <StatCard icon={<IconBill size={18} />} label={t('reports.recon.m.billed')} value={taka(service.billed)}
          sub={t('reports.recon.m.received') + ': ' + taka(service.received)} />
        <StatCard icon={<IconBill size={18} />} tone="warn" label={t('reports.recon.m.outstanding')} value={taka(service.outstanding)}
          sub={t('reports.bills.stat.outstandingSub')} />
        <StatCard icon={<IconChart size={18} />} tone={cashTotals.variance > 0 ? 'danger' : 'ok'}
          label={t('reports.recon.cash.col.variance')} value={taka(cashTotals.variance)}
          sub={cashTotals.variance > 0 ? t('reports.recon.cash.shortfall') : t('reports.recon.cash.settled')} />
      </div>

      {/* ---- Section A ---- */}
      <Section title={`${t('reports.recon.secA')} — ${t('reports.recon.summary')}`} pad={false}
        actions={<span className="tiny muted">{fmtPeriod(month)}</span>}>
        <ReportTable columns={metricCols} rows={metricRows} rowKey={(r) => r.id} />
      </Section>

      {EXCEPTION_KINDS.map((k) => (
        <div key={k} style={{ marginTop: 20 }}>
          <Section title={t(`reports.recon.exc.${k}`)} pad={false}
            actions={<span className="tiny muted">{t('common.records', { count: n(exceptions[k].length) })}</span>}>
            <div className="tiny muted-3" style={{ padding: '12px 20px 0' }}>{t(`reports.recon.exc.${k}Why`)}</div>
            {exceptions[k].length
              ? <ReportTable columns={hhCols} rows={exceptions[k]} rowKey={(r) => r.id} />
              : <EmptyState>{t('reports.recon.clean')}</EmptyState>}
          </Section>
        </div>
      ))}

      {/* ---- Section B ---- */}
      <div style={{ marginTop: 20 }}>
        <Section title={t('reports.recon.secB')} pad={false}
          actions={<span className="tiny muted">{t('common.records', { count: n(cash.length) })}</span>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr>{cashCols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
              <tbody>
                {cashRows.map((r) => (
                  <tr key={r._total ? '__total' : String(r.collector)} style={r._total ? { fontWeight: 700, background: 'var(--surface-2)' } : undefined}>
                    <td style={{ fontWeight: 600 }}>{cashWho(r)}</td>
                    <td className="mono">{taka(r.collected)}</td>
                    <td className="mono">{taka(r.deposited)}</td>
                    <td className="mono">
                      {r.variance > 0
                        ? <span className="badge badge-danger"><span className="dot" />{taka(r.variance)} · {t('reports.recon.cash.shortfall')}</span>
                        : <span className="badge badge-ok"><span className="dot" />{taka(r.variance)} · {t('reports.recon.cash.settled')}</span>}
                    </td>
                    <td className="small">{methodText(r.byMethod)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('reports.recon.cash.note')}</div>
        </Section>
      </div>
    </>
  )
}

/* ============ Service collection: daily / weekly / monthly ============ */
function ServiceCollection() {
  const { t, n, taka, percent, date, period, digits } = useLang()
  const { api } = useData()
  const [mode, setMode] = useState('daily')
  const days = SERIES_DAYS[mode]

  const report = useReport(() => api.reports.serviceSeries.load({ days }), [api, days])

  const data = useMemo(
    () => bucket(report.data?.rows || [], mode).slice().reverse(),
    [report.data, mode],
  )
  const totals = useMemo(() => totalsOf(data, ['scheduled', 'served', 'billed', 'collected']), [data])

  // Bucket keys stay machine-readable (ISO date, "2026-W27", "2026-07"); only the
  // display label goes through the locale helpers.
  const labelFor = (label) => {
    if (mode === 'monthly') return period(label)
    if (mode === 'weekly') {
      const [year, week] = String(label).split('-W')
      return t('reports.service.weekLabel', { week: n(Number(week)), year: digits(year) })
    }
    return date(label)
  }

  const chartData = data.slice(0, 12).reverse().map((r) => ({ label: labelFor(r.label), collected: r.collected }))

  const columns = [
    {
      key: 'label',
      label: t(mode === 'monthly' ? 'reports.service.col.month' : mode === 'weekly' ? 'reports.service.col.week' : 'reports.service.col.date'),
      get: (r) => labelFor(r.label),
    },
    { key: 'scheduled', label: t('reports.service.col.scheduled'), get: (r) => n(r.scheduled) },
    { key: 'served', label: t('reports.service.col.served'), get: (r) => n(r.served) },
    { key: 'eff', label: t('reports.service.col.efficiency'), get: (r) => percent(pct(r.served, r.scheduled)) },
    { key: 'billed', label: t('reports.service.col.billed'), get: (r) => n(r.billed) },
    { key: 'collected', label: t('reports.service.col.collected'), get: (r) => n(r.collected) },
    { key: 'rate', label: t('reports.service.col.chargeRate'), get: (r) => percent(pct(r.collected, r.billed)) },
  ]

  const title = t(`reports.service.title.${mode}`)
  const filename = `service_collection_${mode}`

  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['daily', 'weekly', 'monthly'].map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} style={{ textTransform: 'capitalize' }}>{t(`reports.mode.${m}`)}</button>
          ))}
        </div>
        <div className="grow" />
        {/* The server exporter emits the daily rows it computed. In the weekly and
            monthly views the table is re-grouped here, so the file has to be too
            — otherwise the download would not match the screen it came from. */}
        <ExportBar title={title} subtitle={t('reports.service.exportSubtitle', { count: n(data.length) })}
          columns={columns} rows={data} filename={filename}
          exporter={mode === 'daily'
            ? (format) => api.reports.serviceSeries.export({ days, format, filename: `${filename}.${format}` })
            : null} />
      </div>

      {report.loading ? <Loading /> : report.error ? <LoadFailed error={report.error} onRetry={report.retry} /> : (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <StatCard icon={<IconChart size={18} />} label={t('reports.service.stat.served')} value={n(totals.served)} sub={t('reports.service.stat.servedSub', { count: n(totals.scheduled) })} />
            <StatCard icon={<IconChart size={18} />} tone="ok" label={t('reports.service.stat.efficiency')} value={percent(pct(totals.served, totals.scheduled))} sub={t('reports.service.stat.efficiencySub')} progress={pct(totals.served, totals.scheduled)} />
            <StatCard icon={<IconBill size={18} />} label={t('reports.service.stat.billed')} value={taka(totals.billed)} sub={t('reports.service.stat.billedSub', { count: n(data.length), mode: t(`reports.mode.${mode}`) })} />
            <StatCard icon={<IconBill size={18} />} tone="info" label={t('reports.service.stat.collected')} value={taka(totals.collected)} sub={t('reports.service.stat.collectedSub', { pct: percent(pct(totals.collected, totals.billed)) })} progress={pct(totals.collected, totals.billed)} />
          </div>

          <Section title={t('reports.service.chart')}>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chartData} margin={{ left: -10, right: 8, top: 6 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} tickFormatter={(v) => n(v)} />
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => [taka(v), t('reports.service.series')]} cursor={{ fill: 'var(--surface-2)' }} />
                <Bar dataKey="collected" name={t('reports.service.series')} radius={[6, 6, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={i % 2 ? 'var(--brand-600)' : 'var(--brand)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Section>

          <Section title={title} pad={false} actions={<span className="tiny muted">{t('reports.rows', { count: n(data.length) })}</span>}>
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.label}>
                      <td style={{ fontWeight: 600 }}>{labelFor(r.label)}</td>
                      <td className="mono">{n(r.scheduled)}</td>
                      <td className="mono">{n(r.served)}</td>
                      <td><span className={`badge ${pct(r.served, r.scheduled) >= 90 ? 'badge-ok' : 'badge-warn'}`}>{percent(pct(r.served, r.scheduled))}</span></td>
                      <td className="mono">{taka(r.billed)}</td>
                      <td className="mono">{taka(r.collected)}</td>
                      <td><span className={`badge ${pct(r.collected, r.billed) >= 80 ? 'badge-ok' : 'badge-warn'}`}>{percent(pct(r.collected, r.billed))}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('reports.service.note')}</div>
          </Section>
        </>
      )}
    </>
  )
}

/* ============ Customer reports: existing + potential, by ward / road ============ */
//
// Still computed in the browser: no server aggregate groups the customer register
// by ward or road, and both collections are already in memory for the Households
// screen. The reference lists come from /api/catalog/ through useData().
function CustomerReports() {
  const { t, n, taka, percent, date, optLabel, wardName } = useLang()
  const { households, potentialCustomers, tiers, potentialReasons, currentPractices, effectiveCharge } = useData()
  const [kind, setKind] = useState('existing') // existing | potential
  const [groupBy, setGroupBy] = useState('ward')

  const groups = useMemo(() => {
    const src = kind === 'existing' ? households : potentialCustomers
    const map = new Map()
    src.forEach((r) => {
      const key = groupBy === 'ward' ? r.ward : r.road
      const g = map.get(key) || { key, count: 0, active: 0, dues: 0, served: 0, revenue: 0, ward: r.ward }
      g.count += 1
      if (kind === 'existing') {
        if (r.status === 'active') g.active += 1
        g.dues += r.dues || 0
        if (r.lastVisit) g.served += 1
        g.revenue += effectiveCharge(r)
      } else {
        g.revenue += effectiveCharge(r)
      }
      map.set(key, g)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [kind, groupBy, households, potentialCustomers, effectiveCharge])

  // Ward names are official KCC records — they stay as seeded, in either language.
  const groupNoun = t(groupBy === 'ward' ? 'reports.group.ward' : 'reports.group.road')
  const groupNounPlural = t(groupBy === 'ward' ? 'reports.group.wards' : 'reports.group.roads')

  const existingCols = [
    { key: 'key', label: t(groupBy === 'ward' ? 'reports.col.ward' : 'reports.col.road'), get: (r) => groupBy === 'ward' ? wardName(r.key) : r.key },
    { key: 'count', label: t('reports.customers.col.households'), get: (r) => n(r.count) },
    { key: 'active', label: t('reports.customers.col.active'), get: (r) => n(r.active) },
    { key: 'served', label: t('reports.customers.col.serviced'), get: (r) => n(r.served) },
    { key: 'coverage', label: t('reports.customers.col.coverage'), get: (r) => percent(pct(r.served, r.count)) },
    { key: 'dues', label: t('reports.customers.col.dues'), get: (r) => n(r.dues) },
    { key: 'revenue', label: t('reports.customers.col.charge'), get: (r) => n(r.revenue) },
  ]
  const potentialCols = [
    { key: 'key', label: t(groupBy === 'ward' ? 'reports.col.ward' : 'reports.col.road'), get: (r) => groupBy === 'ward' ? wardName(r.key) : r.key },
    { key: 'count', label: t('reports.customers.col.potentialHomes'), get: (r) => n(r.count) },
    { key: 'revenue', label: t('reports.customers.col.estRevenue'), get: (r) => n(r.revenue) },
  ]
  // The detail register renders from these same arrays, so what is on screen and
  // what lands in the download cannot drift apart.
  const registerCols = [
    { key: 'id', label: t('reports.col.id') },
    { key: 'head', label: t('reports.col.head') },
    { key: 'ward', label: t('reports.col.ward'), get: (r) => wardName(r.ward) },
    { key: 'road', label: t('reports.col.road') },
    { key: 'holding', label: t('reports.col.holding') },
    { key: 'tier', label: t('reports.col.tier'), get: (r) => optLabel(tiers, r.tier) },
    { key: 'dues', label: t('reports.col.dues'), get: (r) => taka(r.dues > 0 ? r.dues : 0) },
    { key: 'status', label: t('reports.col.status'), get: (r) => t(`status.${r.status}`) },
  ]
  const surveyCols = [
    { key: 'id', label: t('reports.col.id') },
    { key: 'head', label: t('reports.col.head') },
    { key: 'ward', label: t('reports.col.ward'), get: (r) => wardName(r.ward) },
    { key: 'road', label: t('reports.col.road') },
    { key: 'holding', label: t('reports.col.holding') },
    { key: 'estTier', label: t('reports.col.estTier'), get: (r) => optLabel(tiers, r.estTier) },
    { key: 'estCharge', label: t('reports.col.estCharge'), get: (r) => taka(effectiveCharge(r)) },
    { key: 'reason', label: t('reports.col.reason'), get: (r) => optLabel(potentialReasons, r.reason) },
    { key: 'practice', label: t('reports.col.practice'), get: (r) => optLabel(currentPractices, r.currentPractice) },
    { key: 'surveyed', label: t('reports.col.surveyed'), get: (r) => date(r.surveyedAt) },
  ]
  const detailRows = kind === 'existing' ? households : potentialCustomers
  const detailCols = kind === 'existing' ? registerCols : surveyCols
  const detailTitle = t(kind === 'existing' ? 'reports.customers.registerTitle' : 'reports.customers.surveyTitle')

  const cols = kind === 'existing' ? existingCols : potentialCols
  const title = kind === 'existing'
    ? t('reports.customers.titleExisting', { group: groupNoun })
    : t('reports.customers.titlePotential', { group: groupNoun })

  const totCount = groups.reduce((a, g) => a + g.count, 0)
  const totRevenue = groups.reduce((a, g) => a + g.revenue, 0)
  const totDues = groups.reduce((a, g) => a + g.dues, 0)

  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          <button className={kind === 'existing' ? 'on' : ''} onClick={() => setKind('existing')}>{t('reports.customers.existing')}</button>
          <button className={kind === 'potential' ? 'on' : ''} onClick={() => setKind('potential')}>{t('reports.customers.potential')}</button>
        </div>
        <div className="seg">
          <button className={groupBy === 'ward' ? 'on' : ''} onClick={() => setGroupBy('ward')}>{t('reports.customers.byWard')}</button>
          <button className={groupBy === 'road' ? 'on' : ''} onClick={() => setGroupBy('road')}>{t('reports.customers.byRoad')}</button>
        </div>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCSV(`${kind}_by_${groupBy}`, groups, cols, { t })}><IconDownload size={15} /> {t('export.csv')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => printReport(title, tableToHTML(title, t('reports.customers.exportSubtitle'), cols, groups), { t })}><IconBill size={15} /> {t('export.pdf')}</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={kind === 'existing' ? <IconUsers size={18} /> : <IconHome size={18} />}
          label={t(kind === 'existing' ? 'reports.customers.stat.existing' : 'reports.customers.stat.potential')} value={n(totCount)}
          sub={t('reports.customers.stat.across', { count: n(groups.length), group: groupNounPlural })} />
        <StatCard icon={<IconBill size={18} />} tone={kind === 'existing' ? 'brand' : 'info'}
          label={t(kind === 'existing' ? 'reports.customers.stat.chargeValue' : 'reports.customers.stat.estRevenue')} value={taka(totRevenue)} sub={t('reports.customers.stat.atTiers')} />
        {kind === 'existing'
          ? <StatCard icon={<IconBill size={18} />} tone="warn" label={t('reports.customers.stat.dues')} value={taka(totDues)} sub={t('reports.customers.stat.duesSub')} />
          : <StatCard icon={<IconHome size={18} />} tone="warn" label={t('reports.customers.stat.uncharged')} value={n(totCount)} sub={t('reports.customers.stat.unchargedSub')} />}
        <StatCard icon={<IconChart size={18} />} tone="info" label={t(groupBy === 'ward' ? 'reports.customers.stat.wardsCovered' : 'reports.customers.stat.roadsCovered')} value={n(groups.length)} sub={t('reports.customers.stat.distinct')} />
      </div>

      <Section title={title} pad={false} actions={<span className="tiny muted">{t('reports.customers.summary', { groups: n(groups.length), records: n(totCount) })}</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ fontWeight: 600 }}>{groupBy === 'ward' ? wardName(g.key) : g.key}{groupBy === 'road' && <span className="tiny muted-3"> · {g.ward}</span>}</td>
                  {kind === 'existing' ? (
                    <>
                      <td className="mono">{n(g.count)}</td>
                      <td className="mono">{n(g.active)}</td>
                      <td className="mono">{n(g.served)}</td>
                      <td><span className={`badge ${pct(g.served, g.count) >= 90 ? 'badge-ok' : 'badge-warn'}`}>{percent(pct(g.served, g.count))}</span></td>
                      <td className="mono">{g.dues > 0 ? <b style={{ color: 'var(--danger)' }}>{taka(g.dues)}</b> : taka(0)}</td>
                      <td className="mono">{taka(g.revenue)}</td>
                    </>
                  ) : (
                    <>
                      <td className="mono">{n(g.count)}</td>
                      <td className="mono">{taka(g.revenue)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={detailTitle}
        pad={false}
        actions={(
          <div className="row gap-8">
            <span className="tiny muted">{t('common.records', { count: n(detailRows.length) })}</span>
            <ExportMenu
              title={detailTitle}
              subtitle={t('common.records', { count: n(detailRows.length) })}
              columns={detailCols}
              rows={detailRows}
              filename={kind === 'existing' ? 'customer_register' : 'potential_survey'}
            />
          </div>
        )}
      >
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{detailCols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {detailRows.map((r) => (
                <tr key={r.id}>
                  {detailCols.map((c) => {
                    const value = typeof c.get === 'function' ? c.get(r) : r[c.key]
                    if (c.key === 'id') return <td key={c.key} className="mono">{value}</td>
                    if (c.key === 'head') return <td key={c.key} style={{ fontWeight: 600 }}>{value}</td>
                    if (c.key === 'status') {
                      return (
                        <td key={c.key}>
                          <span className={`badge ${r.status === 'active' ? 'badge-ok' : 'badge-muted'}`}>{value}</span>
                        </td>
                      )
                    }
                    if (c.key === 'dues' || c.key === 'estCharge') return <td key={c.key} className="mono">{value}</td>
                    if (['road', 'tier', 'estTier', 'reason', 'practice'].includes(c.key)) return <td key={c.key} className="small">{value}</td>
                    if (c.key === 'surveyed') return <td key={c.key} className="small muted">{value}</td>
                    return <td key={c.key}>{value}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

/* ============ KPI scorecard ============ */
// target keeps the number the old "≥ 90%" / "< 24h" strings encoded, so the
// pass/fail test below is unchanged — only its rendering is localised.
const KPI_TARGETS = [
  { id: 'efficiency', target: 90, unit: '%', field: 'collectionEfficiency' },
  { id: 'chargeRate', target: 90, unit: '%', field: 'chargeRate' },
  { id: 'coverage', target: 95, unit: '%', field: 'coverage' },
  { id: 'complaints', target: 24, unit: 'h', field: 'complaintMedianH' },
  { id: 'onTime', target: 90, unit: '%', field: 'onTimeCompletion' },
  { id: 'fleet', target: 90, unit: '%', field: 'fleetAvailability' },
]
const meets = (r) => (r.unit === 'h' ? r.good : r.value >= r.target)

function KpiScorecard() {
  const { t, n, taka, percent, period } = useLang()
  const { api } = useData()
  const report = useReport(() => api.reports.kpis(), [api])

  const hours = (v) => t('reports.kpi.hours', { value: n(v) })
  const targetText = (r) => (r.unit === 'h'
    ? t('reports.kpi.targetUnder', { value: hours(r.target) })
    : t('reports.kpi.targetAtLeast', { value: percent(r.target) }))
  const valueText = (r) => (r.unit === 'h' ? hours(r.value) : percent(r.value))

  if (report.loading) return <Loading />
  if (report.error || !report.data) return <LoadFailed error={report.error} onRetry={report.retry} />

  const kpis = report.data
  // The endpoint returns the denominator behind each rate, so a percentage can
  // say what it is made of instead of asking the reader to trust it.
  const context = {
    efficiency: t('reports.kpi.of', { done: n(kpis.servedStops), total: n(kpis.scheduledStops) }),
    chargeRate: t('reports.kpi.of', { done: taka(kpis.received), total: taka(kpis.billed) }),
    coverage: t('reports.kpi.of', { done: n(kpis.coveredHouseholds), total: n(kpis.activeHouseholds) }),
  }
  const rows = KPI_TARGETS.map((r) => {
    const value = kpis[r.field] ?? 0
    return { ...r, value, good: r.unit === 'h' ? value < r.target : undefined }
  })

  return (
    <Section title={t('reports.kpi.title', { period: period(kpis.period) })} pad={false}
      actions={<button className="btn btn-ghost btn-sm" onClick={() => downloadCSV('kpi_scorecard', rows, [
        { key: 'kpi', label: t('reports.kpi.col.kpi'), get: (r) => t(`reports.kpi.${r.id}.name`) },
        { key: 'target', label: t('reports.kpi.col.target'), get: (r) => targetText(r) },
        { key: 'value', label: t('reports.kpi.col.current'), get: (r) => valueText(r) },
        { key: 'basis', label: t('reports.kpi.col.definition'), get: (r) => context[r.id] || '' },
        { key: 'ok', label: t('reports.kpi.col.status'), get: (r) => meets(r) ? t('reports.kpi.onTarget') : t('reports.kpi.below') },
      ], { t })}><IconDownload size={15} /> {t('reports.kpi.export')}</button>}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{t('reports.kpi.col.kpi')}</th><th>{t('reports.kpi.col.definition')}</th><th>{t('reports.kpi.col.target')}</th><th>{t('reports.kpi.col.current')}</th><th>{t('reports.kpi.col.status')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const ok = meets(r)
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{t(`reports.kpi.${r.id}.name`)}</td>
                  <td className="small muted">{t(`reports.kpi.${r.id}.def`)}</td>
                  <td className="mono">{targetText(r)}</td>
                  <td>
                    <b style={{ fontSize: 15 }}>{valueText(r)}</b>
                    {context[r.id] && <div className="tiny muted-3 mono">{context[r.id]}</div>}
                  </td>
                  <td><span className={ok ? 'badge badge-ok' : 'badge badge-warn'}><span className="dot" />{ok ? t('reports.kpi.onTarget') : t('reports.kpi.belowTarget')}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
