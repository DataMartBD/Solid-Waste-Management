// Finance Reports — "Were customers billed, did they pay, and where is the money?"
// For the agency admin, the supervisor and the super admin (never the City Viewer).
//
// - Billing runs: bills per month and how they were paid; or one month by ward.
// - Bills by collector: billed, received, outstanding per collector and period.
// - Household collection: what each household was billed and paid, per period.
// - Household dues: unpaid bills per household — by the month's status
//   (paid / partial / unpaid / overdue), or by age (days past due).
// - Cash & deposits: cash collectors hold now, then a month's reconciliation
//   (collected → deposited → variance).
//
// The super admin's agency pick is sent with every request on every tab.

import { useState } from 'react'
import { PageHeader, Section, StatCard } from '../components/ui.jsx'
import { IconAlert, IconBill, IconCheck, IconClock } from '../components/Icons.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { ExportButtons, Failed, Loading } from './oversightParts.jsx'
import { Table, useLoad } from './Oversight.jsx'
import { AgencyPicker, TabBar } from './reportsShared.jsx'
import { BillsByCollector, Reconciliation } from './Reports.jsx'
import { CustomerBillStatus, CustomerCollection } from './ReportsCustomer.jsx'

const TABS = ['billing', 'bills', 'household', 'dues', 'cash']

export default function FinanceReports() {
  const { t } = useLang()
  const { agencies = [] } = useData()
  const { isSuperAdmin } = useAuth()
  const [tab, setTab] = useState('billing')
  const [agency, setAgency] = useState('')
  const extra = agency ? { agency } : {}
  return (
    <div className="fade-in">
      <PageHeader title={t('finance.title')} subtitle={t('finance.subtitle')}
        actions={isSuperAdmin && <AgencyPicker agencies={agencies} value={agency} onChange={setAgency} />} />
      <TabBar group={TABS} tab={tab} prefix="finance" onTab={setTab} />
      {tab === 'billing' && <BillingRuns extra={extra} />}
      {tab === 'bills' && <BillsByCollector key={agency} extra={extra} />}
      {tab === 'household' && <CustomerCollection key={agency} extra={extra} />}
      {tab === 'dues' && <HouseholdDues extra={extra} />}
      {tab === 'cash' && <CashAndDeposits extra={extra} />}
    </div>
  )
}

// Household dues: the month's status per household, or every unpaid bill by age.
function HouseholdDues({ extra }) {
  const { t } = useLang()
  const [view, setView] = useState('status')
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['status', 'age'].map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{t(`finance.dues.by.${v}`)}</button>)}
        </div>
      </div>
      {view === 'status' ? <CustomerBillStatus key={extra.agency || ''} extra={extra} /> : <DuesAgeing extra={extra} />}
    </>
  )
}

// Cash & deposits: what collectors hold now, then a month's reconciliation.
function CashAndDeposits({ extra }) {
  const { t } = useLang()
  return (
    <>
      <CashInHand extra={extra} />
      <div className="mt-24">
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{t('finance.cash.recon')}</h3>
        <Reconciliation key={extra.agency || ''} extra={extra} />
      </div>
    </>
  )
}

