import { useState, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { PageHeader, Status, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { IconSearch, IconQr, IconPlus, IconHome, IconEdit, IconTrash, IconEye, IconArrow } from '../components/Icons.jsx'
import { useData, genId } from '../context/DataContext.jsx'
import { wards, roadsByWard, tiers, tierLabel, tierCharge } from '../data/mockData.js'

// The two household types requested:
//   under_service  → household currently giving waste to a collector  (households collection)
//   potential      → surveyed home not yet under service              (potentialCustomers collection)
const TYPE_META = {
  under_service: { label: 'Under service', badge: 'badge-ok' },
  potential: { label: 'Potential', badge: 'badge-info' },
}

const EMPTY = {
  _type: 'under_service', head: '', ward: 'W-14', road: 'KDA Avenue', holding: '', phone: '',
  tier: 'residential_standard', status: 'active', dues: 0, surveyor: '',
}

export default function Households() {
  const { households, potentialCustomers, collectors, upsert, remove, collectorName } = useData()
  const [q, setQ] = useState('')
  const [ward, setWard] = useState('all')
  const [typeF, setTypeF] = useState('all') // all | under_service | potential
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)

  // Unify both collections into one normalized list for the table.
  const unified = useMemo(() => ([
    ...households.map((h) => ({ ...h, _type: 'under_service', _coll: 'households' })),
    ...potentialCustomers.map((p) => ({ ...p, _type: 'potential', _coll: 'potentialCustomers', tier: p.estTier, dues: 0, status: 'potential', qr: null })),
  ]), [households, potentialCustomers])

  const rows = useMemo(() => unified.filter((h) => {
    if (typeF !== 'all' && h._type !== typeF) return false
    if (ward !== 'all' && h.ward !== ward) return false
    if (!q) return true
    const s = q.toLowerCase()
    return [h.id, h.head, h.qr, h.holding, h.road].some((v) => String(v || '').toLowerCase().includes(s))
  }), [unified, typeF, ward, q])

  const counts = {
    all: unified.length,
    under_service: households.length,
    potential: potentialCustomers.length,
  }

  // Columns for the export (View / PDF / Excel / CSV)
  const exportColumns = [
    { key: 'id', label: 'ID' },
    { key: 'head', label: 'Head' },
    { key: '_type', label: 'Type', get: (r) => TYPE_META[r._type].label },
    { key: 'ward', label: 'Ward' },
    { key: 'road', label: 'Road' },
    { key: 'holding', label: 'Holding' },
    { key: 'qr', label: 'QR', get: (r) => r.qr || '—' },
    { key: 'tier', label: 'Charge tier', get: (r) => tierLabel(r.tier) },
    { key: 'charge', label: 'Monthly charge (৳)', get: (r) => tierCharge(r.tier) },
    { key: 'phone', label: 'Contact' },
    { key: 'dues', label: 'Dues (৳)', get: (r) => (r._type === 'potential' ? '—' : r.dues) },
    { key: 'status', label: 'Status', get: (r) => (r._type === 'potential' ? 'potential' : r.status) },
  ]
  const exportTitle = `Households — ${typeF === 'all' ? 'all' : TYPE_META[typeF].label}${ward !== 'all' ? ` · ${ward}` : ''}`

  function convert(p) {
    if (!confirm(`Bring ${p.head} under service? A household ID, QR tag and bill will be created.`)) return
    const id = genId('HH-KCC')
    upsert('households', {
      id, qr: 'SS-' + id.slice(-6).toUpperCase(), head: p.head, phone: p.phone, ward: p.ward,
      road: p.road, holding: p.holding, tier: p.estTier, status: 'active', dues: 0,
      lastVisit: null, lat: 22.84, lng: 89.54,
    })
    remove('potentialCustomers', p.id)
    setSelected(null)
  }

  return (
    <div className="fade-in">
      <PageHeader
        title="Households"
        subtitle={`${counts.under_service} under service · ${counts.potential} potential`}
        actions={<>
          <ExportMenu title={exportTitle} subtitle={`${rows.length} records · Smart Sweep SWMS`}
            columns={exportColumns} rows={rows} filename="households" />
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY, _type: typeF === 'potential' ? 'potential' : 'under_service' })}>
            <IconPlus size={16} /> Register household
          </button>
        </>}
      />

      <div className="filter-bar">
        <div className="seg">
          {[['all', `All (${counts.all})`], ['under_service', `Under service (${counts.under_service})`], ['potential', `Potential (${counts.potential})`]].map(([k, l]) => (
            <button key={k} className={typeF === k ? 'on' : ''} onClick={() => setTypeF(k)}>{l}</button>
          ))}
        </div>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder="Search by ID, name, QR, holding, road…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 'auto' }} value={ward} onChange={(e) => setWard(e.target.value)}>
          <option value="all">All wards</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div className="grow" />
        <span className="tiny muted">{rows.length} shown</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ID</th><th>Head</th><th>Type</th><th>Ward</th><th>Road</th><th>Holding</th>
                <th>Tier</th><th>Dues</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="mono" style={{ cursor: 'pointer' }} onClick={() => setSelected(h)}>{h.id}</td>
                  <td style={{ fontWeight: 600 }}>{h.head}</td>
                  <td><span className={`badge ${TYPE_META[h._type].badge}`}><span className="dot" />{TYPE_META[h._type].label}</span></td>
                  <td>{h.ward}</td>
                  <td className="small">{h.road}</td>
                  <td>{h.holding}</td>
                  <td className="small">{tierLabel(h.tier)}</td>
                  <td>{h._type === 'potential' ? <span className="muted-3">—</span> : h.dues > 0 ? <b style={{ color: 'var(--danger)' }}>৳{h.dues}</b> : <span className="muted-3">৳0</span>}</td>
                  <td><Status value={h.status} /></td>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      {h._type === 'potential' && (
                        <button className="act-btn" title="Bring under service" onClick={() => convert(h)} style={{ color: 'var(--brand)' }}><IconArrow size={16} /></button>
                      )}
                      <button className="act-btn" title="Details" onClick={() => setSelected(h)}><IconEye size={16} /></button>
                      <button className="act-btn" title="Edit" onClick={() => setEditing(h)}><IconEdit size={15} /></button>
                      <button className="act-btn danger" title="Delete" onClick={() => { if (confirm(`Delete ${h.id} (${h.head})?`)) remove(h._coll, h.id) }}><IconTrash size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState><IconHome size={28} /><div className="mt-8">No households match your filters.</div></EmptyState>}
        </div>
      </div>

      {selected && <HouseholdDrawer hh={selected} collectorName={collectorName}
        onClose={() => setSelected(null)}
        onEdit={() => { setEditing(selected); setSelected(null) }}
        onConvert={selected._type === 'potential' ? () => convert(selected) : null} />}

      {editing && <HouseholdForm initial={editing} collectors={collectors} onClose={() => setEditing(null)}
        onSave={(data) => {
          if (data._type === 'potential') {
            const rec = { id: data.id || genId('POT'), head: data.head, phone: data.phone, ward: data.ward, road: data.road, holding: data.holding, estTier: data.tier, surveyor: data.surveyor || null, surveyedAt: data.surveyedAt || new Date().toISOString().slice(0, 10) }
            upsert('potentialCustomers', rec)
          } else {
            if (data.id && data._coll === 'households') upsert('households', { ...cleanUnder(data) })
            else {
              const id = genId('HH-KCC')
              upsert('households', { ...cleanUnder(data), id, qr: 'SS-' + id.slice(-6).toUpperCase(), lastVisit: null, lat: 22.84, lng: 89.54 })
            }
          }
          setEditing(null)
        }} />}
    </div>
  )
}

