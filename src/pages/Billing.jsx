import { useState, useMemo, useEffect } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, Section, StatCard, Status, EmptyState, CHART_TOOLTIP } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconBill, IconCheck, IconClock, IconPlus, IconDownload, IconAlert } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { downloadCSV } from '../utils/export.js'

// The month the page opens on. The period used to be the hard-coded string
// '2026-07', which quietly became a historical view the moment the demo data
// aged; it is now a selector, and it defaults to whatever month it actually is.
function thisMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// Status filter chips reuse the shared status.* keys so a chip and the badge in
// the table always read as the same word.
const FILTERS = [['all', 'common.all'], ['paid', 'status.paid'], ['unpaid', 'status.unpaid'],
  ['partial', 'status.partial'], ['overdue', 'status.overdue']]

export default function Billing() {
  const { bills, paymentModes, ready, act, api } = useData()
  const { isAdmin } = useAuth()
  const { t, n, taka, percent, period: fmtPeriod, optLabel } = useLang()
  const [period, setPeriod] = useState(thisMonth)
  const [filter, setFilter] = useState('all')
  const [paying, setPaying] = useState(null)   // bill being paid
  const [preview, setPreview] = useState(null) // dry-run result awaiting confirmation
  const [rows, setRows] = useState([])
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Bumped after a write, to re-pull the rows and the totals together.
  const [writes, setWrites] = useState(0)

  // Months to offer. The loaded collection is the record of which months have
  // ever been billed; the current one is always offered even before its run.
  const periods = useMemo(() => {
    const seen = new Set(bills.map((b) => b.period).filter(Boolean))
    seen.add(thisMonth())
    seen.add(period)
    return [...seen].sort().reverse()
  }, [bills, period])

  // Rows and totals are fetched together, from the server, for one period. The
  // footer summing the visible rows in the browser is what let it disagree with
  // the Reports screens — every figure below is now one aggregate query.
  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.bills.list({ period, status: filter === 'all' ? undefined : filter }),
      // Deliberately not passed the status chip: the cards describe the month,
      // not the slice of it currently on screen.
      api.bills.summary({ period }),
    ])
      .then(([list, summary]) => {
        if (cancelled) return
        setRows(list)
        setTotals(summary)
        // Clear a stale banner: whatever failed last time has now succeeded.
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setRows([])
        setTotals(null)
        setError(err?.detail || t('billing.error.generic'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, ready, period, filter, writes, t])

  const billed = totals?.billed ?? 0
  const collected = totals?.received ?? 0
  const outstanding = totals?.outstanding ?? 0
  const rate = totals?.rate ?? 0

  const pie = [
    { name: t('billing.collected'), value: collected, fill: 'var(--brand)' },
    { name: t('billing.outstanding'), value: outstanding, fill: 'var(--warn)' },
  ]

  // Recording money is the only thing that moves a bill's status, so this is a
  // POST to /bills/{id}/pay/ and never a PATCH of `status`. Payments also move
  // the household's cached dues, which is why three collections are refreshed.
  async function recordPayment(bill, body) {
    setBusy(true)
    setError(null)
    const result = await act(api.bills.pay(bill.id, body), { refresh: ['bills', 'payments', 'households'] })
    setBusy(false)
    if (!result.ok) return result.error
    setPaying(null)
    setWrites((v) => v + 1)
    return null
  }

  // Issuing a month's charges, previewed first: `dryRun` writes nothing and
  // answers with the count and total, so an admin sees the size of the act
  // before committing to it.
  async function runGenerate(dryRun) {
    setBusy(true)
    setError(null)
    const result = await act(
      api.bills.generate({ period, dryRun }),
      dryRun ? {} : { refresh: ['bills', 'households'] },
    )
    setBusy(false)
    if (!result.ok) {
      setError(result.error?.fieldError?.('period') || result.error?.detail || t('billing.error.generic'))
      setPreview(null)
      return
    }
    if (dryRun) {
      setPreview(result.data)
      return
    }
    setPreview(null)
    setWrites((v) => v + 1)
  }

  function exportCsv() {
    downloadCSV(`billing_${period}`, rows, [
      { key: 'id', label: t('billing.col.billId') }, { key: 'head', label: t('billing.col.household') }, { key: 'ward', label: t('billing.col.ward') },
      { key: 'period', label: t('billing.col.period') }, { key: 'amount', label: t('billing.col.amountBdt') },
      // The real figures, not an estimate — a partial bill used to be exported as
      // half its amount because that is what the page assumed a partial meant.
      { key: 'received', label: t('billing.col.receivedBdt') },
      { key: 'outstanding', label: t('billing.col.outstandingBdt') },
      { key: 'method', label: t('billing.col.method'), get: (r) => (r.method ? optLabel(paymentModes, r.method) : '') },
      { key: 'status', label: t('billing.col.status'), get: (r) => t(`status.${r.status}`) },
    ], { t })
  }

  const nextUnpaid = rows.find((b) => b.outstanding > 0)

  return (
    <div className="fade-in">
      <PageHeader
        title={t('billing.title')}
        subtitle={t('billing.subtitle', { period: fmtPeriod(period) })}
        actions={<>
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> {t('billing.exportCsv')}</button>
          {/* Issuing charges is an agency-admin act — a supervisor collects, and
              the server refuses them here regardless of what the UI shows. */}
          {isAdmin && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => runGenerate(true)}>
              {busy ? <span className="spinner spinner-dark" /> : <><IconBill size={16} /> {t('billing.generate')}</>}
            </button>
          )}
          <button className="btn btn-primary" disabled={!nextUnpaid} onClick={() => setPaying(nextUnpaid)}>
            <IconPlus size={16} /> {t('billing.recordPayment')}
          </button>
        </>}
      />

      {error && (
        <div className="form-note bad" style={{ marginBottom: 16 }}>
          <IconAlert size={15} /> <span>{error}</span>
        </div>
      )}

      <div className="two-col" style={{ marginBottom: 24 }}>
        <div className="stat-grid">
          <StatCard icon={<IconBill size={18} />} label={t('billing.totalBilled')} value={taka(billed)} sub={t('billing.totalBilledSub', { count: n(totals?.bills ?? 0) })} />
          <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('billing.collected')} value={taka(collected)} sub={t('billing.collectedSub', { rate: percent(rate) })} progress={rate} />
          <StatCard icon={<IconClock size={18} />} tone="warn" label={t('billing.outstanding')} value={taka(outstanding)} sub={t('billing.outstandingSub', { partial: t('status.partial'), overdue: t('status.overdue') })} />
          <StatCard icon={<IconBill size={18} />} tone="info" label={t('billing.collectionRate')} value={percent(rate)} sub={t('billing.collectionRateSub', { target: percent(90) })} progress={rate} />
        </div>
        <Section title={t('billing.chartTitle')}>
          <div style={{ position: 'relative' }}>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pie} dataKey="value" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="none">
                  {pie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v) => taka(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{percent(rate)}</div>
              <div className="tiny muted">{t('billing.collectedLower')}</div>
            </div>
          </div>
          <div className="row gap-16" style={{ justifyContent: 'center' }}>
            <span className="tiny"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--brand)', marginRight: 5 }} />{t('billing.collected')}</span>
            <span className="tiny"><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: 'var(--warn)', marginRight: 5 }} />{t('billing.outstanding')}</span>
          </div>
        </Section>
      </div>

      <div className="filter-bar">
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(l)}</button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto' }} value={period} onChange={(e) => setPeriod(e.target.value)}
          aria-label={t('billing.col.period')}>
          {periods.map((p) => <option key={p} value={p}>{fmtPeriod(p)}</option>)}
        </select>
        <div className="grow" />
        <span className="tiny muted">{loading ? t('common.loading') : t('billing.billCount', { count: n(rows.length) })}</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('billing.col.billId')}</th><th>{t('billing.col.household')}</th><th>{t('billing.col.ward')}</th><th>{t('billing.col.period')}</th><th>{t('billing.col.amount')}</th><th>{t('billing.col.method')}</th><th>{t('billing.col.status')}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.id}</td>
                  <td style={{ fontWeight: 600 }}>{b.head}</td>
                  <td>{b.ward}</td>
                  <td className="mono">{fmtPeriod(b.period)}</td>
                  <td>
                    <b>{taka(b.amount)}</b>
                    {/* What has actually been received, from the payment rows. */}
                    {b.received > 0 && b.outstanding > 0 && (
                      <div className="tiny muted-3">{t('billing.receivedOf', { received: taka(b.received), due: taka(b.outstanding) })}</div>
                    )}
                  </td>
                  <td className="small">{b.method ? <span className="badge badge-info">{optLabel(paymentModes, b.method)}</span> : <span className="muted-3">—</span>}</td>
                  <td><Status value={b.status} /></td>
                  <td>
                    {b.outstanding > 0
                      ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPaying(b)}>{t('billing.recordPayment')}</button>
                      : <span className="tiny badge badge-ok"><IconCheck size={12} /> {t('billing.receipt')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !loading && <EmptyState>{t('billing.empty')}</EmptyState>}
        </div>
      </div>

      {paying && (
        <PaymentForm bill={paying} paymentModes={paymentModes} busy={busy}
          onClose={() => setPaying(null)} onSave={(body) => recordPayment(paying, body)} />
      )}

      {preview && (
        <GenerateBillsModal result={preview} busy={busy}
          onClose={() => setPreview(null)} onConfirm={() => runGenerate(false)} />
      )}
    </div>
  )
}

