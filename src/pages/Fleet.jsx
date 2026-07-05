import { useState } from 'react'
import { PageHeader, Section, StatCard, Status } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconTruck, IconWrench, IconFuel, IconAlert, IconPlus, IconDownload, IconEye, IconEdit, IconTrash } from '../components/Icons.jsx'
import { useData, genId } from '../context/DataContext.jsx'
import { downloadCSV } from '../utils/export.js'

const today = new Date('2026-07-05')
const daysUntil = (d) => Math.round((new Date(d) - today) / 86400000)
const VAN_TYPES = ['compactor', 'pickup', 'rickshaw-van', 'tricycle']

function docBadge(dateStr) {
  const days = daysUntil(dateStr)
  if (days < 0) return <span className="badge badge-danger"><span className="dot" />expired</span>
  if (days <= 30) return <span className="badge badge-warn"><span className="dot" />{days}d left</span>
  return <span className="badge badge-ok"><span className="dot" />valid</span>
}

function buildAlerts(vans) {
  const out = []
  vans.forEach((v) => {
    const docs = { 'fitness': v.fitnessExp, 'tax token': v.taxExp, 'insurance': v.insuranceExp, 'route permit': v.permitExp }
    Object.entries(docs).forEach(([label, date]) => {
      const d = daysUntil(date)
      if (d < 0) out.push({ van: v.id, kind: 'danger', text: `${label} expired ${-d}d ago` })
      else if (d <= 30) out.push({ van: v.id, kind: 'warn', text: `${label} expires in ${d}d` })
    })
    if (v.nextServiceKm - v.odometer <= 1000 && v.status === 'active')
      out.push({ van: v.id, kind: 'warn', text: `service due in ${v.nextServiceKm - v.odometer} km` })
    if (v.kmpl && v.kmpl < 5) out.push({ van: v.id, kind: 'danger', text: `low fuel efficiency (${v.kmpl} km/L) — check for leakage` })
  })
  return out
}

const EMPTY_VAN = {
  plate: '', type: 'compactor', capacity: 1000, fuel: 'diesel', ownership: 'owned',
  gps: '', odometer: 0, status: 'active', driver: null,
  fitnessExp: '2027-01-01', taxExp: '2027-01-01', insuranceExp: '2027-01-01', permitExp: '2027-01-01',
  nextServiceKm: 5000, kmpl: null,
}

