import { useCallback, useEffect, useState } from 'react'
import { PageHeader, Section, StatCard, Status } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconTruck, IconWrench, IconFuel, IconAlert, IconPlus, IconDownload, IconEye, IconEdit, IconTrash, IconCheck } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { downloadCSV } from '../utils/export.js'
import { useLang } from '../i18n/index.jsx'

const VAN_TYPES = ['compactor', 'pickup', 'rickshaw-van', 'tricycle']
const FUEL_TYPES = ['diesel', 'petrol', 'electric', 'cng']
const OWNERSHIPS = ['owned', 'leased']
const VAN_STATUSES = ['active', 'idle', 'in_maintenance', 'retired']

// How far ahead paperwork counts as "due". The server takes the same window, so
// the cards and the panel always agree.
const ALERT_WINDOW_DAYS = 30

// Days from *now* — the page used to compare every date to a hard-coded
// new Date('2026-07-05'), which froze the badges on the day the demo data was
// written. Expiry maths lives on the server for the alert panel; this is only
// the per-row badge in the registry and the drawer.
const daysUntil = (value) => (value ? Math.round((new Date(value) - new Date()) / 86400000) : null)

function docBadge(dateStr, t, n) {
  const days = daysUntil(dateStr)
  if (days === null) return <span className="badge badge-muted">{t('common.none')}</span>
  if (days < 0) return <span className="badge badge-danger"><span className="dot" />{t('fleet.doc.expired')}</span>
  if (days <= ALERT_WINDOW_DAYS) return <span className="badge badge-warn"><span className="dot" />{t('fleet.doc.daysLeft', { days: n(days) })}</span>
  return <span className="badge badge-ok"><span className="dot" />{t('fleet.doc.valid')}</span>
}

// The server sends structured alert rows — a type and its figures — because the
// Bangla and English wordings live here, not in the API.
function alertText(row, t, n) {
  const doc = row.document ? t(`fleet.doc.${row.document}`) : ''
  if (row.type === 'expired') return t('fleet.alert.expired', { doc, days: n(Math.abs(row.days)) })
  if (row.type === 'expiring') return t('fleet.alert.expiring', { doc, days: n(row.days) })
  if (row.type === 'serviceDue') {
    return row.km > 0
      ? t('fleet.alert.serviceDue', { km: n(row.km) })
      : t('fleet.alert.serviceOverdue', { km: n(Math.abs(row.km || 0)) })
  }
  if (row.type === 'lowEfficiency') return t('fleet.alert.lowEfficiency', { kmpl: n(row.kmpl) })
  return row.type
}

const EMPTY_VAN = {
  plate: '', type: 'compactor', capacity: 1000, fuel: 'diesel', ownership: 'owned',
  gps: '', odometer: 0, status: 'active', driver: null,
  fitnessExp: '', taxExp: '', insuranceExp: '', permitExp: '',
  nextServiceKm: 5000,
}

