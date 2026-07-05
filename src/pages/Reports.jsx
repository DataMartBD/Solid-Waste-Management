import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { PageHeader, Section, StatCard } from '../components/ui.jsx'
import { IconChart, IconBill, IconDownload, IconHome, IconUsers } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { kpis, dailyCollection, tierCharge, tierLabel, wards, roadsByWard } from '../data/mockData.js'
import { downloadCSV, printReport, tableToHTML } from '../utils/export.js'

const money = (n) => `৳${Number(n).toLocaleString()}`
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)

// -------- period bucketing for service-collection report --------
function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

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

const monthName = (m) => new Date(m + '-01T00:00:00Z').toLocaleString('en', { month: 'long', year: 'numeric' })
const labelFor = (mode, label) => mode === 'monthly' ? monthName(label) : label

export default function Reports() {
  const [tab, setTab] = useState('service') // 'service' | 'customers' | 'kpi'
  return (
    <div className="fade-in">
      <PageHeader title="Reporting & Records" subtitle="Service collection, customer registers & KPI scorecards · exportable for KCC" />
      <div className="filter-bar">
        <div className="seg">
          <button className={tab === 'service' ? 'on' : ''} onClick={() => setTab('service')}>Service Collection</button>
          <button className={tab === 'customers' ? 'on' : ''} onClick={() => setTab('customers')}>Customers</button>
          <button className={tab === 'kpi' ? 'on' : ''} onClick={() => setTab('kpi')}>KPI Scorecard</button>
        </div>
      </div>
      {tab === 'service' && <ServiceCollection />}
      {tab === 'customers' && <CustomerReports />}
      {tab === 'kpi' && <KpiScorecard />}
    </div>
  )
}