function BillingRuns({ extra }) {
  const { t, n, percent, taka, period: periodLabel } = useLang()
  const { api } = useData()
  const [month, setMonth] = useState('')
  const params = { ...extra, ...(month ? { period: month } : {}) }
  const report = useLoad(() => api.reports.agency.billingRuns.load(params), [api, month, extra.agency])
  const d = report.data
  const tone = (pct) => (pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'danger')
  const columns = [
    month
      ? { key: 'wardName', label: t('oversight.col.ward'), get: (r) => <b>{r.wardName}</b> }
      : { key: 'period', label: t('agencyReports.billing.month'), get: (r) => (
        <button className="btn btn-ghost btn-sm" onClick={() => setMonth(r.period)}>{periodLabel(r.period)}</button>) },
    { key: 'bills', label: t('agencyReports.dues.bills'), get: (r) => n(r.bills) },
    { key: 'amount', label: t('agencyReports.col.billed'), get: (r) => taka(r.amount) },
    { key: 'collected', label: t('agencyReports.col.received'), get: (r) => taka(r.collected) },
    { key: 'outstanding', label: t('agencyReports.dues.total'), get: (r) => <b>{taka(r.outstanding)}</b> },
    { key: 'collectionPct', label: t('agencyReports.col.collectionPct'), get: (r) => <span className={`badge badge-${tone(r.collectionPct)}`}>{percent(r.collectionPct)}</span> },
    { key: 'paid', label: t('agencyReports.billing.paid'), get: (r) => n(r.paid) },
    { key: 'partial', label: t('agencyReports.billing.partial'), get: (r) => n(r.partial) },
    { key: 'unpaid', label: t('agencyReports.billing.unpaid'), get: (r) => n(r.unpaid) },
  ]
  return (
    <>
      <div className="filter-bar">
        {month && <button className="btn btn-ghost btn-sm" onClick={() => setMonth('')}>{t('agencyReports.billing.allMonths')}</button>}
        <div className="grow" />
        <ExportButtons filename={month ? `billing_run_${month}` : 'billing_runs'} exporter={(p) => api.reports.agency.billingRuns.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconBill size={18} />} tone="brand" label={t('agencyReports.col.billed')} value={taka(d.totals.amount)}
            sub={t('agencyReports.billing.billsSub', { n: n(d.totals.bills) })} />
          <StatCard icon={<IconCheck size={18} />} tone={tone(d.totals.collectionPct)} label={t('agencyReports.col.collectionPct')}
            value={percent(d.totals.collectionPct)} sub={taka(d.totals.collected)} progress={d.totals.collectionPct} />
          <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('agencyReports.dues.total')} value={taka(d.totals.outstanding)} />
        </div>
      )}
      <Section title={month ? t('agencyReports.billing.byWard', { month: periodLabel(month) }) : t('agencyReports.tab.billing')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.period || r.ward} />}
        {!month && <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.billing.note')}</div>}
      </Section>
    </>
  )
}

function CashInHand({ extra }) {
  const { t, n, taka, date } = useLang()
  const { api } = useData()
  const report = useLoad(() => api.reports.agency.cashInHand.load(extra), [api, extra.agency])
  const d = report.data
  const tone = { ok: 'ok', late: 'warn', overdue: 'danger' }
  const columns = [
    { key: 'name', label: t('agencyReports.col.collector'), get: (r) => <b>{r.name}</b> },
    { key: 'phone', label: t('oversight.col.phone'), mono: true, get: (r) => r.phone || '—' },
    ...(extra.agency ? [] : [{ key: 'agency', label: t('oversight.col.agency'), get: (r) => r.agency || '—' }]),
    { key: 'amount', label: t('agencyReports.cash.amount'), get: (r) => <b>{taka(r.amount)}</b> },
    { key: 'payments', label: t('agencyReports.cash.payments'), get: (r) => n(r.payments) },
    { key: 'oldest', label: t('agencyReports.cash.oldest'), get: (r) => date(r.oldest) },
    { key: 'days', label: t('agencyReports.cash.days'), get: (r) => (
      <span className={`badge badge-${tone[r.status] || 'muted'}`}>{t(`agencyReports.cash.status.${r.status}`, { days: n(r.days) })}</span>) },
    { key: 'methods', label: t('agencyReports.cash.methods'), get: (r) => r.methods || '—' },
    { key: 'lastDeposit', label: t('agencyReports.cash.lastDeposit'), get: (r) => (r.lastDeposit ? date(r.lastDeposit) : t('agencyReports.cash.never')) },
  ]
  return (
    <>
      <div className="filter-bar">
        <div className="grow" />
        <ExportButtons filename="collector_cash_in_hand" exporter={(p) => api.reports.agency.cashInHand.export({ ...extra, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconBill size={18} />} tone="brand" label={t('agencyReports.cash.total')} value={taka(d.total)}
            sub={t('agencyReports.cash.totalSub', { n: n(d.collectors) })} />
          <StatCard icon={<IconAlert size={18} />} tone={d.overdue ? 'danger' : 'ok'} label={t('agencyReports.cash.overdue')}
            value={taka(d.overdue)} sub={t('agencyReports.cash.overdueSub', { days: n(d.overdueDays) })} />
        </div>
      )}
      <Section title={t('agencyReports.tab.cash')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.id} />}
        {d && <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.cash.note', { late: n(d.lateDays), overdue: n(d.overdueDays) })}</div>}
      </Section>
    </>
  )
}

