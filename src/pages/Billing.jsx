import { useState, useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, Section, StatCard, Status, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconBill, IconCheck, IconClock, IconPlus, IconDownload } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { downloadCSV } from '../utils/export.js'

const METHODS = ['cash', 'bkash', 'nagad', 'rocket', 'bank']

export default function Billing() {
  const { bills, upsert } = useData()
  const [filter, setFilter] = useState('all')
  const [paying, setPaying] = useState(null) // bill being paid

  const totals = useMemo(() => {
    const billed = bills.reduce((a, b) => a + b.amount, 0)
    const collected = bills.filter((b) => b.status === 'paid').reduce((a, b) => a + b.amount, 0)
      + bills.filter((b) => b.status === 'partial').reduce((a, b) => a + b.amount / 2, 0)
    return { billed, collected: Math.round(collected), outstanding: Math.round(billed - collected) }
  }, [bills])

  const pie = [
    { name: 'Collected', value: totals.collected, fill: 'var(--brand)' },
    { name: 'Outstanding', value: totals.outstanding, fill: 'var(--warn)' },
  ]
  const rate = totals.billed ? Math.round((totals.collected / totals.billed) * 100) : 0
  const rows = bills.filter((b) => filter === 'all' ? true : b.status === filter)

  function exportCsv() {
    downloadCSV('billing_2026-07', rows, [
      { key: 'id', label: 'Bill ID' }, { key: 'head', label: 'Household' }, { key: 'ward', label: 'Ward' },
      { key: 'period', label: 'Period' }, { key: 'amount', label: 'Amount (BDT)' },
      { key: 'method', label: 'Method' }, { key: 'status', label: 'Status' },
    ])
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Service Charge Collection"
        subtitle="Automated billing & reconciliation · period 2026-07"
        actions={<>
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> Export CSV</button>
          <button className="btn btn-primary" onClick={() => setPaying(rows.find((b) => b.status !== 'paid') || bills[0])}><IconPlus size={16} /> Record payment</button>
        </>}
      />

      <div className="two-col" style={{ marginBottom: 24 }}>
        <div className="stat-grid">
          <StatCard icon={<IconBill size={18} />} label="Total billed" value={`৳${totals.billed}`} sub={`${bills.length} households · this period`} />
          <StatCard icon={<IconCheck size={18} />} tone="ok" label="Collected" value={`৳${totals.collected}`} sub={`${rate}% collection rate`} progress={rate} />
          <StatCard icon={<IconClock size={18} />} tone="warn" label="Outstanding" value={`৳${totals.outstanding}`} sub="Dues + partial + overdue" />
          <StatCard icon={<IconBill size={18} />} tone="info" label="Collection rate" value={`${rate}%`} sub="Target ≥ 90%" progress={rate} />
        </div>
        <Section title="Billed vs collected">
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                  {pie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 13 }} formatter={(v) => `৳${v}`} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{rate}%</div>
              <div className="tiny muted">collected</div>
            </div>
          </div>
          <div className="row gap-16" style={{ justifyContent: 'center' }}>
            <span className="tiny"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--brand)', marginRight: 5 }} />Collected</span>
            <span className="tiny"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--warn)', marginRight: 5 }} />Outstanding</span>
          </div>
        </Section>
      </div>

      <div className="filter-bar">
        <div className="seg">
          {[['all', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid'], ['partial', 'Partial'], ['overdue', 'Overdue']].map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="grow" />
        <span className="tiny muted">{rows.length} bills</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Bill ID</th><th>Household</th><th>Ward</th><th>Period</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.id}</td>
                  <td style={{ fontWeight: 600 }}>{b.head}</td>
                  <td>{b.ward}</td>
                  <td className="mono">{b.period}</td>
                  <td><b>৳{b.amount}</b></td>
                  <td className="small">{b.method ? <span className="badge badge-info">{b.method}</span> : <span className="muted-3">—</span>}</td>
                  <td><Status value={b.status} /></td>
                  <td>
                    {b.status !== 'paid'
                      ? <button className="btn btn-ghost btn-sm" onClick={() => setPaying(b)}>Record payment</button>
                      : <span className="tiny badge badge-ok"><IconCheck size={12} /> receipt</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState>No bills in this view.</EmptyState>}
        </div>
      </div>

      {paying && (
        <PaymentForm bill={paying} onClose={() => setPaying(null)}
          onSave={({ method }) => { upsert('bills', { ...paying, status: 'paid', method }); setPaying(null) }} />
      )}
    </div>
  )
}

function PaymentForm({ bill, onClose, onSave }) {
  const [method, setMethod] = useState(bill.method || 'cash')
  return (
    <Modal title="Record payment" subtitle={`${bill.id} · ${bill.head}`} onClose={onClose} width={440}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ method }) }}>
        <dl className="kv" style={{ marginBottom: 16 }}>
          <dt>Household</dt><dd>{bill.head} <span className="muted-3 mono">({bill.hh})</span></dd>
          <dt>Period</dt><dd className="mono">{bill.period}</dd>
          <dt>Amount due</dt><dd><b style={{ fontSize: 16 }}>৳{bill.amount}</b></dd>
        </dl>
        <FormRow>
          <Field half as="select" label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => ({ value: m, label: m }))} />
          <Field half label="Receipt no." value={'R-' + bill.id.slice(-6)} readOnly />
        </FormRow>
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary"><IconCheck size={15} /> Confirm ৳{bill.amount} paid</button>
        </ModalActions>
      </form>
    </Modal>
  )
}