/* ============ Service collection: daily / weekly / monthly ============ */
function ServiceCollection() {
  const [mode, setMode] = useState('daily')
  const data = useMemo(() => bucket(dailyCollection, mode).slice().reverse(), [mode])
  const totals = useMemo(() => data.reduce((a, r) => ({
    scheduled: a.scheduled + r.scheduled, served: a.served + r.served,
    billed: a.billed + r.billed, collected: a.collected + r.collected,
  }), { scheduled: 0, served: 0, billed: 0, collected: 0 }), [data])

  const chartData = data.slice(0, 12).reverse().map((r) => ({ label: labelFor(mode, r.label), collected: r.collected }))

  const columns = [
    { key: 'label', label: mode === 'monthly' ? 'Month' : mode === 'weekly' ? 'Week' : 'Date', get: (r) => labelFor(mode, r.label) },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'served', label: 'Served' },
    { key: 'eff', label: 'Efficiency %', get: (r) => pct(r.served, r.scheduled) + '%' },
    { key: 'billed', label: 'Billed (৳)', get: (r) => r.billed.toLocaleString() },
    { key: 'collected', label: 'Collected (৳)', get: (r) => r.collected.toLocaleString() },
    { key: 'rate', label: 'Charge rate %', get: (r) => pct(r.collected, r.billed) + '%' },
  ]

  const title = `${mode[0].toUpperCase() + mode.slice(1)} service collection report`
  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          {['daily', 'weekly', 'monthly'].map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} style={{ textTransform: 'capitalize' }}>{m}</button>
          ))}
        </div>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCSV(`service_collection_${mode}`, data, columns)}><IconDownload size={15} /> CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => printReport(title, tableToHTML(title, `Period buckets: ${data.length} · Smart Sweep SWMS`, columns, data))}><IconBill size={15} /> Print / PDF</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconChart size={18} />} label="Households served" value={totals.served.toLocaleString()} sub={`of ${totals.scheduled.toLocaleString()} scheduled`} />
        <StatCard icon={<IconChart size={18} />} tone="ok" label="Avg efficiency" value={`${pct(totals.served, totals.scheduled)}%`} sub="Served ÷ scheduled" progress={pct(totals.served, totals.scheduled)} />
        <StatCard icon={<IconBill size={18} />} label="Total billed" value={money(totals.billed)} sub={`${data.length} ${mode} buckets`} />
        <StatCard icon={<IconBill size={18} />} tone="info" label="Total collected" value={money(totals.collected)} sub={`${pct(totals.collected, totals.billed)}% charge rate`} progress={pct(totals.collected, totals.billed)} />
      </div>

      <Section title="Collected amount (৳) by period">
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={chartData} margin={{ left: -10, right: 8, top: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }} formatter={(v) => money(v)} cursor={{ fill: 'var(--surface-2)' }} />
            <Bar dataKey="collected" radius={[6, 6, 0, 0]}>
              {chartData.map((_, i) => <Cell key={i} fill={i % 2 ? 'var(--brand-600)' : 'var(--brand)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Section>

      <Section title={title} pad={false} actions={<span className="tiny muted">{data.length} rows</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.label}>
                  <td style={{ fontWeight: 600 }}>{labelFor(mode, r.label)}</td>
                  <td className="mono">{r.scheduled.toLocaleString()}</td>
                  <td className="mono">{r.served.toLocaleString()}</td>
                  <td><span className={`badge ${pct(r.served, r.scheduled) >= 90 ? 'badge-ok' : 'badge-warn'}`}>{pct(r.served, r.scheduled)}%</span></td>
                  <td className="mono">৳{r.billed.toLocaleString()}</td>
                  <td className="mono">৳{r.collected.toLocaleString()}</td>
                  <td><span className={`badge ${pct(r.collected, r.billed) >= 80 ? 'badge-ok' : 'badge-warn'}`}>{pct(r.collected, r.billed)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}

/* ============ Customer reports: existing + potential, by ward / road ============ */
function CustomerReports() {
  const { households, potentialCustomers } = useData()
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
        g.revenue += tierCharge(r.tier)
      } else {
        g.revenue += tierCharge(r.estTier)
      }
      map.set(key, g)
    })
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [kind, groupBy, households, potentialCustomers])

  const wardName = (id) => wards.find((w) => w.id === id)?.name || id

  const existingCols = [
    { key: 'key', label: groupBy === 'ward' ? 'Ward' : 'Road', get: (r) => groupBy === 'ward' ? wardName(r.key) : r.key },
    { key: 'count', label: 'Households' }, { key: 'active', label: 'Active' },
    { key: 'served', label: 'Serviced' },
    { key: 'coverage', label: 'Coverage %', get: (r) => pct(r.served, r.count) + '%' },
    { key: 'dues', label: 'Outstanding (৳)', get: (r) => r.dues.toLocaleString() },
    { key: 'revenue', label: 'Monthly charge (৳)', get: (r) => r.revenue.toLocaleString() },
  ]
  const potentialCols = [
    { key: 'key', label: groupBy === 'ward' ? 'Ward' : 'Road', get: (r) => groupBy === 'ward' ? wardName(r.key) : r.key },
    { key: 'count', label: 'Potential homes' },
    { key: 'revenue', label: 'Est. monthly revenue (৳)', get: (r) => r.revenue.toLocaleString() },
  ]
  const cols = kind === 'existing' ? existingCols : potentialCols
  const title = kind === 'existing' ? `Existing customers by ${groupBy}` : `Potential customers by ${groupBy}`

  const totCount = groups.reduce((a, g) => a + g.count, 0)
  const totRevenue = groups.reduce((a, g) => a + g.revenue, 0)
  const totDues = groups.reduce((a, g) => a + g.dues, 0)

  return (
    <>
      <div className="filter-bar">
        <div className="seg">
          <button className={kind === 'existing' ? 'on' : ''} onClick={() => setKind('existing')}>Existing customers</button>
          <button className={kind === 'potential' ? 'on' : ''} onClick={() => setKind('potential')}>Potential (ghost homes)</button>
        </div>
        <div className="seg">
          <button className={groupBy === 'ward' ? 'on' : ''} onClick={() => setGroupBy('ward')}>By ward</button>
          <button className={groupBy === 'road' ? 'on' : ''} onClick={() => setGroupBy('road')}>By road</button>
        </div>
        <div className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => downloadCSV(`${kind}_by_${groupBy}`, groups, cols)}><IconDownload size={15} /> CSV</button>
        <button className="btn btn-primary btn-sm" onClick={() => printReport(title, tableToHTML(title, 'Smart Sweep SWMS · customer register', cols, groups))}><IconBill size={15} /> Print / PDF</button>
      </div>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={kind === 'existing' ? <IconUsers size={18} /> : <IconHome size={18} />}
          label={kind === 'existing' ? 'Existing customers' : 'Potential customers'} value={totCount} sub={`across ${groups.length} ${groupBy}s`} />
        <StatCard icon={<IconBill size={18} />} tone={kind === 'existing' ? 'brand' : 'info'}
          label={kind === 'existing' ? 'Monthly charge value' : 'Est. new revenue'} value={money(totRevenue)} sub="per month at current tiers" />
        {kind === 'existing'
          ? <StatCard icon={<IconBill size={18} />} tone="warn" label="Outstanding dues" value={money(totDues)} sub="across all groups" />
          : <StatCard icon={<IconHome size={18} />} tone="warn" label="Uncharged homes" value={totCount} sub="surveyed, not yet billed" />}
        <StatCard icon={<IconChart size={18} />} tone="info" label={groupBy === 'ward' ? 'Wards covered' : 'Roads covered'} value={groups.length} sub="distinct groups" />
      </div>

      <Section title={title} pad={false} actions={<span className="tiny muted">{groups.length} groups · {totCount} records</span>}>
        <div className="table-wrap">
          <table className="data">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <td style={{ fontWeight: 600 }}>{groupBy === 'ward' ? wardName(g.key) : g.key}{groupBy === 'road' && <span className="tiny muted-3"> · {g.ward}</span>}</td>
                  {kind === 'existing' ? (
                    <>
                      <td className="mono">{g.count}</td>
                      <td className="mono">{g.active}</td>
                      <td className="mono">{g.served}</td>
                      <td><span className={`badge ${pct(g.served, g.count) >= 90 ? 'badge-ok' : 'badge-warn'}`}>{pct(g.served, g.count)}%</span></td>
                      <td className="mono">{g.dues > 0 ? <b style={{ color: 'var(--danger)' }}>৳{g.dues.toLocaleString()}</b> : '৳0'}</td>
                      <td className="mono">৳{g.revenue.toLocaleString()}</td>
                    </>
                  ) : (
                    <>
                      <td className="mono">{g.count}</td>
                      <td className="mono">৳{g.revenue.toLocaleString()}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={kind === 'existing' ? 'Customer register (detail)' : 'Surveyed potential customers (detail)'} pad={false}>
        <div className="table-wrap">
          {kind === 'existing' ? (
            <table className="data">
              <thead><tr><th>ID</th><th>Head</th><th>Ward</th><th>Road</th><th>Holding</th><th>Tier</th><th>Dues</th><th>Status</th></tr></thead>
              <tbody>
                {households.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{h.id}</td><td style={{ fontWeight: 600 }}>{h.head}</td>
                    <td>{h.ward}</td><td className="small">{h.road}</td><td>{h.holding}</td>
                    <td className="small">{tierLabel(h.tier)}</td>
                    <td className="mono">{h.dues > 0 ? `৳${h.dues}` : '৳0'}</td>
                    <td><span className={`badge ${h.status === 'active' ? 'badge-ok' : 'badge-muted'}`}>{h.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="data">
              <thead><tr><th>ID</th><th>Head</th><th>Ward</th><th>Road</th><th>Holding</th><th>Est. tier</th><th>Est. charge</th><th>Surveyed</th></tr></thead>
              <tbody>
                {potentialCustomers.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.id}</td><td style={{ fontWeight: 600 }}>{p.head}</td>
                    <td>{p.ward}</td><td className="small">{p.road}</td><td>{p.holding}</td>
                    <td className="small">{tierLabel(p.estTier)}</td>
                    <td className="mono">৳{tierCharge(p.estTier)}</td>
                    <td className="small muted">{p.surveyedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Section>
    </>
  )
}

/* ============ KPI scorecard ============ */
const KPI_ROWS = [
  { kpi: 'Collection efficiency', def: 'Households served on schedule ÷ scheduled', target: '≥ 90%', value: kpis.collectionEfficiency, unit: '%' },
  { kpi: 'Charge collection rate', def: 'Amount collected ÷ amount billed', target: '≥ 90%', value: kpis.chargeRate, unit: '%' },
  { kpi: 'Coverage', def: 'Verified visits ÷ registered', target: '≥ 95%', value: kpis.coverage, unit: '%' },
  { kpi: 'Complaint resolution', def: 'Median open → resolved', target: '< 24h', value: kpis.complaintMedianH, unit: 'h', good: kpis.complaintMedianH < 24 },
  { kpi: 'On-time route completion', def: 'Routes finished within window', target: '≥ 90%', value: kpis.onTimeCompletion, unit: '%' },
  { kpi: 'Fleet availability', def: 'Active vans ÷ total fleet', target: '≥ 90%', value: kpis.fleetAvailability, unit: '%' },
]
const meets = (r) => r.unit === 'h' ? r.good : r.value >= parseInt(r.target.replace(/\D/g, ''), 10)

function KpiScorecard() {
  return (
    <Section title="KPI scorecard — period 2026-07" pad={false}
      actions={<button className="btn btn-ghost btn-sm" onClick={() => downloadCSV('kpi_scorecard', KPI_ROWS, [
        { key: 'kpi', label: 'KPI' }, { key: 'target', label: 'Target' }, { key: 'value', label: 'Current', get: (r) => `${r.value}${r.unit}` }, { key: 'ok', label: 'Status', get: (r) => meets(r) ? 'on target' : 'below' },
      ])}><IconDownload size={15} /> Export</button>}>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>KPI</th><th>Definition</th><th>Target</th><th>Current</th><th>Status</th></tr></thead>
          <tbody>
            {KPI_ROWS.map((r) => {
              const ok = meets(r)
              return (
                <tr key={r.kpi}>
                  <td style={{ fontWeight: 600 }}>{r.kpi}</td>
                  <td className="small muted">{r.def}</td>
                  <td className="mono">{r.target}</td>
                  <td><b style={{ fontSize: 15 }}>{r.value}{r.unit}</b></td>
                  <td><span className={ok ? 'badge badge-ok' : 'badge badge-warn'}><span className="dot" />{ok ? 'on target' : 'below target'}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