// One server field message, under the row that produced it.
function FieldError({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{children}</div>
}

function ErrorNote({ error }) {
  if (!error?.detail) return null
  return (
    <div className="form-note bad" style={{ marginTop: 12 }}>
      <IconAlert size={15} /><span>{error.detail}</span>
    </div>
  )
}

export default function Fleet() {
  const { vans, collectors, maintenance, fuelLogs, create, update, remove, act, reload, api, ready, collectorName } = useData()
  const { t, n, taka, percent } = useLang()
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [maintFor, setMaintFor] = useState(null)
  const [fuelFor, setFuelFor] = useState(null)
  const [closing, setClosing] = useState(null)   // the open job being signed off
  const [note, setNote] = useState(null)

  // Alerts and the headline figures are computed server-side against today.
  const [kpis, setKpis] = useState(null)
  const [alerts, setAlerts] = useState([])

  const loadFleetFigures = useCallback(async () => {
    try {
      const [kpiData, alertData] = await Promise.all([
        api.vans.kpis(),
        api.vans.alerts({ within: ALERT_WINDOW_DAYS }),
      ])
      setKpis(kpiData)
      setAlerts(alertData.alerts || [])
    } catch (error) {
      // A missing panel is not worth taking the page down for; the registry below
      // still works from the loaded collection.
      setNote({ tone: 'bad', text: error?.detail || t('fleet.figuresFailed') })
    }
  }, [api, t])

  useEffect(() => { if (ready) loadFleetFigures() }, [ready, loadFleetFigures])

  // Every write can move availability, spend or an alert — and opening a job or
  // logging fuel changes the van itself server-side — so the affected collections
  // and the figures are re-read rather than patched locally.
  const afterWrite = useCallback(async (result, refresh = []) => {
    if (!result.ok) {
      setNote({ tone: 'bad', text: result.error?.detail || t('fleet.saveFailed') })
      return result
    }
    setNote(null)
    if (refresh.length) await reload(refresh)
    await loadFleetFigures()
    return result
  }, [loadFleetFigures, reload, t])

  const availability = kpis ? kpis.availability : 0
  const inMaint = kpis ? kpis.inMaintenance : vans.filter((v) => v.status === 'in_maintenance').length
  const fleetSize = kpis ? kpis.fleetSize : vans.length
  const activeCount = kpis ? kpis.active : vans.filter((v) => v.status === 'active').length

  // 'diesel 6.2 · cng 9.1' — electric vans have no km/L and are left out.
  const efficiencyBreakdown = Object.entries(kpis?.kmplByFuel || {})
    .map(([fuel, value]) => `${t(`fleet.fuelType.${fuel}`)} ${n(value)}`)
    .join(' · ')

  async function removeVan(v) {
    if (!confirm(t('fleet.confirmRemove', { id: v.id }))) return
    await afterWrite(await remove('vans', v.id))
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('fleet.title')}
        subtitle={t('fleet.subtitle')}
        actions={<>
          <button className="btn btn-ghost" onClick={() => downloadCSV('fleet', vans, [
            { key: 'id', label: t('fleet.col.van') }, { key: 'plate', label: t('fleet.col.plate') },
            { key: 'type', label: t('fleet.col.type'), get: (r) => t(`fleet.type.${r.type}`) },
            { key: 'driver', label: t('fleet.col.driver'), get: (r) => r.driver ? collectorName(r.driver) : '' },
            { key: 'odometer', label: t('fleet.col.odometer'), get: (r) => n(r.odometer) },
            { key: 'status', label: t('fleet.col.status'), get: (r) => t(`status.${r.status}`) },
          ], { t })}><IconDownload size={16} /> {t('fleet.export')}</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_VAN })}><IconPlus size={16} /> {t('fleet.registerVehicle')}</button>
        </>}
      />

      {note && (
        <div className={`form-note ${note.tone}`} style={{ marginBottom: 16 }}>
          {note.tone === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}<span>{note.text}</span>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconTruck size={18} />} tone="ok" label={t('fleet.stat.availability')} value={percent(availability)}
          sub={t('fleet.stat.availabilitySub', { active: n(activeCount), total: n(fleetSize) })} progress={availability} />
        <StatCard icon={<IconWrench size={18} />} tone="warn" label={t('fleet.stat.inMaintenance')} value={n(inMaint)} sub={t('fleet.stat.inMaintenanceSub')} />
        <StatCard icon={<IconFuel size={18} />} tone="info" label={t('fleet.stat.efficiency')}
          value={kpis?.avgKmpl == null ? t('common.none') : t('fleet.kmpl', { v: n(kpis.avgKmpl) })}
          sub={efficiencyBreakdown || t('fleet.stat.efficiencySub')} />
        <StatCard icon={<IconAlert size={18} />} tone="danger" label={t('fleet.stat.alerts')} value={n(alerts.length)}
          sub={t('fleet.stat.docsExpiring', { count: n(kpis?.documentsExpiring || 0), days: n(ALERT_WINDOW_DAYS) })} />
        <StatCard icon={<IconWrench size={18} />} label={t('fleet.stat.spend')}
          value={taka((kpis?.fuelSpend || 0) + (kpis?.maintenanceSpend || 0))}
          sub={t('fleet.stat.spendSub', { fuel: taka(kpis?.fuelSpend || 0), maintenance: taka(kpis?.maintenanceSpend || 0) })} />
      </div>

      <div className="two-col">
        <Section title={t('fleet.registry')} pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('fleet.col.van')}</th><th>{t('fleet.col.type')}</th><th>{t('fleet.col.driver')}</th><th>{t('fleet.col.odometer')}</th><th>{t('fleet.col.fitness')}</th><th>{t('fleet.col.status')}</th><th></th></tr></thead>
              <tbody>
                {vans.map((v) => (
                  <tr key={v.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => setSelected(v)}>
                      <div style={{ fontWeight: 600 }}>{v.id}</div>
                      <div className="tiny muted-3 mono">{v.plate}</div>
                    </td>
                    <td className="small" style={{ textTransform: 'capitalize' }}>{t(`fleet.type.${v.type}`)}</td>
                    <td className="small">{v.driver ? collectorName(v.driver) : <span className="muted-3">{t('fleet.unassigned')}</span>}</td>
                    <td className="mono">{t('fleet.km', { v: n(v.odometer) })}</td>
                    <td>{docBadge(v.fitnessExp, t, n)}</td>
                    <td><Status value={v.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="act-btn" title={t('common.details')} onClick={() => setSelected(v)}><IconEye size={16} /></button>
                        <button className="act-btn" title={t('common.edit')} onClick={() => setEditing(v)}><IconEdit size={15} /></button>
                        <button className="act-btn danger" title={t('fleet.action.retire')} onClick={() => removeVan(v)}><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t('fleet.alerts')} actions={<IconAlert size={16} style={{ color: 'var(--warn)' }} />}>
          <div className="grid" style={{ gap: 8 }}>
            {alerts.length ? alerts.map((a, i) => (
              <div key={i} className="row gap-12" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: a.severity === 'danger' ? 'var(--danger)' : 'var(--warn)' }} />
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600, textTransform: 'capitalize' }}>{alertText(a, t, n)}</div>
                  <div className="tiny muted-3 mono">{a.van}</div>
                </div>
              </div>
            )) : <div className="tiny muted-3">{t('fleet.noAlerts')}</div>}
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title={t('fleet.maintHistory')} pad={false}
          actions={<button className="btn btn-ghost btn-sm" onClick={() => setMaintFor(vans[0])}><IconWrench size={14} /> {t('fleet.logShort')}</button>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('fleet.col.record')}</th><th>{t('fleet.col.van')}</th><th>{t('fleet.col.kind')}</th><th>{t('fleet.col.reason')}</th><th>{t('fleet.col.downtime')}</th><th>{t('fleet.col.cost')}</th><th></th></tr></thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.id}</td>
                    <td className="mono small">{m.van}</td>
                    <td><span className={`badge ${m.kind === 'scheduled' ? 'badge-info' : 'badge-warn'}`}>{t(`fleet.kind.${m.kind}`)}</span></td>
                    <td className="small">{m.reason}</td>
                    <td className="mono">{m.closed ? t('fleet.hours', { h: n(m.downtime) }) : <span className="badge badge-warn">{t('fleet.ongoing')}</span>}</td>
                    <td><b>{taka(m.cost)}</b></td>
                    <td>
                      {/* Closing is a server action: it derives downtime and puts
                          the van back on the road only when nothing else is open. */}
                      {!m.closed && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setClosing(m)}>{t('fleet.maint.close')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t('fleet.fuelLog')} pad={false}
          actions={<button className="btn btn-ghost btn-sm" onClick={() => setFuelFor(vans[0])}><IconFuel size={14} /> {t('common.add')}</button>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t('fleet.col.van')}</th><th>{t('fleet.col.litres')}</th><th>{t('fleet.col.cost')}</th><th>{t('fleet.col.odometer')}</th><th>km/L</th></tr></thead>
              <tbody>
                {fuelLogs.map((f) => (
                  <tr key={f.id}>
                    <td className="mono small">{f.van}</td>
                    <td>{t('fleet.litres', { v: n(f.litres) })}</td>
                    <td>{taka(f.cost)}</td>
                    <td className="mono">{n(f.odometer)}</td>
                    <td><span className={f.kmpl && f.kmpl < 5 ? 'badge badge-danger' : 'badge badge-ok'}>{t('fleet.kmpl', { v: f.kmpl ? n(f.kmpl) : t('common.none') })}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      {selected && <VanDrawer van={selected} maintenance={maintenance} collectorName={collectorName}
        onClose={() => setSelected(null)}
        onEdit={() => { setEditing(selected); setSelected(null) }}
        onMaint={() => { setMaintFor(selected); setSelected(null) }}
        onFuel={() => { setFuelFor(selected); setSelected(null) }}
        onCloseJob={(m) => { setClosing(m); setSelected(null) }} />}

      {editing && (
        <VanForm
          initial={editing}
          collectors={collectors}
          onClose={() => setEditing(null)}
          onSave={async ({ driver, ...data }) => {
            // `driver` is set through the dedicated action so the collector is
            // released from whichever van they were on before.
            const saved = data.id
              ? await update('vans', data.id, data)
              : await create('vans', data)
            if (!saved.ok) return afterWrite(saved)
            if ((driver || '') !== (editing.driver || '')) {
              const pairing = await act(api.vans.assignDriver(saved.data.id, driver || null), { refresh: ['vans', 'collectors'] })
              if (!pairing.ok) return afterWrite(pairing)
            }
            await afterWrite(saved)
            setEditing(null)
            return saved
          }}
        />
      )}

      {maintFor && (
        <MaintForm
          vans={vans}
          initialVan={maintFor}
          onClose={() => setMaintFor(null)}
          onSave={async (rec) => {
            // The server stamps `opened`, flips the van to in_maintenance for
            // unscheduled work, and closes a scheduled job logged as finished.
            const result = await afterWrite(await create('maintenance', rec), ['vans'])
            if (result.ok) setMaintFor(null)
            return result
          }}
        />
      )}

      {closing && (
        <CloseMaintForm
          record={closing}
          onClose={() => setClosing(null)}
          onSave={async (body) => {
            const result = await afterWrite(
              await act(api.maintenance.close(closing.id, body), { refresh: ['maintenance', 'vans'] }),
            )
            if (result.ok) setClosing(null)
            return result
          }}
        />
      )}

      {fuelFor && (
        <FuelForm
          vans={vans}
          initialVan={fuelFor}
          onClose={() => setFuelFor(null)}
          onSave={async (rec) => {
            // `at` and `kmpl` are server-derived; the pump reading also advances
            // the van's odometer.
            const result = await afterWrite(await create('fuelLogs', rec), ['vans'])
            if (result.ok) setFuelFor(null)
            return result
          }}
        />
      )}
    </div>
  )
}

function VanForm({ initial, collectors, onClose, onSave }) {
  const { t } = useLang()
  const [form, setForm] = useState({ ...initial, driver: initial.driver || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldError = (name) => error?.fieldError?.(name)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.plate.trim()) { setError({ detail: t('fleet.form.plateRequired') }); return }
    setBusy(true)
    setError(null)
    const result = await onSave({
      id: form.id,
      plate: form.plate.trim(), type: form.type, fuel: form.fuel, ownership: form.ownership,
      gps: form.gps, status: form.status,
      capacity: Number(form.capacity) || 0,
      odometer: Number(form.odometer) || 0,
      nextServiceKm: Number(form.nextServiceKm) || 0,
      fitnessExp: form.fitnessExp || null,
      driver: form.driver || '',
    })
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={initial.id ? t('fleet.form.edit') : t('fleet.registerVehicle')} subtitle={initial.id || t('fleet.form.newVehicle')} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half label={t('fleet.form.plate')} value={form.plate} onChange={set('plate')} placeholder="KHULNA-METRO-…" autoFocus disabled={busy} />
          <Field half as="select" label={t('fleet.form.type')} value={form.type} onChange={set('type')} disabled={busy} options={VAN_TYPES.map((v) => ({ value: v, label: t(`fleet.type.${v}`) }))} />
        </FormRow>
        <FieldError>{fieldError('plate')}</FieldError>
        <FormRow>
          <Field half label={t('fleet.form.capacity')} type="number" value={form.capacity} onChange={set('capacity')} disabled={busy} />
          <Field half as="select" label={t('fleet.form.fuel')} value={form.fuel} onChange={set('fuel')} disabled={busy} options={FUEL_TYPES.map((f) => ({ value: f, label: t(`fleet.fuelType.${f}`) }))} />
        </FormRow>
        {/* An electric van cannot carry a km/L figure, so switching fuel on a van
            that has one is refused — say which field, not just "failed". */}
        <FieldError>{fieldError('kmpl') || fieldError('fuel')}</FieldError>
        <FormRow>
          <Field half as="select" label={t('fleet.form.ownership')} value={form.ownership} onChange={set('ownership')} disabled={busy} options={OWNERSHIPS.map((o) => ({ value: o, label: t(`fleet.ownership.${o}`) }))} />
          <Field half label={t('fleet.form.gps')} value={form.gps} onChange={set('gps')} placeholder="GPS-…" disabled={busy} />
        </FormRow>
        <FormRow>
          <Field half label={t('fleet.form.odometer')} type="number" value={form.odometer} onChange={set('odometer')} disabled={busy}
            hint={initial.id ? t('fleet.form.odometerHint') : undefined} />
          <Field half as="select" label={t('fleet.form.driver')} value={form.driver} onChange={set('driver')} disabled={busy}
            options={[{ value: '', label: t('fleet.form.unassigned') }, ...collectors.map((c) => ({ value: c.id, label: c.name }))]} />
        </FormRow>
        <FieldError>{fieldError('odometer')}</FieldError>
        <FormRow>
          <Field half as="select" label={t('fleet.form.status')} value={form.status} onChange={set('status')} disabled={busy} options={VAN_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} />
          <Field half label={t('fleet.form.fitnessExpiry')} type="date" value={form.fitnessExp || ''} onChange={set('fitnessExp')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('fitnessExp')}</FieldError>
        <ErrorNote error={error} />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('fleet.saving')}</> : initial.id ? t('common.save') : t('fleet.form.register')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function MaintForm({ vans, initialVan, onClose, onSave }) {
  const { t } = useLang()
  const [form, setForm] = useState({ van: initialVan?.id || vans[0]?.id, kind: 'scheduled', reason: '', odometer: initialVan?.odometer || 0, cost: 0, vendor: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldError = (name) => error?.fieldError?.(name)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onSave({
      van: form.van, kind: form.kind, reason: form.reason, vendor: form.vendor,
      odometer: Number(form.odometer) || 0, cost: Number(form.cost) || 0,
    })
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={t('fleet.maint.title')} onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half as="select" label={t('fleet.maint.van')} value={form.van} onChange={set('van')} disabled={busy} options={vans.map((v) => ({ value: v.id, label: v.id }))} />
          <Field half as="select" label={t('fleet.maint.kind')} value={form.kind} onChange={set('kind')} disabled={busy} options={[{ value: 'scheduled', label: t('fleet.maint.scheduled') }, { value: 'unscheduled', label: t('fleet.maint.unscheduled') }]} />
        </FormRow>
        <Field label={t('fleet.maint.reason')} value={form.reason} onChange={set('reason')} placeholder={t('fleet.maint.reasonHint')} disabled={busy} />
        <FieldError>{fieldError('reason') || fieldError('van')}</FieldError>
        <FormRow>
          <Field half label={t('fleet.maint.odometer')} type="number" value={form.odometer} onChange={set('odometer')} disabled={busy} />
          <Field half label={t('fleet.maint.cost')} type="number" value={form.cost} onChange={set('cost')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('odometer') || fieldError('cost')}</FieldError>
        <Field label={t('fleet.maint.vendor')} value={form.vendor} onChange={set('vendor')} disabled={busy} />
        {/* Downtime is derived from opened → closed when the job is signed off, so
            there is nothing to type here. */}
        <div className="tiny muted-3 mt-8">{t('fleet.maint.downtimeDerived')}</div>
        <ErrorNote error={error} />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('fleet.saving')}</> : t('fleet.maint.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// Signing a workshop job off. Everything is optional: the server defaults the
// closing time to now and computes downtime from opened → closed.
function CloseMaintForm({ record, onClose, onSave }) {
  const { t } = useLang()
  const [form, setForm] = useState({ cost: record.cost || 0, downtime: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldError = (name) => error?.fieldError?.(name)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const body = { cost: Number(form.cost) || 0 }
    // Only sent when the workshop reports a different figure to the elapsed time.
    if (String(form.downtime).trim() !== '') body.downtime = Number(form.downtime)
    const result = await onSave(body)
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={t('fleet.maint.closeTitle')} subtitle={`${record.id} · ${record.van}`} onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <div className="tiny muted">{t('fleet.maint.closeHint')}</div>
        <FormRow>
          <Field half label={t('fleet.maint.cost')} type="number" value={form.cost} onChange={set('cost')} disabled={busy} />
          <Field half label={t('fleet.maint.downtime')} type="number" value={form.downtime} onChange={set('downtime')}
            placeholder={t('fleet.maint.downtimeAuto')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('cost') || fieldError('downtime') || fieldError('closed')}</FieldError>
        <ErrorNote error={error} />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('fleet.saving')}</> : t('fleet.maint.close')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function FuelForm({ vans, initialVan, onClose, onSave }) {
  const { t } = useLang()
  const [form, setForm] = useState({ van: initialVan?.id || vans[0]?.id, litres: 0, cost: 0, odometer: initialVan?.odometer || 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldError = (name) => error?.fieldError?.(name)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onSave({
      van: form.van,
      litres: Number(form.litres) || 0,
      cost: Number(form.cost) || 0,
      odometer: Number(form.odometer) || 0,
    })
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={t('fleet.fuelForm.title')} onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half as="select" label={t('fleet.fuelForm.van')} value={form.van} onChange={set('van')} disabled={busy} options={vans.map((v) => ({ value: v.id, label: v.id }))} />
          <Field half label={t('fleet.fuelForm.litres')} type="number" value={form.litres} onChange={set('litres')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('van') || fieldError('litres')}</FieldError>
        <FormRow>
          <Field half label={t('fleet.fuelForm.cost')} type="number" value={form.cost} onChange={set('cost')} disabled={busy} />
          <Field half label={t('fleet.fuelForm.odometer')} type="number" value={form.odometer} onChange={set('odometer')} disabled={busy}
            hint={t('fleet.fuelForm.odometerHint')} />
        </FormRow>
        <FieldError>{fieldError('odometer') || fieldError('cost')}</FieldError>
        {/* km/L is derived from the distance since this van's previous log, which
            is more trustworthy than a hand-typed figure. */}
        <div className="tiny muted-3 mt-8">{t('fleet.fuelForm.efficiencyDerived')}</div>
        <FieldError>{fieldError('kmpl')}</FieldError>
        <ErrorNote error={error} />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('fleet.saving')}</> : t('fleet.fuelForm.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function VanDrawer({ van, maintenance, collectorName, onClose, onEdit, onMaint, onFuel, onCloseJob }) {
  const { t, n, taka, date } = useLang()
  const vm = maintenance.filter((m) => m.van === van.id)
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="row gap-8"><h3 style={{ fontSize: 17 }}>{van.id}</h3><Status value={van.status} /></div>
            <div className="tiny muted-3 mono mt-4">{van.plate}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <dl className="kv">
            <dt>{t('fleet.drawer.type')}</dt><dd style={{ textTransform: 'capitalize' }}>{t(`fleet.type.${van.type}`)}</dd>
            <dt>{t('fleet.drawer.capacity')}</dt><dd>{t('fleet.kg', { v: n(van.capacity) })}</dd>
            <dt>{t('fleet.drawer.fuel')}</dt><dd style={{ textTransform: 'capitalize' }}>{t(`fleet.fuelType.${van.fuel}`)}</dd>
            <dt>{t('fleet.drawer.ownership')}</dt><dd style={{ textTransform: 'capitalize' }}>{t(`fleet.ownership.${van.ownership}`)}</dd>
            <dt>{t('fleet.drawer.gps')}</dt><dd className="mono">{van.gps || t('common.none')}</dd>
            <dt>{t('fleet.drawer.odometer')}</dt><dd className="mono">{t('fleet.km', { v: n(van.odometer) })}</dd>
            <dt>{t('fleet.drawer.driver')}</dt><dd>{van.driver ? collectorName(van.driver) : <span className="muted-3">{t('fleet.unassigned')}</span>}</dd>
            <dt>{t('fleet.drawer.nextService')}</dt><dd className="mono">{van.nextServiceKm == null ? t('common.none') : t('fleet.km', { v: n(van.nextServiceKm) })}</dd>
            {/* Derived server-side, so the countdown never disagrees with the alert. */}
            <dt>{t('fleet.drawer.serviceDueIn')}</dt>
            <dd className="mono">{van.serviceDueInKm == null ? t('common.none') : t('fleet.km', { v: n(van.serviceDueInKm) })}</dd>
          </dl>

          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>{t('fleet.drawer.documents')}</h4>
          <div className="grid mt-8" style={{ gap: 8 }}>
            {[['fleet.doc.fitnessCert', van.fitnessExp], ['fleet.doc.taxToken', van.taxExp], ['fleet.doc.insuranceDoc', van.insuranceExp], ['fleet.doc.routePermit', van.permitExp]].map(([key, exp]) => (
              <div key={key} className="row between" style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                <div><div className="small" style={{ fontWeight: 600 }}>{t(key)}</div><div className="tiny muted-3 mono">{t('fleet.doc.exp', { date: date(exp) })}</div></div>
                {docBadge(exp, t, n)}
              </div>
            ))}
          </div>

          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>{t('fleet.drawer.maintenance')}</h4>
          {vm.length ? vm.map((m) => (
            <div key={m.id} className="mt-8" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
              <div className="row between"><b className="small">{m.reason}</b><span className={`badge ${m.kind === 'scheduled' ? 'badge-info' : 'badge-warn'}`}>{t(`fleet.kind.${m.kind}`)}</span></div>
              <div className="tiny muted mt-4">{m.vendor} · {taka(m.cost)} · {m.closed ? t('fleet.downtimeOf', { h: n(m.downtime) }) : t('fleet.ongoing')}</div>
              {!m.closed && (
                <button className="btn btn-ghost btn-sm mt-8" onClick={() => onCloseJob(m)}>{t('fleet.maint.close')}</button>
              )}
            </div>
          )) : <div className="tiny muted-3 mt-8">{t('fleet.noMaintenance')}</div>}

          <div className="row gap-8 mt-24">
            <button className="btn btn-primary grow" onClick={onMaint}><IconWrench size={15} /> {t('fleet.drawer.logMaint')}</button>
            <button className="btn btn-ghost grow" onClick={onFuel}><IconFuel size={15} /> {t('fleet.drawer.addFuel')}</button>
          </div>
          <button className="btn btn-ghost mt-8" style={{ width: '100%' }} onClick={onEdit}><IconEdit size={15} /> {t('fleet.drawer.editVehicle')}</button>
        </div>
      </aside>
    </>
  )
}
