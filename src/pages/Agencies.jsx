import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { agencies as api, remittances as remitApi } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { IconUsers, IconPlus, IconCheck, IconAlert, IconSearch, IconBill } from '../components/Icons.jsx'

const STATUS_TONES = { active: 'ok', suspended: 'warn', expired: 'muted', terminated: 'muted' }

//: The current month, which is what a remittance is nearly always against.
const THIS_PERIOD = new Date().toISOString().slice(0, 7)

export default function Agencies() {
  const { t, n, taka } = useLang()
  const { canWrite } = useAuth()
  const { wards, paymentModes, optLabel } = useData()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState(null)     // agency row, or {} for new
  const [expanded, setExpanded] = useState(null)   // agency id whose staff are shown
  const [staff, setStaff] = useState({})
  const [remitting, setRemitting] = useState(null) // agency the remittance modal is for

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.list({ search: query || undefined, status: status || undefined })
      setRows(Array.isArray(data) ? data : data.results || [])
      setError('')
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [query, status, t])

  useEffect(() => { load() }, [load])

  async function openStaff(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!staff[id]) {
      try {
        const data = await api.collectors(id)
        setStaff((s) => ({ ...s, [id]: Array.isArray(data) ? data : [] }))
      } catch {
        setStaff((s) => ({ ...s, [id]: [] }))
      }
    }
  }

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    expiring: rows.filter((r) => r.contractExpired).length,
    collectors: rows.reduce((sum, r) => sum + (r.collectorCount || 0), 0),
  }), [rows])

  const exportColumns = [
    { key: 'id', label: t('agencies.col.id') },
    { key: 'shortCode', label: t('agencies.col.code') },
    { key: 'name', label: t('agencies.col.name') },
    { key: 'agencyType', label: t('agencies.col.type') },
    { key: 'contactPerson', label: t('agencies.col.contact') },
    { key: 'phone', label: t('agencies.col.phone') },
    { key: 'collectorCount', label: t('agencies.col.collectors') },
    { key: 'holdingCount', label: t('agencies.col.holdings') },
    { key: 'contractEnd', label: t('agencies.col.contractEnd') },
    { key: 'status', label: t('agencies.col.status') },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        title={t('agencies.title')}
        subtitle={t('agencies.subtitle', { count: n(stats.total), collectors: n(stats.collectors) })}
        actions={<>
          <ExportMenu
            title={t('agencies.title')}
            subtitle={t('common.records', { count: n(rows.length) })}
            columns={exportColumns}
            rows={rows}
            filename="agencies"
          />
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <IconPlus size={16} /> {t('agencies.register')}
            </button>
          )}
        </>}
      />

      <div className="stat-grid">
        <StatCard icon={<IconUsers size={18} />} label={t('agencies.stat.total')} value={n(stats.total)} sub={t('agencies.stat.totalSub')} />
        <StatCard icon={<IconCheck size={18} />} label={t('agencies.stat.active')} value={n(stats.active)} sub={t('agencies.stat.activeSub')} tone="ok" />
        <StatCard icon={<IconAlert size={18} />} label={t('agencies.stat.expired')} value={n(stats.expiring)} sub={t('agencies.stat.expiredSub')} tone="warn" />
        <StatCard icon={<IconUsers size={18} />} label={t('agencies.stat.collectors')} value={n(stats.collectors)} sub={t('agencies.stat.collectorsSub')} />
      </div>

      <div className="row gap-8 wrap" style={{ margin: '18px 0 12px' }}>
        <div className="seg">
          {[
            ['', t('agencies.filter.all', { count: n(stats.total) })],
            ['active', t('opt.agencyStatus.active')],
            ['suspended', t('opt.agencyStatus.suspended')],
            ['expired', t('opt.agencyStatus.expired')],
          ].map(([k, label]) => (
            <button key={k || 'all'} type="button" className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{label}</button>
          ))}
        </div>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('agencies.searchPlaceholder')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="grow" />
        <span className="tiny muted">{t('common.shown', { count: n(rows.length) })}</span>
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('agencies.col.id')}</th>
                <th>{t('agencies.col.name')}</th>
                <th>{t('agencies.col.type')}</th>
                <th>{t('agencies.col.contact')}</th>
                <th>{t('agencies.col.collectors')}</th>
                <th>{t('agencies.col.holdings')}</th>
                <th>{t('agencies.col.contractEnd')}</th>
                <th>{t('agencies.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AgencyRow
                  key={row.id}
                  row={row}
                  open={expanded === row.id}
                  staff={staff[row.id]}
                  onToggle={() => openStaff(row.id)}
                  onEdit={canWrite ? () => setEditing(row) : null}
                  onRemit={canWrite ? () => setRemitting(row) : null}
                  t={t}
                  n={n}
                />
              ))}
            </tbody>
          </table>
        </div>
        {loading && <div className="muted small" style={{ padding: 16 }}>{t('common.loading')}</div>}
        {!loading && rows.length === 0 && <EmptyState>{t('agencies.empty')}</EmptyState>}
      </div>

      {editing && (
        <AgencyForm
          agency={editing}
          wards={wards}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      {remitting && (
        <RemittanceModal
          agency={remitting}
          paymentModes={paymentModes}
          optLabel={optLabel}
          taka={taka}
          onClose={() => setRemitting(null)}
          onSaved={() => { setRemitting(null); load() }}
        />
      )}
    </div>
  )
}

