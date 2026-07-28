// Customer-wise reporting — the two lists a ward office actually acts on.
//
//   1. Bill collection per household, at daily / weekly / monthly / yearly
//      granularity: who was billed what, and what came back.
//   2. Bill status per household for one billing month: paid, partial, unpaid
//      or overdue, derived from the payments on record rather than from a
//      stored flag that can go stale — and "overdue" now comes from the bill's
//      due date, so a bill cannot claim to be current after its deadline.
//
// Both come from /api/reports/customer-collection/ and
// /api/reports/customer-bill-status/, which return the same row keys these
// tables have always rendered, plus the footer `totals` and the settlement
// `tally`. The stat cards, the table and the exported document are therefore
// three renderings of one server-side aggregate and cannot disagree.
//
// Reports are ward-scoped to the signed-in user by the server. The ward picker
// below narrows what is already visible; it cannot widen it.
//
// Identifiers (household, bill and collector ids, holding numbers) are printed
// exactly as stored — they are searched, cross-referenced against paper files
// and read out over the phone, so their digits are never transliterated. Money,
// counts, rates and dates are localised.

import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Section, StatCard, Status, EmptyState } from '../components/ui.jsx'
import {
  IconBill, IconUsers, IconCheck, IconClock, IconChart, IconAlert, IconSearch,
  IconDownload, IconEye, IconRefresh,
} from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang, toLatinDigits } from '../i18n/index.jsx'
import { downloadCSV, downloadExcel, printReport, viewReport, tableToHTML } from '../utils/export.js'
import { REPORT_MODES, BILL_STATES, totalsOf, stateTally } from '../utils/reports.js'

/* ============ shared request plumbing ============ */

// One GET, three states. A failed request shows the server's message with a
// retry rather than an empty table, which would read as "nobody owes anything".
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

// Export buttons backed by the report endpoint itself (`?format=…`). Pass a null
// `exporter` when the table has been narrowed here — the server would return the
// unfiltered rows, and a download that disagrees with the screen is worse than a
// locally built one.
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
      {failed && <span className="tiny" style={{ color: 'var(--danger)' }}>{failed.detail || failed.message}</span>}
    </>
  )
}

export default function ReportsCustomer() {
  const { t } = useLang()
  const [tab, setTab] = useState('collection') // 'collection' | 'status'

  return (
    <div className="fade-in">
      <PageHeader title={t('reportsCustomer.title')} subtitle={t('reportsCustomer.subtitle')} />
      <div className="filter-bar">
        <div className="seg">
          <button className={tab === 'collection' ? 'on' : ''} onClick={() => setTab('collection')}>
            {t('reportsCustomer.tab.collection')}
          </button>
          <button className={tab === 'status' ? 'on' : ''} onClick={() => setTab('status')}>
            {t('reportsCustomer.tab.status')}
          </button>
        </div>
      </div>
      {tab === 'collection' ? <CustomerCollection /> : <CustomerBillStatus />}
    </div>
  )
}

/* ============ 1. Bill collection, customer-wise ============ */