function PaymentForm({ bill, paymentModes, busy, onClose, onSave }) {
  const { t, taka, period, date, optLabel } = useLang()
  const [method, setMethod] = useState(bill.method || paymentModes[0]?.id || 'cash')
  // Part payment is the norm at the door, so the amount is editable — it just
  // starts at everything still owed. The server rejects an overpayment and names
  // the outstanding figure in the message.
  const [amount, setAmount] = useState(String(bill.outstanding))
  const [reference, setReference] = useState('')
  const [error, setError] = useState(null)
  const payments = bill.payments || []

  async function submit(e) {
    e.preventDefault()
    setError(null)
    const failure = await onSave({
      amount: Number(amount),
      method,
      reference: reference.trim(),
    })
    // The server names the outstanding figure when an amount overpays the bill,
    // so its message is shown verbatim rather than being paraphrased here.
    if (failure) setError(failure.fieldError?.('amount') || failure.detail || t('billing.error.generic'))
  }

  return (
    <Modal title={t('billing.recordPayment')} subtitle={`${bill.id} · ${bill.head}`} onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <dl className="kv" style={{ marginBottom: 16 }}>
          <dt>{t('billing.col.household')}</dt><dd>{bill.head} <span className="muted-3 mono">({bill.hh})</span></dd>
          <dt>{t('billing.col.period')}</dt><dd className="mono">{period(bill.period)}</dd>
          <dt>{t('billing.col.amount')}</dt><dd>{taka(bill.amount)}</dd>
          <dt>{t('billing.received')}</dt><dd>{taka(bill.received)}</dd>
          <dt>{t('billing.amountDue')}</dt><dd><b style={{ fontSize: 16 }}>{taka(bill.outstanding)}</b></dd>
        </dl>

        {/* Prior instalments, so nobody records the same money twice. */}
        {payments.length > 0 && (
          <div className="mt-8" style={{ marginBottom: 16 }}>
            <div className="tiny muted-3" style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              {t('billing.priorPayments')}
            </div>
            {payments.map((p) => (
              <div key={p.id} className="row between tiny" style={{ padding: '3px 0' }}>
                <span className="mono muted-3">{p.id}</span>
                <span>{taka(p.amount)} · {optLabel(paymentModes, p.method)} · {date(p.at)}</span>
              </div>
            ))}
          </div>
        )}

        <FormRow>
          <Field half type="number" min="1" max={bill.outstanding} label={t('billing.amountReceived')}
            value={amount} onChange={(e) => setAmount(e.target.value)}
            hint={t('billing.amountHint', { amount: taka(bill.outstanding) })} />
          <Field half as="select" label={t('billing.paymentMethod')} value={method} onChange={(e) => setMethod(e.target.value)}
            options={paymentModes.map((m) => ({ value: m.id, label: t(m.key) }))} />
        </FormRow>
        <Field label={t('billing.reference')} value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder={t('billing.referencePlaceholder')} hint={t('billing.referenceHint')} />

        {error && (
          <div className="form-note bad" style={{ marginTop: 12 }}>
            <IconAlert size={15} /> <span>{error}</span>
          </div>
        )}

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : <><IconCheck size={15} /> {t('billing.confirmPaid', { amount: taka(Number(amount) || 0) })}</>}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// The dry-run answer, shown as the confirmation step before charges are issued.
function GenerateBillsModal({ result, busy, onClose, onConfirm }) {
  const { t, n, taka, period, date } = useLang()
  const nothingToDo = result.created === 0

  return (
    <Modal title={t('billing.generateTitle', { period: period(result.period) })}
      subtitle={t('billing.generateSubtitle')} onClose={onClose} width={460}>
      <dl className="kv">
        <dt>{t('billing.generateNew')}</dt><dd><b style={{ fontSize: 16 }}>{n(result.created)}</b></dd>
        <dt>{t('billing.generateAmount')}</dt><dd>{taka(result.amount)}</dd>
        <dt>{t('billing.generateSkipped')}</dt><dd>{n(result.skipped)}</dd>
        <dt>{t('billing.generateMonthTotal')}</dt><dd>{taka(result.totalAmount)} · {t('billing.billCount', { count: n(result.billCount) })}</dd>
        <dt>{t('billing.generateDueOn')}</dt><dd>{date(result.dueOn)}</dd>
      </dl>
      <div className={`form-note ${nothingToDo ? 'ok' : 'info'}`} style={{ marginTop: 12 }}>
        <span>{nothingToDo ? t('billing.generateNone') : t('billing.generateHint', { count: n(result.created) })}</span>
      </div>
      <ModalActions>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={busy || nothingToDo} onClick={onConfirm}>
          {busy ? <span className="spinner" /> : t('billing.generateConfirm', { count: n(result.created) })}
        </button>
      </ModalActions>
    </Modal>
  )
}