export default function Fleet() {
  const { vans, collectors, maintenance, fuelLogs, upsert, remove, collectorName } = useData()
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [maintFor, setMaintFor] = useState(null)
  const [fuelFor, setFuelFor] = useState(null)

  const alerts = buildAlerts(vans)
  const available = vans.filter((v) => v.status === 'active').length
  const inMaint = vans.filter((v) => v.status === 'in_maintenance').length

  return (
    <div className="fade-in">
      <PageHeader
        title="Fleet & Van Management"
        subtitle="Vehicle registry, driver assignment, maintenance & fuel"
        actions={<>
          <button className="btn btn-ghost" onClick={() => downloadCSV('fleet', vans, [
            { key: 'id', label: 'Van' }, { key: 'plate', label: 'Plate' }, { key: 'type', label: 'Type' },
            { key: 'driver', label: 'Driver', get: (r) => r.driver ? collectorName(r.driver) : '' },
            { key: 'odometer', label: 'Odometer' }, { key: 'status', label: 'Status' },
          ])}><IconDownload size={16} /> Export</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY_VAN })}><IconPlus size={16} /> Register vehicle</button>
        </>}
      />

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconTruck size={18} />} tone="ok" label="Fleet availability" value={`${vans.length ? Math.round((available / vans.length) * 100) : 0}%`} sub={`${available} of ${vans.length} active`} progress={vans.length ? (available / vans.length) * 100 : 0} />
        <StatCard icon={<IconWrench size={18} />} tone="warn" label="In maintenance" value={inMaint} sub="Removed from routing" />
        <StatCard icon={<IconFuel size={18} />} tone="info" label="Avg fuel efficiency" value="6.1 km/L" sub="Diesel fleet · anomaly-flagged" />
        <StatCard icon={<IconAlert size={18} />} tone="danger" label="Open alerts" value={alerts.length} sub="Docs · service · fuel" />
      </div>

      <div className="two-col">
        <Section title="Vehicle registry" pad={false}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Van</th><th>Type</th><th>Driver</th><th>Odometer</th><th>Fitness</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {vans.map((v) => (
                  <tr key={v.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => setSelected(v)}>
                      <div style={{ fontWeight: 600 }}>{v.id}</div>
                      <div className="tiny muted-3 mono">{v.plate}</div>
                    </td>
                    <td className="small" style={{ textTransform: 'capitalize' }}>{v.type}</td>
                    <td className="small">{v.driver ? collectorName(v.driver) : <span className="muted-3">unassigned</span>}</td>
                    <td className="mono">{v.odometer.toLocaleString()} km</td>
                    <td>{docBadge(v.fitnessExp)}</td>
                    <td><Status value={v.status} /></td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="act-btn" title="Details" onClick={() => setSelected(v)}><IconEye size={16} /></button>
                        <button className="act-btn" title="Edit" onClick={() => setEditing(v)}><IconEdit size={15} /></button>
                        <button className="act-btn danger" title="Retire" onClick={() => { if (confirm(`Remove ${v.id}?`)) remove('vans', v.id) }}><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Alerts" actions={<IconAlert size={16} style={{ color: 'var(--warn)' }} />}>
          <div className="grid" style={{ gap: 8 }}>
            {alerts.length ? alerts.map((a, i) => (
              <div key={i} className="row gap-12" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: a.kind === 'danger' ? 'var(--danger)' : 'var(--warn)' }} />
                <div className="grow">
                  <div className="small" style={{ fontWeight: 600, textTransform: 'capitalize' }}>{a.text}</div>
                  <div className="tiny muted-3 mono">{a.van}</div>
                </div>
              </div>
            )) : <div className="tiny muted-3">No alerts.</div>}
          </div>
        </Section>
      </div>

      <div className="two-col mt-24">
        <Section title="Maintenance history" pad={false}
          actions={<button className="btn btn-ghost btn-sm" onClick={() => setMaintFor(vans[0])}><IconWrench size={14} /> Log</button>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Record</th><th>Van</th><th>Kind</th><th>Reason</th><th>Downtime</th><th>Cost</th></tr></thead>
              <tbody>
                {maintenance.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.id}</td>
                    <td className="mono small">{m.van}</td>
                    <td><span className={`badge ${m.kind === 'scheduled' ? 'badge-info' : 'badge-warn'}`}>{m.kind}</span></td>
                    <td className="small">{m.reason}</td>
                    <td className="mono">{m.closed ? `${m.downtime}h` : <span className="badge badge-warn">ongoing</span>}</td>
                    <td><b>৳{m.cost.toLocaleString()}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Fuel log" pad={false}
          actions={<button className="btn btn-ghost btn-sm" onClick={() => setFuelFor(vans[0])}><IconFuel size={14} /> Add</button>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Van</th><th>Litres</th><th>Cost</th><th>Odometer</th><th>km/L</th></tr></thead>
              <tbody>
                {fuelLogs.map((f) => (
                  <tr key={f.id}>
                    <td className="mono small">{f.van}</td>
                    <td>{f.litres} L</td>
                    <td>৳{f.cost.toLocaleString()}</td>
                    <td className="mono">{f.odometer.toLocaleString()}</td>
                    <td><span className={f.kmpl && f.kmpl < 5 ? 'badge badge-danger' : 'badge badge-ok'}>{f.kmpl || '—'} km/L</span></td>
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
        onFuel={() => { setFuelFor(selected); setSelected(null) }} />}

      {editing && <VanForm initial={editing} collectors={collectors} onClose={() => setEditing(null)}
        onSave={(data) => { upsert('vans', data.id ? data : { ...data, id: genId('VAN-KCC') }); setEditing(null) }} />}

      {maintFor && <MaintForm vans={vans} initialVan={maintFor} onClose={() => setMaintFor(null)}
        onSave={(rec) => {
          upsert('maintenance', { ...rec, id: genId('MNT'), opened: new Date().toISOString(), closed: rec.kind === 'scheduled' ? new Date().toISOString() : null })
          if (rec.kind === 'unscheduled') { const v = vans.find((x) => x.id === rec.van); if (v) upsert('vans', { ...v, status: 'in_maintenance' }) }
          setMaintFor(null)
        }} />}

      {fuelFor && <FuelForm vans={vans} initialVan={fuelFor} onClose={() => setFuelFor(null)}
        onSave={(rec) => { upsert('fuelLogs', { ...rec, id: genId('FUEL'), at: new Date().toISOString() }); setFuelFor(null) }} />}
    </div>
  )
}

function VanForm({ initial, collectors, onClose, onSave }) {
  const [form, setForm] = useState(initial)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title={initial.id ? 'Edit vehicle' : 'Register vehicle'} subtitle={initial.id || 'New fleet vehicle'} onClose={onClose} width={560}>
      <form onSubmit={(e) => { e.preventDefault(); if (!form.plate.trim()) { alert('Plate number required.'); return } onSave({ ...form, capacity: Number(form.capacity) || 0, odometer: Number(form.odometer) || 0, nextServiceKm: Number(form.nextServiceKm) || 0 }) }}>
        <FormRow>
          <Field half label="Plate number" value={form.plate} onChange={set('plate')} placeholder="KHULNA-METRO-…" autoFocus />
          <Field half as="select" label="Type" value={form.type} onChange={set('type')} options={VAN_TYPES.map((t) => ({ value: t, label: t }))} />
        </FormRow>
        <FormRow>
          <Field half label="Capacity (kg)" type="number" value={form.capacity} onChange={set('capacity')} />
          <Field half as="select" label="Fuel" value={form.fuel} onChange={set('fuel')} options={['diesel', 'petrol', 'electric', 'cng'].map((f) => ({ value: f, label: f }))} />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Ownership" value={form.ownership} onChange={set('ownership')} options={['owned', 'leased'].map((o) => ({ value: o, label: o }))} />
          <Field half label="GPS device ID" value={form.gps} onChange={set('gps')} placeholder="GPS-…" />
        </FormRow>
        <FormRow>
          <Field half label="Odometer (km)" type="number" value={form.odometer} onChange={set('odometer')} />
          <Field half as="select" label="Assigned driver" value={form.driver || ''} onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value || null }))}
            options={[{ value: '', label: 'Unassigned' }, ...collectors.map((c) => ({ value: c.id, label: c.name }))]} />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Status" value={form.status} onChange={set('status')} options={['active', 'idle', 'in_maintenance', 'retired'].map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
          <Field half label="Fitness expiry" type="date" value={form.fitnessExp} onChange={set('fitnessExp')} />
        </FormRow>
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{initial.id ? 'Save' : 'Register'}</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function MaintForm({ vans, initialVan, onClose, onSave }) {
  const [form, setForm] = useState({ van: initialVan?.id || vans[0]?.id, kind: 'scheduled', reason: '', odometer: initialVan?.odometer || 0, downtime: 0, cost: 0, vendor: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title="Log maintenance" onClose={onClose} width={520}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, odometer: Number(form.odometer) || 0, downtime: Number(form.downtime) || 0, cost: Number(form.cost) || 0 }) }}>
        <FormRow>
          <Field half as="select" label="Van" value={form.van} onChange={set('van')} options={vans.map((v) => ({ value: v.id, label: v.id }))} />
          <Field half as="select" label="Kind" value={form.kind} onChange={set('kind')} options={[{ value: 'scheduled', label: 'Scheduled (preventive)' }, { value: 'unscheduled', label: 'Unscheduled (breakdown)' }]} />
        </FormRow>
        <Field label="Reason" value={form.reason} onChange={set('reason')} placeholder="e.g. 5000km service / brake repair" />
        <FormRow>
          <Field half label="Odometer (km)" type="number" value={form.odometer} onChange={set('odometer')} />
          <Field half label="Downtime (hrs)" type="number" value={form.downtime} onChange={set('downtime')} />
        </FormRow>
        <FormRow>
          <Field half label="Total cost (৳)" type="number" value={form.cost} onChange={set('cost')} />
          <Field half label="Vendor / workshop" value={form.vendor} onChange={set('vendor')} />
        </FormRow>
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save record</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function FuelForm({ vans, initialVan, onClose, onSave }) {
  const [form, setForm] = useState({ van: initialVan?.id || vans[0]?.id, litres: 0, cost: 0, odometer: initialVan?.odometer || 0, kmpl: 0 })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  return (
    <Modal title="Add fuel entry" onClose={onClose} width={480}>
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...form, litres: Number(form.litres) || 0, cost: Number(form.cost) || 0, odometer: Number(form.odometer) || 0, kmpl: Number(form.kmpl) || null }) }}>
        <FormRow>
          <Field half as="select" label="Van" value={form.van} onChange={set('van')} options={vans.map((v) => ({ value: v.id, label: v.id }))} />
          <Field half label="Litres" type="number" value={form.litres} onChange={set('litres')} />
        </FormRow>
        <FormRow>
          <Field half label="Cost (৳)" type="number" value={form.cost} onChange={set('cost')} />
          <Field half label="Odometer (km)" type="number" value={form.odometer} onChange={set('odometer')} />
        </FormRow>
        <Field label="Efficiency (km/L)" type="number" value={form.kmpl} onChange={set('kmpl')} placeholder="optional — anomaly flagged if < 5" />
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save entry</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function VanDrawer({ van, maintenance, collectorName, onClose, onEdit, onMaint, onFuel }) {
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
            <dt>Type</dt><dd style={{ textTransform: 'capitalize' }}>{van.type}</dd>
            <dt>Capacity</dt><dd>{van.capacity.toLocaleString()} kg</dd>
            <dt>Fuel</dt><dd style={{ textTransform: 'capitalize' }}>{van.fuel}</dd>
            <dt>Ownership</dt><dd style={{ textTransform: 'capitalize' }}>{van.ownership}</dd>
            <dt>GPS device</dt><dd className="mono">{van.gps || '—'}</dd>
            <dt>Odometer</dt><dd className="mono">{van.odometer.toLocaleString()} km</dd>
            <dt>Driver</dt><dd>{van.driver ? collectorName(van.driver) : <span className="muted-3">unassigned</span>}</dd>
            <dt>Next service</dt><dd className="mono">{van.nextServiceKm.toLocaleString()} km</dd>
          </dl>

          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>Documents</h4>
          <div className="grid mt-8" style={{ gap: 8 }}>
            {[['Fitness certificate', van.fitnessExp], ['Tax token', van.taxExp], ['Insurance', van.insuranceExp], ['Route permit', van.permitExp]].map(([label, date]) => (
              <div key={label} className="row between" style={{ padding: '9px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
                <div><div className="small" style={{ fontWeight: 600 }}>{label}</div><div className="tiny muted-3 mono">exp {date}</div></div>
                {docBadge(date)}
              </div>
            ))}
          </div>

          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>Maintenance</h4>
          {vm.length ? vm.map((m) => (
            <div key={m.id} className="mt-8" style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 9 }}>
              <div className="row between"><b className="small">{m.reason}</b><span className={`badge ${m.kind === 'scheduled' ? 'badge-info' : 'badge-warn'}`}>{m.kind}</span></div>
              <div className="tiny muted mt-4">{m.vendor} · ৳{m.cost.toLocaleString()} · {m.closed ? `${m.downtime}h downtime` : 'ongoing'}</div>
            </div>
          )) : <div className="tiny muted-3 mt-8">No maintenance records.</div>}

          <div className="row gap-8 mt-24">
            <button className="btn btn-primary grow" onClick={onMaint}><IconWrench size={15} /> Log maintenance</button>
            <button className="btn btn-ghost grow" onClick={onFuel}><IconFuel size={15} /> Add fuel</button>
          </div>
          <button className="btn btn-ghost mt-8" style={{ width: '100%' }} onClick={onEdit}><IconEdit size={15} /> Edit vehicle</button>
        </div>
      </aside>
    </>
  )
}