function AgencyRow({ row, open, staff, onToggle, onEdit, onRemit, t, n }) {
  return (
    <>
      <tr>
        <td className="mono">{row.id}</td>
        <td style={{ fontWeight: 600 }}>
          {row.name}
          <div className="tiny muted-3 mono" style={{ fontWeight: 500 }}>{row.shortCode}</div>
        </td>
        <td className="small">{t(`opt.agencyType.${row.agencyType}`)}</td>
        <td>
          <div>{row.contactPerson || '—'}</div>
          {row.phone && <div className="tiny muted-3 mono">{row.phone}</div>}
        </td>
        <td>
          <button type="button" className="link-btn" onClick={onToggle}>
            {t('agencies.collectorCount', { count: n(row.collectorCount || 0) })}
          </button>
        </td>
        <td>{n(row.holdingCount || 0)}</td>
        <td className="small">
          {row.contractEnd || '—'}
          {row.contractExpired && (
            <div className="tiny" style={{ color: 'var(--warn-fg)' }}>{t('agencies.expired')}</div>
          )}
        </td>
        <td>
          <span className={`badge badge-${STATUS_TONES[row.status] || 'muted'}`}>
            <span className="dot" />{t(`opt.agencyStatus.${row.status}`)}
          </span>
        </td>
        <td style={{ textAlign: 'right' }}>
          <div className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
            {onRemit && (
              <button type="button" className="act-btn" title={t('agencies.recordRemittance')} onClick={onRemit}>
                <IconBill size={16} />
              </button>
            )}
            {onEdit && <button type="button" className="link-btn" onClick={onEdit}>{t('common.edit')}</button>}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--surface-2)' }}>
            {!staff && <span className="tiny muted-3">{t('common.loading')}</span>}
            {staff && staff.length === 0 && (
              <span className="tiny muted-3">{t('agencies.noCollectors')}</span>
            )}
            {staff && staff.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {staff.map((c) => (
                  <li key={c.id} className="small">
                    {c.name} · <span className="mono tiny">{c.dspId}</span> · {c.ward}
                    {!c.active && <span className="tiny muted-3"> · {t('status.inactive')}</span>}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function AgencyForm({ agency, wards, onClose, onSaved }) {
  const { t } = useLang()
  const isNew = !agency?.id
  const [form, setForm] = useState({
    name: agency?.name || '',
    shortCode: agency?.shortCode || '',
    agencyType: agency?.agencyType || 'private',
    tradeLicenceNo: agency?.tradeLicenceNo || '',
    registrationNo: agency?.registrationNo || '',
    tin: agency?.tin || '',
    bin: agency?.bin || '',
    contactPerson: agency?.contactPerson || '',
    phone: agency?.phone || '',
    email: agency?.email || '',
    address: agency?.address || '',
    contractNo: agency?.contractNo || '',
    contractStart: agency?.contractStart || '',
    contractEnd: agency?.contractEnd || '',
    serviceWards: agency?.serviceWards || [],
    status: agency?.status || 'active',
    notes: agency?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }

  function toggleWard(id) {
    setForm((f) => ({
      ...f,
      serviceWards: f.serviceWards.includes(id)
        ? f.serviceWards.filter((w) => w !== id)
        : [...f.serviceWards, id],
    }))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) { setError(t('agencies.nameRequired')); return }
    if (!form.shortCode.trim()) { setError(t('agencies.codeRequired')); return }

    const body = {
      ...form,
      contractStart: form.contractStart || null,
      contractEnd: form.contractEnd || null,
    }
    setBusy(true)
    try {
      if (isNew) await api.create(body)
      else await api.update(agency.id, body)
      onSaved()
    } catch (err) {
      // The short code is unique server-side; surface what it says rather than
      // guessing, so a clash reads as a clash.
      setError(err?.fieldError?.('shortCode') || err?.detail || t('common.requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? t('agencies.formNew') : t('agencies.formEdit')}
      subtitle={isNew ? t('agencies.formHint') : agency.id}
      onClose={onClose}
      width={660}
    >
      <form onSubmit={submit}>
        <FormSection title={t('agencies.group.identity')} first>
          <FormRow>
            <Field half label={t('agencies.col.name')} value={form.name} onChange={set('name')} disabled={busy} autoFocus />
            <Field half label={t('agencies.shortCode')} value={form.shortCode} onChange={set('shortCode')}
              hint={t('agencies.shortCodeHint')} disabled={busy} />
          </FormRow>
          <FormRow>
            <Field half as="select" label={t('agencies.col.type')} value={form.agencyType} onChange={set('agencyType')} disabled={busy}
              options={['private', 'ngo', 'cbo', 'cooperative'].map((v) => ({ value: v, label: t(`opt.agencyType.${v}`) }))} />
            <Field half as="select" label={t('agencies.col.status')} value={form.status} onChange={set('status')} disabled={busy}
              options={['active', 'suspended', 'expired', 'terminated'].map((v) => ({ value: v, label: t(`opt.agencyStatus.${v}`) }))} />
          </FormRow>
        </FormSection>

        <FormSection title={t('agencies.group.registration')}>
          <FormRow>
            <Field half label={t('agencies.tradeLicence')} value={form.tradeLicenceNo} onChange={set('tradeLicenceNo')} disabled={busy} />
            <Field half label={t('agencies.registrationNo')} value={form.registrationNo} onChange={set('registrationNo')} disabled={busy} />
          </FormRow>
          <FormRow>
            <Field half label={t('agencies.tin')} value={form.tin} onChange={set('tin')} disabled={busy} />
            <Field half label={t('agencies.bin')} value={form.bin} onChange={set('bin')} disabled={busy} />
          </FormRow>
        </FormSection>

        <FormSection title={t('agencies.group.contact')}>
          <FormRow>
            <Field half label={t('agencies.col.contact')} value={form.contactPerson} onChange={set('contactPerson')} disabled={busy} />
            <Field half label={t('agencies.col.phone')} value={form.phone} onChange={set('phone')} placeholder="01XXXXXXXXX" disabled={busy} />
          </FormRow>
          <Field label={t('agencies.email')} type="email" value={form.email} onChange={set('email')} disabled={busy} />
          <Field as="textarea" label={t('agencies.address')} value={form.address} onChange={set('address')} disabled={busy} rows={2} />
        </FormSection>

        <FormSection title={t('agencies.group.contract')}>
          <FormRow>
            <Field third label={t('agencies.contractNo')} value={form.contractNo} onChange={set('contractNo')} disabled={busy} />
            <Field third type="date" label={t('agencies.contractStart')} value={form.contractStart || ''} onChange={set('contractStart')} disabled={busy} />
            <Field third type="date" label={t('agencies.col.contractEnd')} value={form.contractEnd || ''} onChange={set('contractEnd')} disabled={busy} />
          </FormRow>
          <div className="field">
            <label>{t('agencies.serviceWards')}</label>
            <div className="row gap-8 wrap">
              {(wards || []).map((w) => (
                <button
                  key={w.id} type="button" disabled={busy}
                  className={`btn btn-sm ${form.serviceWards.includes(w.id) ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => toggleWard(w.id)}
                >
                  {w.name}
                </button>
              ))}
            </div>
            <div className="tiny muted-3 mt-4">{t('agencies.serviceWardsHint')}</div>
          </div>
          <Field as="textarea" label={t('agencies.notes')} value={form.notes} onChange={set('notes')} disabled={busy} rows={2} />
        </FormSection>

        {error && <div className="form-note bad">{error}</div>}

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : isNew ? t('agencies.register') : t('common.saveChanges')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// Where a month's money actually is, and the form that closes the gap.
// Collected → deposited → remitted; agencies remit in full, so a settled month
// leaves both gaps at zero.
function RemittanceModal({ agency, paymentModes, optLabel, taka, onClose, onSaved }) {
  const { t, n } = useLang()
  const [period, setPeriod] = useState(THIS_PERIOD)
  const [position, setPosition] = useState(null)
  const [form, setForm] = useState({ method: '', amount: '', ref: '', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setPosition(null)
    remitApi.cashPosition({ period, agency: agency.id })
      .then((data) => { if (!cancelled) setPosition(data.rows?.[0] || null) })
      .catch(() => { if (!cancelled) setPosition(null) })
    return () => { cancelled = true }
  }, [period, agency.id])

  useEffect(() => {
    if (!form.method && paymentModes?.length) setForm((f) => ({ ...f, method: paymentModes[0].id }))
  }, [paymentModes, form.method])

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const amount = Number(form.amount)
    if (!amount || amount <= 0) { setError(t('agencies.amountRequired')); return }
    setBusy(true)
    try {
      await remitApi.record({ agency: agency.id, period, method: form.method, amount, ref: form.ref, note: form.note })
      onSaved()
    } catch (err) {
      setError(err?.fieldError?.('amount') || err?.detail || t('common.requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cell = (label, value, tone) => (
    <div>
      <div className="tiny muted-3">{label}</div>
      <div style={{ fontWeight: 700, color: tone }}>{taka(value ?? 0)}</div>
    </div>
  )

  return (
    <Modal title={t('agencies.remitTitle')} subtitle={agency.name} onClose={onClose} width={620}>
      <form onSubmit={submit}>
        <Field as="select" label={t('agencies.period')} value={period} onChange={(e) => setPeriod(e.target.value)}
          options={Array.from({ length: 12 }, (_, i) => {
            const d = new Date(); d.setMonth(d.getMonth() - i)
            const v = d.toISOString().slice(0, 7)
            return { value: v, label: v }
          })} />

        <div className="verify-readout" style={{ marginTop: 12 }}>
          {cell(t('agencies.collected'), position?.collected)}
          {cell(t('agencies.deposited'), position?.deposited)}
          {cell(t('agencies.remitted'), position?.remitted)}
        </div>
        <div className="verify-readout" style={{ marginTop: 8 }}>
          {cell(t('agencies.inField'), position?.inField, 'var(--warn-fg)')}
          {cell(t('agencies.withAgency'), position?.withAgency, 'var(--warn-fg)')}
          {cell(t('agencies.outstanding'), position?.outstanding, 'var(--danger)')}
        </div>
        <div className="tiny muted-3 mt-8">{t('agencies.remitHint')}</div>

        <FormSection title={t('agencies.recordRemittance')}>
          <FormRow>
            <Field half type="number" min="1" label={t('agencies.amount')} value={form.amount}
              onChange={(e) => { setForm((f) => ({ ...f, amount: e.target.value })); setError('') }} disabled={busy} />
            <Field half as="select" label={t('agencies.method')} value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} disabled={busy}
              options={(paymentModes || []).map((m) => ({ value: m.id, label: optLabel(paymentModes, m.id) }))} />
          </FormRow>
          <Field label={t('agencies.reference')} value={form.ref}
            onChange={(e) => setForm((f) => ({ ...f, ref: e.target.value }))}
            hint={t('agencies.referenceHint')} disabled={busy} />
        </FormSection>

        {error && <div className="form-note bad">{error}</div>}

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('agencies.recordRemittance')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