function CustomerCollection() {
  const { api, wards } = useData()
  const { t, n, taka, percent, date, period: fmtPeriod, digits, wardName } = useLang()
  const [mode, setMode] = useState('monthly')
  const [bucket, setBucket] = useState('all')
  const [ward, setWard] = useState('all')
  const [q, setQ] = useState('')

  const report = useReport(() => api.reports.customerCollection.load({ mode }), [api, mode])
  const all = useMemo(() => report.data?.rows || [], [report.data])

  // The picker only offers buckets that exist in the data, newest first, so an
  // empty month can never be selected.
  const buckets = useMemo(
    () => [...new Set(all.map((r) => r.period))].sort().reverse(),
    [all],
  )
  // Switching granularity invalidates the old bucket key ("2026-07" is not a
  // valid daily bucket), so fall back to every period rather than showing none.
  const activeBucket = bucket !== 'all' && buckets.includes(bucket) ? bucket : 'all'

  // Bangla numerals are accepted in the box — a holding typed as ১৪২ must find
  // the holding stored as 142.
  const needle = toLatinDigits(q).trim().toLowerCase()
  const rows = useMemo(() => all.filter((r) => {
    if (activeBucket !== 'all' && r.period !== activeBucket) return false
    if (ward !== 'all' && r.ward !== ward) return false
    if (!needle) return true
    return [r.head, r.holding, r.road, r.hh]
      .some((v) => String(v ?? '').toLowerCase().includes(needle))
  }), [all, activeBucket, ward, needle])

  const filtered = rows.length !== all.length
  // The server's totals cover everything it returned; once a period, ward or
  // search filter narrows the table they would overstate it.
  const totals = useMemo(
    () => (filtered || !report.data?.totals ? totalsOf(rows) : report.data.totals),
    [filtered, report.data, rows],
  )
  const billCount = rows.reduce((a, r) => a + (r.bills || 0), 0)
  const payCount = rows.reduce((a, r) => a + (r.payments || 0), 0)

  // Bucket keys stay machine-readable; only the label is localised.
  const periodLabel = (key) => {
    if (!key) return t('common.none')
    if (mode === 'yearly') return digits(key)
    if (mode === 'monthly') return fmtPeriod(key)
    if (mode === 'weekly') {
      const [year, week] = String(key).split('-W')
      return t('reportsCustomer.weekLabel', { week: n(Number(week)), year: digits(year) })
    }
    return date(key)
  }

  const columns = [
    { key: 'period', label: t('reportsCustomer.col.period'), get: (r) => periodLabel(r.period) },
    { key: 'head', label: t('reportsCustomer.col.household'), get: (r) => `${r.head} (${r.hh})` },
    { key: 'ward', label: t('reportsCustomer.col.ward'), get: (r) => wardName(r.ward) },
    { key: 'holding', label: t('reportsCustomer.col.holding'), get: (r) => r.holding || '—' },
    { key: 'billed', label: t('reportsCustomer.col.billed'), get: (r) => taka(r.billed) },
    { key: 'received', label: t('reportsCustomer.col.received'), get: (r) => taka(r.received) },
    { key: 'outstanding', label: t('reportsCustomer.col.outstanding'), get: (r) => taka(r.outstanding) },
    { key: 'rate', label: t('reportsCustomer.col.rate'), get: (r) => percent(r.rate) },
  ]

  const scopeLabel = activeBucket === 'all' ? t('reportsCustomer.allPeriods') : periodLabel(activeBucket)
  const title = t('reportsCustomer.export.collectionTitle', {
    mode: t(`reportsCustomer.mode.${mode}`),
    period: scopeLabel,
  })
  const filename = `bill_collection_customer_${mode}_${activeBucket}`

  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {REPORT_MODES.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {t(`reportsCustomer.mode.${m}`)}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto' }} value={activeBucket}
          onChange={(e) => setBucket(e.target.value)} aria-label={t('reportsCustomer.col.period')}>
          <option value="all">{t('reportsCustomer.allPeriods')}</option>
          {buckets.map((b) => <option key={b} value={b}>{periodLabel(b)}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={ward}
          onChange={(e) => setWard(e.target.value)} aria-label={t('reportsCustomer.col.ward')}>
          <option value="all">{t('reportsCustomer.allWards')}</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{wardName(w.id)}</option>)}
        </select>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('reportsCustomer.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grow" />
        <ExportBar
          title={title}
          subtitle={t('reportsCustomer.export.subtitle', {
            count: n(rows.length),
            scope: ward === 'all' ? t('reportsCustomer.allWards') : wardName(ward),
          })}
          columns={columns}
          rows={rows}
          filename={filename}
          exporter={filtered
            ? null
            : (format) => api.reports.customerCollection.export({ mode, format, filename: `${filename}.${format}` })}
        />
      </div>

      {report.loading ? <Loading /> : report.error ? <LoadFailed error={report.error} onRetry={report.retry} /> : (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <StatCard icon={<IconUsers size={18} />} label={t('reportsCustomer.stat.customers')}
              value={n(new Set(rows.map((r) => r.hh)).size)}
              sub={t('reportsCustomer.stat.customersSub', { count: n(rows.length) })} />
            <StatCard icon={<IconBill size={18} />} label={t('reportsCustomer.stat.billed')}
              value={taka(totals.billed)} sub={t('reportsCustomer.stat.billedSub', { count: n(billCount) })} />
            <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('reportsCustomer.stat.received')}
              value={taka(totals.received)} sub={t('reportsCustomer.stat.receivedSub', { count: n(payCount) })} />
            <StatCard icon={<IconClock size={18} />} tone="warn" label={t('reportsCustomer.stat.outstanding')}
              value={taka(totals.outstanding)} sub={t('reportsCustomer.stat.outstandingSub')} />
            <StatCard icon={<IconChart size={18} />} tone="info" label={t('reportsCustomer.stat.rate')}
              value={percent(totals.rate)} sub={t('reportsCustomer.stat.rateSub')} progress={totals.rate} />
          </div>

          <Section
            title={t('reportsCustomer.collection.title')}
            pad={false}
            actions={<span className="tiny muted">{t('reportsCustomer.rows', { count: n(rows.length) })}</span>}
          >
            <div className="muted small" style={{ padding: '12px 20px 0' }}>
              {t('reportsCustomer.collection.subtitle', { mode: t(`reportsCustomer.mode.${mode}`) })}
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.period}|${r.hh}`}>
                      <td style={{ fontWeight: 600 }}>{periodLabel(r.period)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.head}</div>
                        <div className="tiny muted-3 mono">{r.hh}</div>
                      </td>
                      <td className="small">{wardName(r.ward)}</td>
                      <td className="mono">{r.holding || '—'}</td>
                      <td className="mono">{taka(r.billed)}</td>
                      <td className="mono">{taka(r.received)}</td>
                      <td className="mono">
                        {r.outstanding > 0
                          ? <b style={{ color: 'var(--danger)' }}>{taka(r.outstanding)}</b>
                          : taka(0)}
                      </td>
                      <td>
                        <span className={`badge ${r.rate >= 80 ? 'badge-ok' : r.rate > 0 ? 'badge-warn' : 'badge-danger'}`}>
                          {percent(r.rate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <EmptyState>{t('reportsCustomer.empty')}</EmptyState>}
            </div>
          </Section>
        </>
      )}
    </>
  )
}

/* ============ 2. Bill status, customer-wise ============ */

const STATE_TONE = { paid: 'ok', partial: 'info', unpaid: 'warn', overdue: 'danger' }
const STATE_ICON = { paid: IconCheck, partial: IconBill, unpaid: IconClock, overdue: IconAlert }

function CustomerBillStatus() {
  const { api, bills, paymentModes, collectorName } = useData()
  const { t, n, taka, percent, period: fmtPeriod, wardName, optLabel } = useLang()

  // Only months that actually carry bills, newest first.
  const months = useMemo(
    () => [...new Set(bills.map((b) => b.period).filter(Boolean))].sort().reverse(),
    [bills],
  )
  const [month, setMonth] = useState(null)
  const period = month && months.includes(month) ? month : months[0] || null
  const [state, setState] = useState('all')

  const report = useReport(
    () => api.reports.customerBillStatus.load({ period }),
    [api, period],
    { skip: !period },
  )

  const all = useMemo(() => report.data?.rows || [], [report.data])
  // The server tallies every bill in the month; only fall back to counting here
  // if the payload predates that field.
  const tally = useMemo(() => report.data?.tally || stateTally(all), [report.data, all])
  const rows = useMemo(() => (state === 'all' ? all : all.filter((r) => r.state === state)), [all, state])
  const totals = useMemo(
    () => (state === 'all' && report.data?.totals ? report.data.totals : totalsOf(rows)),
    [state, report.data, rows],
  )

  const columns = [
    { key: 'bill', label: t('reportsCustomer.col.billId'), get: (r) => r.bill },
    { key: 'head', label: t('reportsCustomer.col.household'), get: (r) => `${r.head} (${r.hh})` },
    { key: 'ward', label: t('reportsCustomer.col.ward'), get: (r) => wardName(r.ward) },
    { key: 'holding', label: t('reportsCustomer.col.holding'), get: (r) => r.holding || '—' },
    { key: 'collector', label: t('reportsCustomer.col.collector'), get: (r) => (r.collector ? collectorName(r.collector) : '—') },
    { key: 'billed', label: t('reportsCustomer.col.billed'), get: (r) => taka(r.billed) },
    { key: 'received', label: t('reportsCustomer.col.received'), get: (r) => taka(r.received) },
    { key: 'outstanding', label: t('reportsCustomer.col.outstanding'), get: (r) => taka(r.outstanding) },
    { key: 'state', label: t('reportsCustomer.col.state'), get: (r) => t(`status.${r.state}`) },
    { key: 'method', label: t('reportsCustomer.col.method'), get: (r) => (r.method ? optLabel(paymentModes, r.method) : '—') },
  ]

  const periodLabel = period ? fmtPeriod(period) : t('common.none')
  const title = t('reportsCustomer.export.statusTitle', { period: periodLabel })
  const filename = `bill_status_customer_${period || 'all'}${state === 'all' ? '' : `_${state}`}`

  return (
    <>
      <div className="filter-bar">
        <select className="select" style={{ width: 'auto' }} value={period || ''}
          onChange={(e) => setMonth(e.target.value)} aria-label={t('reportsCustomer.col.period')}>
          {months.map((m) => <option key={m} value={m}>{fmtPeriod(m)}</option>)}
        </select>
        <div className="seg">
          <button className={state === 'all' ? 'on' : ''} onClick={() => setState('all')}>
            {t('reportsCustomer.chip', { label: t('common.all'), count: n(all.length) })}
          </button>
          {BILL_STATES.map((s) => (
            <button key={s} className={state === s ? 'on' : ''} onClick={() => setState(s)}>
              {t('reportsCustomer.chip', { label: t(`status.${s}`), count: n(tally[s]) })}
            </button>
          ))}
        </div>
        <div className="grow" />
        <ExportBar
          title={title}
          subtitle={t('reportsCustomer.export.subtitle', {
            count: n(rows.length),
            scope: state === 'all' ? t('common.all') : t(`status.${state}`),
          })}
          columns={columns}
          rows={rows}
          filename={filename}
          exporter={state === 'all' && period
            ? (format) => api.reports.customerBillStatus.export({ period, format, filename: `${filename}.${format}` })
            : null}
        />
      </div>

      {!period ? <EmptyState>{t('reportsCustomer.empty')}</EmptyState>
        : report.loading ? <Loading />
          : report.error ? <LoadFailed error={report.error} onRetry={report.retry} /> : (
            <>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                {BILL_STATES.map((s) => {
                  const Icon = STATE_ICON[s]
                  return (
                    <StatCard key={s} icon={<Icon size={18} />} tone={STATE_TONE[s]}
                      label={t(`status.${s}`)} value={n(tally[s])}
                      sub={t('reportsCustomer.stat.ofBills', { count: n(tally[s]), total: n(all.length) })}
                      progress={all.length ? Math.round((tally[s] / all.length) * 100) : 0} />
                  )
                })}
              </div>

              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <StatCard icon={<IconBill size={18} />} label={t('reportsCustomer.stat.bills')}
                  value={n(totals.count)} sub={t('reportsCustomer.stat.billsSub', { period: periodLabel })} />
                <StatCard icon={<IconBill size={18} />} label={t('reportsCustomer.stat.billed')}
                  value={taka(totals.billed)} sub={t('reportsCustomer.stat.billedSub', { count: n(totals.count) })} />
                <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('reportsCustomer.stat.received')}
                  value={taka(totals.received)} sub={t('reportsCustomer.stat.rateSub')} />
                <StatCard icon={<IconClock size={18} />} tone="warn" label={t('reportsCustomer.stat.outstanding')}
                  value={taka(totals.outstanding)} sub={t('reportsCustomer.stat.outstandingSub')} />
                <StatCard icon={<IconChart size={18} />} tone="info" label={t('reportsCustomer.stat.rate')}
                  value={percent(totals.rate)} sub={t('reportsCustomer.stat.rateSub')} progress={totals.rate} />
              </div>

              <Section
                title={t('reportsCustomer.status.title')}
                pad={false}
                actions={<span className="tiny muted">{t('reportsCustomer.rows', { count: n(rows.length) })}</span>}
              >
                <div className="muted small" style={{ padding: '12px 20px 0' }}>
                  {t('reportsCustomer.status.subtitle', { period: periodLabel })}
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.bill}>
                          <td className="mono">{r.bill}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{r.head}</div>
                            <div className="tiny muted-3 mono">{r.hh}</div>
                          </td>
                          <td className="small">{wardName(r.ward)}</td>
                          <td className="mono">{r.holding || '—'}</td>
                          <td className="small">{r.collector ? collectorName(r.collector) : <span className="muted-3">—</span>}</td>
                          <td className="mono">{taka(r.billed)}</td>
                          <td className="mono">{taka(r.received)}</td>
                          <td className="mono">
                            {r.outstanding > 0
                              ? <b style={{ color: 'var(--danger)' }}>{taka(r.outstanding)}</b>
                              : taka(0)}
                          </td>
                          <td><Status value={r.state} /></td>
                          <td className="small">
                            {r.method
                              ? <span className="badge badge-info">{optLabel(paymentModes, r.method)}</span>
                              : <span className="muted-3">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && <EmptyState>{t('reportsCustomer.empty')}</EmptyState>}
                </div>
              </Section>
            </>
          )}
    </>
  )
}