// strip helper fields before saving an under-service household
function cleanUnder(d) {
  return { id: d.id, head: d.head, phone: d.phone, ward: d.ward, road: d.road, holding: d.holding, tier: d.tier, status: d.status, dues: Number(d.dues) || 0, qr: d.qr, lastVisit: d.lastVisit, lat: d.lat, lng: d.lng }
}

function HouseholdForm({ initial, collectors, onClose, onSave }) {
  const [form, setForm] = useState({ ...initial, tier: initial.tier || initial.estTier || 'residential_standard' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const roads = roadsByWard[form.ward] || []
  const isPotential = form._type === 'potential'
  const editing = !!form.id

  return (
    <Modal title={editing ? 'Edit household' : 'Register household'}
      subtitle={editing ? form.id : 'Choose the service type below'} onClose={onClose} width={560}>
      <form onSubmit={(e) => { e.preventDefault(); if (!form.head.trim()) { alert('Head of household name is required.'); return } onSave(form) }}>
        {!editing && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>Household type</label>
            <div className="seg" style={{ width: 'fit-content' }}>
              {[['under_service', 'Under service'], ['potential', 'Potential']].map(([k, l]) => (
                <button type="button" key={k} className={form._type === k ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, _type: k }))}>{l}</button>
              ))}
            </div>
            <div className="tiny muted-3">
              {isPotential ? 'Surveyed home not yet serviced — a future customer.' : 'Actively giving waste to a collector; will be billed.'}
            </div>
          </div>
        )}
        <FormRow>
          <Field half label="Head of household" value={form.head} onChange={set('head')} placeholder="Full name" autoFocus />
          <Field half label="Contact" value={form.phone} onChange={set('phone')} placeholder="+8801…" />
        </FormRow>
        <FormRow>
          <Field half as="select" label="Ward" value={form.ward}
            onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value, road: (roadsByWard[e.target.value] || [''])[0] }))}
            options={wards.map((w) => ({ value: w.id, label: w.name }))} />
          <Field half as="select" label="Road" value={form.road} onChange={set('road')} options={roads.map((r) => ({ value: r, label: r }))} />
        </FormRow>
        <FormRow>
          <Field half label="Holding no." value={form.holding} onChange={set('holding')} placeholder="e.g. 142/B" />
          <Field half as="select" label={isPotential ? 'Estimated tier' : 'Charge tier'} value={form.tier} onChange={set('tier')}
            options={tiers.map((t) => ({ value: t.id, label: `${t.label} (৳${t.charge})` }))} />
        </FormRow>
        {isPotential ? (
          <FormRow>
            <Field half as="select" label="Surveyed by" value={form.surveyor || ''} onChange={set('surveyor')}
              options={[{ value: '', label: '—' }, ...collectors.map((c) => ({ value: c.id, label: c.name }))]} />
            <Field half label="Surveyed on" type="date" value={form.surveyedAt || '2026-07-06'} onChange={set('surveyedAt')} />
          </FormRow>
        ) : (
          <FormRow>
            <Field half as="select" label="Status" value={form.status} onChange={set('status')}
              options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
            <Field half label="Outstanding dues (৳)" type="number" value={form.dues} onChange={set('dues')} />
          </FormRow>
        )}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{editing ? 'Save changes' : 'Register'}</button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function HouseholdDrawer({ hh, collectorName, onClose, onEdit, onConvert }) {
  const potential = hh._type === 'potential'
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="row gap-8">
              <h3 style={{ fontSize: 17 }}>{hh.head}</h3>
              <span className={`badge ${TYPE_META[hh._type].badge}`}><span className="dot" />{TYPE_META[hh._type].label}</span>
            </div>
            <div className="tiny muted-3 mono mt-4">{hh.id}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {!potential && hh.qr && (
            <div className="center" style={{ marginBottom: 22 }}>
              <div style={{ display: 'inline-flex', padding: 16, background: '#fff', borderRadius: 14, border: '1px solid var(--border)' }}>
                <QRCodeSVG
                  value={`SWMS|${hh.id}|${hh.qr}`}
                  size={148}
                  level="M"
                  marginSize={0}
                  fgColor="#0b2a1e"
                  bgColor="#ffffff"
                />
              </div>
              <div className="mono small mt-8" style={{ fontWeight: 600 }}>{hh.qr}</div>
              <div className="tiny muted-3 mt-4">Scan to identify household · {hh.id}</div>
            </div>
          )}
          <dl className="kv">
            <dt>Service type</dt><dd>{TYPE_META[hh._type].label}</dd>
            <dt>Ward / Zone</dt><dd>{hh.ward}</dd>
            <dt>Road</dt><dd>{hh.road}</dd>
            <dt>Holding no.</dt><dd>{hh.holding}</dd>
            <dt>Contact</dt><dd className="mono">{hh.phone}</dd>
            <dt>{potential ? 'Estimated tier' : 'Charge tier'}</dt><dd>{tierLabel(hh.tier)} <span className="muted-3">(৳{tierCharge(hh.tier)})</span></dd>
            {potential ? <>
              <dt>Surveyed by</dt><dd>{hh.surveyor ? collectorName(hh.surveyor) : '—'}</dd>
              <dt>Surveyed on</dt><dd>{hh.surveyedAt}</dd>
            </> : <>
              <dt>Status</dt><dd><Status value={hh.status} /></dd>
              <dt>Last visit</dt><dd>{hh.lastVisit ? new Date(hh.lastVisit).toLocaleString() : <span className="badge badge-warn"><span className="dot" />never</span>}</dd>
              <dt>Outstanding</dt><dd>{hh.dues > 0 ? <b style={{ color: 'var(--danger)' }}>৳{hh.dues}</b> : '৳0 — clear'}</dd>
            </>}
          </dl>
          {potential && (
            <div className="card-pad" style={{ background: 'var(--brand-050)', borderRadius: 10, marginTop: 16 }}>
              <div className="small" style={{ fontWeight: 600, color: 'var(--brand-700)' }}>Potential customer</div>
              <div className="tiny muted mt-4">Bring this home under service to generate a QR tag, ledger and monthly bill.</div>
            </div>
          )}
          <div className="row gap-8 mt-24">
            {onConvert && <button className="btn btn-primary grow" onClick={onConvert}><IconArrow size={15} /> Bring under service</button>}
            <button className={`btn ${onConvert ? 'btn-ghost' : 'btn-primary'} grow`} onClick={onEdit}><IconEdit size={15} /> Edit</button>
          </div>
        </div>
      </aside>
    </>
  )
}