const AGE_KEYS = ['notDue', 'd0_30', 'd31_60', 'd61_90', 'd90']

function DuesAgeing({ extra }) {
  const { t, n, taka, period } = useLang()
  const { api } = useData()
  const [by, setBy] = useState('holding')
  const params = { ...extra, by }
  const report = useLoad(() => api.reports.agency.duesAgeing.load(params), [api, by, extra.agency])
  const d = report.data
  const ageCell = (key) => (r) => (r[key] ? (key === 'd90' || key === 'd61_90'
    ? <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{taka(r[key])}</span> : taka(r[key])) : '—')
  const head = by === 'ward'
    ? [
        { key: 'wardName', label: t('oversight.col.ward'), get: (r) => <b>{r.wardName}</b> },
        { key: 'holdings', label: t('agencyReports.col.holdings'), get: (r) => n(r.holdings) },
      ]
    : [
        { key: 'holdingNo', label: t('agencyReports.dues.holding'), get: (r) => <b>{r.holdingNo}</b> },
        { key: 'owner', label: t('agencyReports.dues.owner'), get: (r) => r.owner || '—' },
        { key: 'phone', label: t('oversight.col.phone'), mono: true, get: (r) => r.phone || '—' },
        { key: 'road', label: t('agencyReports.dues.road'), get: (r) => `${r.road || '—'} · ${r.wardName || ''}` },
        { key: 'oldestPeriod', label: t('agencyReports.dues.oldest'), get: (r) => period(r.oldestPeriod) },
      ]
  const columns = [
    ...head,
    { key: 'bills', label: t('agencyReports.dues.bills'), get: (r) => n(r.bills) },
    ...AGE_KEYS.map((key) => ({ key, label: t(`agencyReports.dues.age.${key}`), get: ageCell(key) })),
    { key: 'outstanding', label: t('agencyReports.dues.total'), get: (r) => <b>{taka(r.outstanding)}</b> },
  ]
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['holding', 'ward'].map((g) => <button key={g} className={by === g ? 'on' : ''} onClick={() => setBy(g)}>{t(`agencyReports.dues.by.${g}`)}</button>)}
        </div>
        <div className="grow" />
        <ExportButtons filename={`dues_ageing_${by}`} exporter={(p) => api.reports.agency.duesAgeing.export({ ...params, ...p })} />
      </div>
      {d && (
        <div className="stat-grid" style={{ marginBottom: 20 }}>
          <StatCard icon={<IconBill size={18} />} tone="brand" label={t('agencyReports.dues.total')} value={taka(d.totals.outstanding)}
            sub={t('agencyReports.dues.asOf', { date: d.asOf })} />
          <StatCard icon={<IconClock size={18} />} tone="warn" label={t('agencyReports.dues.age.d31_60')} value={taka(d.totals.d31_60)} />
          <StatCard icon={<IconAlert size={18} />} tone={d.totals.d61_90 + d.totals.d90 ? 'danger' : 'ok'} label={t('agencyReports.dues.over60')}
            value={taka(d.totals.d61_90 + d.totals.d90)} sub={t('agencyReports.dues.over60Sub')} />
        </div>
      )}
      <Section title={t('agencyReports.tab.dues')} pad={false}>
        {report.loading ? <Loading /> : report.error ? <Failed error={report.error} onRetry={report.retry} />
          : <Table columns={columns} rows={d?.rows} rowKey={(r) => r.holding || r.ward} />}
        <div className="tiny muted-3" style={{ padding: '12px 20px' }}>{t('agencyReports.dues.note')}</div>
      </Section>
    </>
  )
}
