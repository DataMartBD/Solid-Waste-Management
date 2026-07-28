import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { PageHeader, Status, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import VerifyLocationModal from '../components/VerifyLocationModal.jsx'
import QrScanner, { tagOf } from '../components/QrScanner.jsx'
import { IconSearch, IconQr, IconPlus, IconHome, IconEdit, IconTrash, IconEye, IconArrow, IconMap, IconAlert, IconCheck } from '../components/Icons.jsx'
import { useData } from '../context/DataContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../i18n/index.jsx'

// The two household types requested:
//   under_service  → household currently giving waste to a collector  (households collection)
//   potential      → surveyed home not yet under service              (potentialCustomers collection)
// `key` is the i18n key for the type's label — this is a service type, not a
// record status, so it has its own strings rather than reusing status.*.
const TYPE_META = {
  under_service: { key: 'households.type.under_service', badge: 'badge-ok' },
  potential: { key: 'households.type.potential', badge: 'badge-info' },
}

const TODAY = new Date().toISOString().slice(0, 10)

// ---- location verification --------------------------------------------------
// A holding is only routable once someone has confirmed where it actually is.
// Until then it has no coordinates at all — never a placeholder, because a
// made-up point is worse than a blank one: it looks planned and sends a collector
// to the wrong lane.
//
// Confirming a pin is a dedicated server action (POST …/verify/), not a field
// write: the server stamps who verified it and when, and refuses a coordinate
// outside Bangladesh. Nothing on this page writes lat/lng/verified directly.
const GEO_TIMEOUT = 8000 // ms — a collector in a poor-signal lane must not wait

// One GPS read, always settled: resolves with a fix or a reason, never hangs.
function captureFix() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ ok: false, reason: 'unsupported' }); return }
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    // A belt-and-braces timer: some browsers never fire the error callback.
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), GEO_TIMEOUT + 500)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        done({
          ok: true,
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
          accuracy: pos.coords.accuracy == null ? null : Math.round(pos.coords.accuracy),
        })
      },
      (err) => {
        clearTimeout(timer)
        const reason = err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable'
        done({ ok: false, reason })
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT, maximumAge: 0 },
    )
  })
}

const num = (v) => Number(v) || 0

// The customer-information fields shared by both household types. Kept in one
// place so registering, editing and converting all carry the same profile.
function profileOf(d) {
  return {
    customerType: d.customerType,
    profession: d.profession || '',
    address: d.address || '',
    email: d.email || '',
    altPhone: d.altPhone || '',
    contactPerson: d.contactPerson || '',
    bloodGroup: d.bloodGroup || '',
    members: num(d.members),
    membersUnder5: num(d.membersUnder5),
    membersFemale: num(d.membersFemale),
    storage: d.storage,
    holdingType: d.holdingType,
    floor: d.floor || '',
    suitableTime: d.suitableTime,
  }
}

// What an under-service household sends. Location, dues, the QR tag and
// `lastVisit` are all server-owned: the tag is minted on create, dues come from
// billing, `lastVisit` is derived from the visit log, and coordinates only ever
// change through the verify action.
function underPayload(d) {
  return {
    ...profileOf(d),
    head: d.head.trim(), phone: d.phone || '', ward: d.ward, road: d.road, holding: d.holding,
    tier: d.tier, status: d.status,
    charge: num(d.charge), paymentMode: d.paymentMode, paymentDay: num(d.paymentDay) || 5,
  }
}

// …and the same for a potential customer, which keeps the survey answers instead
// of the billing/status fields. Payment terms are only agreed once the holding is
// actually brought under service, so they are dropped here.
function potentialPayload(d) {
  return {
    ...profileOf(d),
    head: d.head.trim(), phone: d.phone || '', ward: d.ward, road: d.road, holding: d.holding,
    estTier: d.tier, surveyor: d.surveyor || null, surveyedAt: d.surveyedAt || TODAY,
    reason: d.reason, timeGap: d.timeGap, currentPractice: d.currentPractice,
  }
}

export default function Households() {
  const {
    households, potentialCustomers, collectors, create, update, remove, act, api, ready,
    wards, roadsByWard, tiers, customerTypes, holdingTypes, storageTypes, suitableTimes,
    paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices,
    tierCharge, effectiveCharge, collectorName,
  } = useData()
  const { t, n, taka, digits, date, optLabel, wardName } = useLang()
  const { user, canWrite } = useAuth()
  const [q, setQ] = useState('')
  const [ward, setWard] = useState('all')
  const [custF, setCustF] = useState('all') // residential | commercial | …
  const [typeF, setTypeF] = useState('all') // all | under_service | potential
  const [verF, setVerF] = useState('all') // all | verified | unverified
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(null)
  const [verifying, setVerifying] = useState(null)   // record under review, shown in the confirm modal
  const [locating, setLocating] = useState(false)     // a GPS read is in flight
  const [saving, setSaving] = useState(false)         // a write is in flight
  const [geoError, setGeoError] = useState(null)
  const [fix, setFix] = useState(null)               // the latest raw reading
  const [note, setNote] = useState(null)             // page-level result line
  const [scanning, setScanning] = useState(false)    // the "find by tag" reader
  const [unplanned, setUnplanned] = useState(null)   // planner backlog, from the server
  const captureToken = useRef(0)                      // discards readings from an abandoned capture

  // The planner's backlog: how much of the register is not on any route, split
  // by whether the pin has been confirmed. Computed server-side over the whole
  // register, not over the rows this page happens to hold.
  const loadUnplanned = useCallback(async () => {
    try {
      const data = await api.households.unplanned()
      setUnplanned({ routable: data.routable.length, unverified: data.unverified.length, total: data.total })
    } catch { setUnplanned(null) }
  }, [api])

  useEffect(() => { if (ready) loadUnplanned() }, [ready, loadUnplanned])

  // Unify both collections into one normalized list for the table.
  const unified = useMemo(() => ([
    ...households.map((h) => ({ ...h, _type: 'under_service', _coll: 'households' })),
    ...potentialCustomers.map((p) => ({ ...p, _type: 'potential', _coll: 'potentialCustomers', tier: p.estTier, dues: 0, status: 'potential', qr: null })),
  ]), [households, potentialCustomers])

  const rows = useMemo(() => unified.filter((h) => {
    if (typeF !== 'all' && h._type !== typeF) return false
    if (verF === 'verified' && !h.verified) return false
    if (verF === 'unverified' && h.verified) return false
    if (ward !== 'all' && h.ward !== ward) return false
    if (custF !== 'all' && h.customerType !== custF) return false
    if (!q) return true
    const s = q.toLowerCase()
    return [h.id, h.head, h.qr, h.holding, h.road, h.phone, h.altPhone, h.email, h.profession]
      .some((v) => String(v || '').toLowerCase().includes(s))
  }), [unified, typeF, verF, ward, custF, q])

  const counts = {
    all: unified.length,
    under_service: households.length,
    potential: potentialCustomers.length,
    verified: unified.filter((h) => h.verified).length,
    unverified: unified.filter((h) => !h.verified).length,
  }

  // Verification is a two-step act: read the position, show it to whoever is
  // standing there, and only write once they confirm the pin is on the right
  // gate. A GPS reading in a narrow lane is a claim, not a fact.
  // Each capture carries a token. A reading whose token is stale — the verifier
  // cancelled, or moved on to another holding — is dropped rather than applied,
  // because geolocation gives us no way to cancel the request itself.
  async function readPosition() {
    const token = ++captureToken.current
    setLocating(true)
    setGeoError(null)
    const reading = await captureFix()
    if (token !== captureToken.current) return
    setLocating(false)
    if (!reading.ok) {
      setGeoError(t(`households.geo.${reading.reason}`, { seconds: n(GEO_TIMEOUT / 1000) }))
      return
    }
    setFix(reading)
  }

  function openVerify(rec) {
    setVerifying(rec)
    setFix(null)
    setGeoError(null)
    readPosition()
  }

  function closeVerify() {
    captureToken.current += 1 // orphan any reading still in flight
    setVerifying(null)
    setFix(null)
    setGeoError(null)
    setLocating(false)
  }

  // Called only from the confirm button in the modal.
  async function commitVerification({ lat, lng, accuracy, placedByHand }) {
    const rec = verifying
    if (!rec || saving) return
    setSaving(true)
    setGeoError(null)
    const endpoint = rec._coll === 'households' ? api.households : api.potentialCustomers
    const result = await act(endpoint.verify(rec.id, { lat, lng, accuracy, placedByHand }), { refresh: [rec._coll] })
    setSaving(false)
    if (!result.ok) {
      // A pin outside Bangladesh comes back as a field error on lat or lng.
      const error = result.error
      setGeoError(error?.fieldError?.('lat') || error?.fieldError?.('lng') || error?.detail || t('households.verifyFailed'))
      return
    }
    // the drawer holds its own snapshot — keep it in step with what was written
    setSelected((s) => (s && s.id === rec.id ? { ...s, ...result.data } : s))
    loadUnplanned()
    closeVerify()
  }

  // Columns for the export (View / PDF / Excel / CSV)
  const exportColumns = [
    { key: 'id', label: t('households.col.id') },
    { key: 'head', label: t('households.col.head') },
    { key: '_type', label: t('households.col.type'), get: (r) => t(TYPE_META[r._type].key) },
    { key: 'ward', label: t('households.col.ward') },
    { key: 'road', label: t('households.col.road') },
    { key: 'holding', label: t('households.col.holding') },
    { key: 'qr', label: t('households.col.qr'), get: (r) => r.qr || '—' },
    { key: 'floor', label: t('households.field.floor'), get: (r) => (r.floor ? digits(r.floor) : '—') },
    { key: 'holdingType', label: t('households.field.holdingType'), get: (r) => optLabel(holdingTypes, r.holdingType) },
    { key: 'customerType', label: t('households.field.customerType'), get: (r) => optLabel(customerTypes, r.customerType) },
    { key: 'profession', label: t('households.field.profession'), get: (r) => r.profession || '—' },
    { key: 'phone', label: t('households.field.phone'), get: (r) => (r.phone ? digits(r.phone) : '—') },
    { key: 'altPhone', label: t('households.field.altPhone'), get: (r) => (r.altPhone ? digits(r.altPhone) : '—') },
    { key: 'email', label: t('households.field.email'), get: (r) => r.email || '—' },
    { key: 'contactPerson', label: t('households.field.contactPerson'), get: (r) => r.contactPerson || '—' },
    { key: 'address', label: t('households.field.address'), get: (r) => r.address || '—' },
    { key: 'bloodGroup', label: t('households.field.bloodGroup'), get: (r) => r.bloodGroup || '—' },
    { key: 'members', label: t('households.field.members'), get: (r) => (r.members ? n(r.members) : '—') },
    { key: 'membersUnder5', label: t('households.field.membersUnder5'), get: (r) => (r.membersUnder5 == null ? '—' : n(r.membersUnder5)) },
    { key: 'membersFemale', label: t('households.field.membersFemale'), get: (r) => (r.membersFemale == null ? '—' : n(r.membersFemale)) },
    { key: 'storage', label: t('households.field.storage'), get: (r) => optLabel(storageTypes, r.storage) },
    { key: 'suitableTime', label: t('households.field.suitableTime'), get: (r) => optLabel(suitableTimes, r.suitableTime) },
    { key: 'tier', label: t('households.field.tier'), get: (r) => optLabel(tiers, r.tier) },
    { key: 'serviceCharge', label: t('households.field.serviceChargeTk'), get: (r) => n(r.effectiveCharge ?? effectiveCharge(r)) },
    // payment terms are agreed at conversion — a potential customer has none yet
    { key: 'paymentMode', label: t('households.field.paymentMode'), get: (r) => (r._type === 'potential' ? '—' : optLabel(paymentModes, r.paymentMode)) },
    { key: 'paymentDay', label: t('households.field.paymentDate'), get: (r) => (r.paymentDay ? t('common.day', { n: n(r.paymentDay) }) : '—') },
    { key: 'dues', label: t('households.field.duesTk'), get: (r) => (r._type === 'potential' ? '—' : n(r.dues)) },
    { key: 'status', label: t('households.field.status'), get: (r) => t(`status.${r._type === 'potential' ? 'potential' : r.status}`) },
    // location verification — a planner reads these to work the queue
    { key: 'verified', label: t('households.field.locationStatus'), get: (r) => t(r.verified ? 'households.verified' : 'households.unverified') },
    { key: 'lat', label: t('households.field.latitude'), get: (r) => (r.lat == null ? '—' : digits(Number(r.lat).toFixed(5))) },
    { key: 'lng', label: t('households.field.longitude'), get: (r) => (r.lng == null ? '—' : digits(Number(r.lng).toFixed(5))) },
    // `verifiedBy` is a label the server resolves (a collector id or an operator's name).
    { key: 'verifiedBy', label: t('households.field.verifiedBy'), get: (r) => r.verifiedBy || '—' },
    { key: 'verifiedAt', label: t('households.field.verifiedOn'), get: (r) => (r.verifiedAt ? date(r.verifiedAt) : '—') },
    // survey columns — only meaningful for potential customers
    { key: 'reason', label: t('households.field.reason'), get: (r) => (r._type === 'potential' ? optLabel(potentialReasons, r.reason) : '—') },
    { key: 'timeGap', label: t('households.field.timeGap'), get: (r) => (r._type === 'potential' ? optLabel(timeGaps, r.timeGap) : '—') },
    { key: 'currentPractice', label: t('households.field.currentPractice'), get: (r) => (r._type === 'potential' ? optLabel(currentPractices, r.currentPractice) : '—') },
  ]
  const exportScope = typeF === 'all' ? t('common.all') : t(TYPE_META[typeF].key)
  const exportTitle = `${t('households.exportTitle', { scope: exportScope })}${ward !== 'all' ? ` · ${ward}` : ''}`

  // A blank record needs ids from the catalog, which arrives with the first load.
  function blank(type) {
    const firstWard = wards[0]?.id || ''
    return {
      _type: type, head: '', ward: firstWard, road: (roadsByWard[firstWard] || [''])[0], holding: '', phone: '',
      tier: tiers[0]?.id || '', status: 'active', dues: 0, surveyor: '', surveyedAt: TODAY,
      customerType: customerTypes[0]?.id || '', profession: '', address: '', email: '', altPhone: '', contactPerson: '',
      bloodGroup: '', members: '', membersUnder5: '', membersFemale: '', storage: storageTypes[0]?.id || '',
      holdingType: holdingTypes[0]?.id || '', floor: '', suitableTime: suitableTimes[0]?.id || '', charge: '',
      paymentMode: paymentModes[0]?.id || '', paymentDay: 5,
      reason: potentialReasons[0]?.id || '', timeGap: timeGaps[0]?.id || '', currentPractice: currentPractices[0]?.id || '',
    }
  }

  // Conversion keeps the survey row (stamped converted) so the funnel report has
  // its history — the server hides converted rows from the default list, so the
  // holding still disappears from the "potential" tab. Never delete it afterwards.
  async function convert(p) {
    if (saving) return
    if (!confirm(t('households.confirmConvert', { name: p.head }))) return
    setSaving(true)
    setNote(null)
    const result = await act(
      api.potentialCustomers.convert(p.id, {}),
      { refresh: ['households', 'potentialCustomers'] },
    )
    setSaving(false)
    if (!result.ok) {
      setNote({ tone: 'bad', text: result.error?.detail || t('households.convertFailed') })
      return
    }
    setSelected(null)
    loadUnplanned()
    setNote({ tone: 'ok', text: t('households.convertDone', { name: p.head, id: result.data.household.id }) })
  }

  async function removeRow(h) {
    if (saving) return
    if (!confirm(t('households.confirmDelete', { id: h.id, name: h.head }))) return
    setSaving(true)
    const result = await remove(h._coll, h.id)
    setSaving(false)
    if (!result.ok) { setNote({ tone: 'bad', text: result.error?.detail || t('households.saveFailed') }); return }
    setNote(null)
    loadUnplanned()
  }

  // A scanned tag is resolved by the server, so a sticker that is not in the rows
  // currently on screen still opens its holding.
  function onTagFound(raw, household) {
    setScanning(false)
    if (!household) {
      setNote({ tone: 'bad', text: t('households.tagUnknown', { code: tagOf(raw) }) })
      return
    }
    setNote(null)
    setSelected({ ...household, _type: 'under_service', _coll: 'households' })
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('households.title')}
        subtitle={t('households.subtitle', { under: n(counts.under_service), potential: n(counts.potential) })}
        actions={<>
          <ExportMenu title={exportTitle} subtitle={`${t('common.records', { count: n(rows.length) })} · ${t('app.name')} SWMS`}
            columns={exportColumns} rows={rows} filename="households" />
          <button className="btn btn-ghost" onClick={() => setScanning(true)}>
            <IconQr size={16} /> {t('households.findByTag')}
          </button>
          <button className="btn btn-primary" disabled={!canWrite}
            onClick={() => setEditing(blank(typeF === 'potential' ? 'potential' : 'under_service'))}>
            <IconPlus size={16} /> {t('households.register')}
          </button>
        </>}
      />

      {note && (
        <div className={`form-note ${note.tone}`} style={{ marginBottom: 16 }}>
          {note.tone === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}<span>{note.text}</span>
        </div>
      )}

      <div className="filter-bar">
        <div className="seg">
          {[
            ['all', t('households.filter.all', { count: n(counts.all) })],
            ['under_service', t('households.filter.underService', { count: n(counts.under_service) })],
            ['potential', t('households.filter.potential', { count: n(counts.potential) })],
          ].map(([k, l]) => (
            <button key={k} className={typeF === k ? 'on' : ''} onClick={() => setTypeF(k)}>{l}</button>
          ))}
        </div>
        {/* the verification queue — unverified holdings cannot be routed at all */}
        <div className="seg">
          {[
            ['all', t('households.filter.all', { count: n(counts.all) })],
            ['verified', t('households.filter.verified', { count: n(counts.verified) })],
            ['unverified', t('households.filter.unverified', { count: n(counts.unverified) })],
          ].map(([k, l]) => (
            <button key={k} className={verF === k ? 'on' : ''} onClick={() => setVerF(k)}>{l}</button>
          ))}
        </div>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('households.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="select" style={{ width: 'auto' }} value={ward} onChange={(e) => setWard(e.target.value)}>
          <option value="all">{t('households.allWards')}</option>
          {wards.map((w) => <option key={w.id} value={w.id}>{wardName(w.id)}</option>)}
        </select>
        <select className="select" style={{ width: 'auto' }} value={custF} onChange={(e) => setCustF(e.target.value)}>
          <option value="all">{t('households.allCustomerTypes')}</option>
          {customerTypes.map((c) => <option key={c.id} value={c.id}>{optLabel(customerTypes, c.id)}</option>)}
        </select>
        <div className="grow" />
        {unplanned && unplanned.total > 0 && (
          <span className="tiny muted-3">
            {t('households.unplannedNote', { total: n(unplanned.total), blocked: n(unplanned.unverified) })}
          </span>
        )}
        <span className="tiny muted">{t('common.shown', { count: n(rows.length) })}</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{t('households.col.id')}</th><th>{t('households.col.head')}</th><th>{t('households.col.type')}</th>
                <th>{t('households.col.ward')}</th><th>{t('households.col.road')}</th><th>{t('households.col.holding')}</th>
                <th>{t('households.col.location')}</th>
                <th>{t('households.col.tier')}</th><th>{t('households.col.dues')}</th><th>{t('households.col.status')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="mono" style={{ cursor: 'pointer' }} onClick={() => setSelected(h)}>{h.id}</td>
                  <td style={{ fontWeight: 600 }}>
                    {h.head}
                    {h.customerType && <div className="tiny muted-3" style={{ fontWeight: 500 }}>{optLabel(customerTypes, h.customerType)}</div>}
                  </td>
                  <td><span className={`badge ${TYPE_META[h._type].badge}`}><span className="dot" />{t(TYPE_META[h._type].key)}</span></td>
                  <td>{h.ward}</td>
                  <td className="small">{h.road}</td>
                  <td>{h.holding}</td>
                  <td>
                    {h.verified
                      ? <span className="badge badge-ok"><span className="dot" />{t('households.verified')}</span>
                      : <span className="badge badge-warn"><span className="dot" />{t('households.unverified')}</span>}
                  </td>
                  <td className="small">{optLabel(tiers, h.tier)}</td>
                  <td>{h._type === 'potential' ? <span className="muted-3">—</span> : h.dues > 0 ? <b style={{ color: 'var(--danger)' }}>{taka(h.dues)}</b> : <span className="muted-3">{taka(0)}</span>}</td>
                  <td><Status value={h.status} /></td>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      {!h.verified && (
                        <button className="act-btn" title={t('households.verifyLocation')} disabled={!canWrite}
                          onClick={() => openVerify(h)} style={{ color: 'var(--warn-fg)' }}>
                          <IconMap size={16} />
                        </button>
                      )}
                      {h._type === 'potential' && (
                        <button className="act-btn" title={t('households.bringUnderService')} disabled={!canWrite || saving} onClick={() => convert(h)} style={{ color: 'var(--brand)' }}><IconArrow size={16} /></button>
                      )}
                      <button className="act-btn" title={t('common.details')} onClick={() => setSelected(h)}><IconEye size={16} /></button>
                      <button className="act-btn" title={t('common.edit')} disabled={!canWrite} onClick={() => setEditing(h)}><IconEdit size={15} /></button>
                      <button className="act-btn danger" title={t('common.delete')} disabled={!canWrite || saving} onClick={() => removeRow(h)}><IconTrash size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <EmptyState><IconHome size={28} /><div className="mt-8">{t('households.empty')}</div></EmptyState>}
        </div>
      </div>

      {selected && <HouseholdDrawer hh={selected} collectorName={collectorName}
        lists={{ customerTypes, holdingTypes, storageTypes, suitableTimes, tiers, paymentModes, potentialReasons, timeGaps, currentPractices }}
        tierCharge={tierCharge} effectiveCharge={effectiveCharge}
        onClose={() => setSelected(null)}
        onEdit={canWrite ? () => { setEditing(selected); setSelected(null) } : null}
        onVerify={canWrite ? () => openVerify(selected) : null}
        verifying={saving}
        onConvert={selected._type === 'potential' && canWrite ? () => convert(selected) : null} />}

      {editing && (
        <HouseholdForm
          initial={editing}
          collectors={collectors}
          lists={{ wards, roadsByWard, tiers, customerTypes, holdingTypes, storageTypes, suitableTimes, paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices }}
          tierCharge={tierCharge}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const isPotential = data._type === 'potential'
            const collection = isPotential ? 'potentialCustomers' : 'households'
            const payload = isPotential ? potentialPayload(data) : underPayload(data)
            const result = data.id && data._coll === collection
              ? await update(collection, data.id, payload)
              : await create(collection, payload)
            if (result.ok) { setEditing(null); loadUnplanned() }
            return result
          }}
        />
      )}

      {verifying && (
        <VerifyLocationModal
          household={verifying}
          verifierName={user?.name || '—'}
          busy={locating}
          saving={saving}
          error={geoError}
          fix={fix}
          onRecapture={readPosition}
          onConfirm={commitVerification}
          onClose={closeVerify}
        />
      )}

      {scanning && (
        <Modal title={t('households.findByTagTitle')} subtitle={t('households.findByTagHint')} onClose={() => setScanning(false)} width={480}>
          <QrScanner onDetect={onTagFound} />
          <ManualTag onFound={onTagFound} api={api} />
        </Modal>
      )}
    </div>
  )
}

// Keyed-in tag, for a sticker too worn to scan. Resolved by the same endpoint.
function ManualTag({ onFound, api }) {
  const { t } = useLang()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const tag = tagOf(value)
    if (!tag || busy) return
    setBusy(true)
    let household = null
    try { household = await api.households.byQr(tag) } catch { household = null }
    setBusy(false)
    onFound(tag, household)
  }

  return (
    <form className="mt-16" onSubmit={submit}>
      <Field label={t('collection.scan.manualLabel')} value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={t('collection.scan.manualPlaceholder')} disabled={busy} />
      <ModalActions>
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? <><span className="spinner" /> {t('collection.scan.checking')}</> : t('collection.scan.check')}
        </button>
      </ModalActions>
    </form>
  )
}

// One server field message, under the row that produced it.
function FieldError({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{children}</div>
}

function HouseholdForm({ initial, collectors, lists, tierCharge, onClose, onSave }) {
  const { t, taka, digits, optLabel, wardName } = useLang()
  const {
    wards, roadsByWard, tiers, customerTypes, holdingTypes, storageTypes,
    suitableTimes, paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices,
  } = lists
  const [form, setForm] = useState({ ...initial, tier: initial.tier || initial.estTier || tiers[0]?.id || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const roads = roadsByWard[form.ward] || []
  const isPotential = form._type === 'potential'
  const editing = !!form.id
  const fieldError = (name) => error?.fieldError?.(name)
  // "Residential — standard (৳100)" — the tier's own label plus its standard charge.
  const tierOptions = tiers.map((ti) => ({ value: ti.id, label: `${optLabel(tiers, ti.id)} (${taka(ti.charge)})` }))

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const total = Number(form.members) || 0
    if (!form.head.trim()) { setError({ detail: t('households.alertHeadRequired') }); return }
    if (total && ((Number(form.membersUnder5) || 0) > total || (Number(form.membersFemale) || 0) > total)) {
      setError({ detail: t('households.alertMembers') })
      return
    }
    setBusy(true)
    setError(null)
    // Coordinates are never sent from this form: a location is whatever the pin
    // was placed on during verification, and only the verify action may write it.
    const result = await onSave(form)
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={editing ? t('households.formEdit') : t('households.register')}
      subtitle={editing ? form.id : t('households.chooseType')} onClose={onClose} width={720}>
      <form onSubmit={submit}>
        {!editing && (
          <div className="field" style={{ marginBottom: 14 }}>
            <label>{t('households.householdType')}</label>
            <div className="seg" style={{ width: 'fit-content' }}>
              {['under_service', 'potential'].map((k) => (
                <button type="button" key={k} className={form._type === k ? 'on' : ''} onClick={() => setForm((f) => ({ ...f, _type: k }))}>{t(TYPE_META[k].key)}</button>
              ))}
            </div>
            <div className="tiny muted-3">
              {isPotential ? t('households.potentialHint') : t('households.underServiceHint')}
            </div>
          </div>
        )}

        <FormSection title={t('households.group.customer')} first={editing}>
          <FormRow>
            <Field half label={t('households.field.name')} value={form.head} onChange={set('head')} placeholder={t('households.ph.fullName')} autoFocus disabled={busy} />
            <Field half as="select" label={t('households.field.customerType')} value={form.customerType} onChange={set('customerType')} disabled={busy}
              options={customerTypes.map((c) => ({ value: c.id, label: optLabel(customerTypes, c.id) }))} />
          </FormRow>
          <FieldError>{fieldError('head')}</FieldError>
          <FormRow>
            <Field third label={t('households.field.phone')} value={form.phone} onChange={set('phone')} placeholder={t('households.ph.phone')} disabled={busy} />
            <Field third label={t('households.field.altPhone')} value={form.altPhone} onChange={set('altPhone')} placeholder={t('households.ph.phone')} disabled={busy} />
            <Field third label={t('households.field.profession')} value={form.profession} onChange={set('profession')} placeholder={t('households.ph.profession')} disabled={busy} />
          </FormRow>
          <FieldError>{fieldError('phone')}</FieldError>
          <FormRow>
            <Field half label={t('households.field.email')} type="email" value={form.email} onChange={set('email')} placeholder={t('households.ph.email')} disabled={busy} />
            <Field half label={t('households.field.contactPerson')} value={form.contactPerson} onChange={set('contactPerson')} disabled={busy}
              placeholder={t('households.ph.contactPerson')} hint={t('households.hint.contactPerson')} />
          </FormRow>
          <FieldError>{fieldError('email')}</FieldError>
          <FormRow>
            <Field third as="select" label={t('households.field.bloodGroup')} value={form.bloodGroup} onChange={set('bloodGroup')} disabled={busy}
              options={[{ value: '', label: '—' }, ...bloodGroups.map((b) => ({ value: b, label: b }))]}
              hint={t('households.hint.bloodGroup')} />
          </FormRow>
        </FormSection>

        <FormSection title={t('households.group.address')}>
          <FormRow>
            <Field half as="select" label={t('households.col.ward')} value={form.ward} disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, ward: e.target.value, road: (roadsByWard[e.target.value] || [''])[0] }))}
              options={wards.map((w) => ({ value: w.id, label: wardName(w.id) }))} />
            <Field half as="select" label={t('households.col.road')} value={form.road} onChange={set('road')} disabled={busy} options={roads.map((r) => ({ value: r, label: r }))} />
          </FormRow>
          {/* A road is validated against its ward server-side: the same name in
              two wards is two different roads, and an unknown one is refused. */}
          <FieldError>{fieldError('road') || fieldError('ward')}</FieldError>
          <FormRow>
            <Field third label={t('households.field.holdingNo')} value={form.holding} onChange={set('holding')} placeholder={t('households.ph.holding')} disabled={busy} />
            <Field third as="select" label={t('households.field.holdingType')} value={form.holdingType} onChange={set('holdingType')} disabled={busy}
              options={holdingTypes.map((ht) => ({ value: ht.id, label: optLabel(holdingTypes, ht.id) }))} />
            <Field third label={t('households.field.floor')} value={form.floor} onChange={set('floor')} placeholder={t('households.ph.floor')} disabled={busy} />
          </FormRow>
          <FieldError>{fieldError('holding') || fieldError('non_field_errors')}</FieldError>
          <Field as="textarea" label={t('households.field.address')} value={form.address} onChange={set('address')} disabled={busy}
            placeholder={t('households.ph.address')} rows={2} />
        </FormSection>

        {/* Read-only on purpose: the coordinates are whatever the pin was placed
            on during verification, and nothing else may write them. */}
        <FormSection title={t('households.group.location')} hint={t('households.hint.location')}>
          <div className="verify-readout">
            <div>
              <div className="tiny muted-3">{t('households.field.locationStatus')}</div>
              <div style={{ fontWeight: 600 }}>
                {form.verified
                  ? <span className="badge badge-ok"><span className="dot" />{t('households.verified')}</span>
                  : <span className="badge badge-warn"><span className="dot" />{t('households.unverified')}</span>}
              </div>
            </div>
            <div>
              <div className="tiny muted-3">{t('households.field.latitude')}</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {form.lat == null ? '—' : digits(Number(form.lat).toFixed(6))}
              </div>
            </div>
            <div>
              <div className="tiny muted-3">{t('households.field.longitude')}</div>
              <div className="mono" style={{ fontWeight: 600 }}>
                {form.lng == null ? '—' : digits(Number(form.lng).toFixed(6))}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title={t('households.group.waste')} hint={t('households.hint.waste')}>
          <FormRow>
            <Field third type="number" min="0" label={t('households.field.membersCount')} value={form.members} onChange={set('members')} placeholder={digits('0')} disabled={busy} />
            <Field third type="number" min="0" label={t('households.field.membersUnder5Full')} value={form.membersUnder5} onChange={set('membersUnder5')} placeholder={digits('0')} disabled={busy} />
            <Field third type="number" min="0" label={t('households.field.membersFemale')} value={form.membersFemale} onChange={set('membersFemale')} placeholder={digits('0')} disabled={busy} />
          </FormRow>
          <FormRow>
            <Field half as="select" label={t('households.field.storage')} value={form.storage} onChange={set('storage')} disabled={busy}
              options={storageTypes.map((s) => ({ value: s.id, label: optLabel(storageTypes, s.id) }))} />
            <Field half as="select" label={t('households.field.suitableTime')} value={form.suitableTime} onChange={set('suitableTime')} disabled={busy}
              options={suitableTimes.map((s) => ({ value: s.id, label: optLabel(suitableTimes, s.id) }))} />
          </FormRow>
        </FormSection>

        {/* Charge and payment terms only exist once a holding is actually billed. */}
        {!isPotential && (
          <FormSection title={t('households.group.charge')}>
            <FormRow>
              <Field half as="select" label={t('households.field.tier')} value={form.tier} onChange={set('tier')} disabled={busy}
                options={tierOptions} />
              <Field half type="number" min="0" label={t('households.field.serviceChargeMonthly')} value={form.charge} onChange={set('charge')} disabled={busy}
                placeholder={digits(String(tierCharge(form.tier)))} hint={t('households.hint.charge', { amount: taka(tierCharge(form.tier)) })} />
            </FormRow>
            <FieldError>{fieldError('tier') || fieldError('charge')}</FieldError>
            <FormRow>
              <Field half as="select" label={t('households.field.paymentMode')} value={form.paymentMode} onChange={set('paymentMode')} disabled={busy}
                options={paymentModes.map((p) => ({ value: p.id, label: optLabel(paymentModes, p.id) }))} />
              <Field half type="number" min="1" max="28" label={t('households.field.paymentDate')} value={form.paymentDay} onChange={set('paymentDay')} disabled={busy}
                hint={t('households.hint.paymentDay')} />
            </FormRow>
            <FieldError>{fieldError('paymentDay') || fieldError('paymentMode')}</FieldError>
            <FormRow>
              {/* status labels come from the shared status.* keys so the dropdown
                  matches the badge it produces on the list */}
              <Field half as="select" label={t('households.field.status')} value={form.status} onChange={set('status')} disabled={busy}
                options={[{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }]} />
              {/* Dues are a billing figure now: they move when a bill is raised or
                  a payment is recorded, so they are shown, not typed. */}
              <Field half label={t('households.field.duesOutstanding')} value={form.dues ?? 0} disabled readOnly
                hint={t('households.hint.dues')} />
            </FormRow>
          </FormSection>
        )}

        {isPotential && (
          <FormSection title={t('households.group.survey')} hint={t('households.hint.survey')}>
            <FormRow>
              <Field half as="select" label={t('households.field.reason')} value={form.reason} onChange={set('reason')} disabled={busy}
                options={potentialReasons.map((r) => ({ value: r.id, label: optLabel(potentialReasons, r.id) }))} />
              <Field half as="select" label={t('households.field.timeGap')} value={form.timeGap} onChange={set('timeGap')} disabled={busy}
                options={timeGaps.map((tg) => ({ value: tg.id, label: optLabel(timeGaps, tg.id) }))} />
            </FormRow>
            <FormRow>
              <Field half as="select" label={t('households.field.currentPractice')} value={form.currentPractice} onChange={set('currentPractice')} disabled={busy}
                options={currentPractices.map((p) => ({ value: p.id, label: optLabel(currentPractices, p.id) }))} />
              <Field half as="select" label={t('households.field.estTier')} value={form.tier} onChange={set('tier')} disabled={busy}
                options={tierOptions}
                hint={t('households.hint.estTier')} />
            </FormRow>
            <FieldError>{fieldError('estTier') || fieldError('reason')}</FieldError>
            <FormRow>
              <Field half as="select" label={t('households.field.surveyedBy')} value={form.surveyor || ''} onChange={set('surveyor')} disabled={busy}
                options={[{ value: '', label: '—' }, ...collectors.map((c) => ({ value: c.id, label: c.name }))]} />
              <Field half label={t('households.field.surveyedOn')} type="date" value={form.surveyedAt || TODAY} onChange={set('surveyedAt')} disabled={busy} />
            </FormRow>
            <FieldError>{fieldError('surveyedAt') || fieldError('surveyor')}</FieldError>
          </FormSection>
        )}

        {error?.detail && (
          <div className="form-note bad" style={{ marginTop: 12 }}>
            <IconAlert size={15} /><span>{error.detail}</span>
          </div>
        )}

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy
              ? <><span className="spinner" /> {t('households.saving')}</>
              : editing ? t('common.saveChanges') : t('households.registerAction')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// A titled block of <dt>/<dd> pairs inside the detail drawer.
function KvGroup({ title, children }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <div className="tiny muted-3" style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      <dl className="kv">{children}</dl>
    </section>
  )
}

function HouseholdDrawer({ hh, collectorName, lists, tierCharge, effectiveCharge, onClose, onEdit, onConvert, onVerify, verifying }) {
  const { t, n, taka, digits, date, dateTime, optLabel } = useLang()
  const {
    customerTypes, holdingTypes, storageTypes, suitableTimes, tiers,
    paymentModes, potentialReasons, timeGaps, currentPractices,
  } = lists
  const potential = hh._type === 'potential'
  // The server computes this; fall back to the catalog for a row that predates it.
  const charge = hh.effectiveCharge ?? effectiveCharge(hh)
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="row gap-8">
              <h3 style={{ fontSize: 17 }}>{hh.head}</h3>
              <span className={`badge ${TYPE_META[hh._type].badge}`}><span className="dot" />{t(TYPE_META[hh._type].key)}</span>
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
              <div className="tiny muted-3 mt-4">{t('households.scanHint', { id: hh.id })}</div>
            </div>
          )}
          <KvGroup title={t('households.group.customer')}>
            <dt>{t('households.field.serviceType')}</dt><dd>{t(TYPE_META[hh._type].key)}</dd>
            <dt>{t('households.field.customerType')}</dt><dd>{optLabel(customerTypes, hh.customerType)}</dd>
            <dt>{t('households.field.profession')}</dt><dd>{hh.profession || '—'}</dd>
            <dt>{t('households.field.phone')}</dt><dd className="mono">{hh.phone ? digits(hh.phone) : '—'}</dd>
            <dt>{t('households.field.altPhoneShort')}</dt><dd className="mono">{hh.altPhone ? digits(hh.altPhone) : '—'}</dd>
            <dt>{t('households.field.email')}</dt><dd>{hh.email || '—'}</dd>
            <dt>{t('households.field.contactPerson')}</dt><dd>{hh.contactPerson || '—'}</dd>
            <dt>{t('households.field.bloodGroup')}</dt>
            <dd>{hh.bloodGroup ? <b style={{ color: 'var(--danger)' }}>{hh.bloodGroup}</b> : '—'}</dd>
          </KvGroup>

          <KvGroup title={t('households.group.address')}>
            <dt>{t('households.field.wardZone')}</dt><dd>{hh.ward}</dd>
            <dt>{t('households.col.road')}</dt><dd>{hh.road}</dd>
            <dt>{t('households.field.holdingNo')}</dt><dd>{hh.holding}</dd>
            <dt>{t('households.field.holdingType')}</dt><dd>{optLabel(holdingTypes, hh.holdingType)}</dd>
            <dt>{t('households.field.floor')}</dt><dd>{hh.floor ? digits(hh.floor) : '—'}</dd>
            <dt>{t('households.field.address')}</dt><dd>{hh.address || '—'}</dd>
          </KvGroup>

          <KvGroup title={t('households.group.location')}>
            <dt>{t('households.field.locationStatus')}</dt>
            <dd>{hh.verified
              ? <span className="badge badge-ok"><span className="dot" />{t('households.verified')}</span>
              : <span className="badge badge-warn"><span className="dot" />{t('households.unverified')}</span>}</dd>
            <dt>{t('households.field.latitude')}</dt>
            <dd className="mono">{hh.lat == null ? '—' : digits(Number(hh.lat).toFixed(5))}</dd>
            <dt>{t('households.field.longitude')}</dt>
            <dd className="mono">{hh.lng == null ? '—' : digits(Number(hh.lng).toFixed(5))}</dd>
            <dt>{t('households.field.accuracy')}</dt>
            <dd>{hh.accuracy == null ? '—' : t('households.metres', { n: n(hh.accuracy) })}</dd>
            {/* Resolved by the server — a collector id when the verifier is field
                staff, otherwise the operator's own name. */}
            <dt>{t('households.field.verifiedBy')}</dt><dd>{hh.verifiedBy ? collectorName(hh.verifiedBy) : '—'}</dd>
            <dt>{t('households.field.verifiedOn')}</dt><dd>{hh.verifiedAt ? date(hh.verifiedAt) : '—'}</dd>
          </KvGroup>

          {/* An unverified holding is not a detail — it is the reason nobody is
              collecting here, so it gets said plainly with the fix beside it. */}
          {!hh.verified && (
            <div className="card-pad" style={{ background: 'var(--warn-bg)', borderRadius: 10, marginTop: -6, marginBottom: 18 }}>
              <div className="tiny" style={{ color: 'var(--warn-fg)' }}>{t('households.notVerifiedNote')}</div>
            </div>
          )}
          {onVerify && (
            <button type="button" className={`btn ${hh.verified ? 'btn-ghost' : 'btn-primary'}`} style={{ width: '100%', marginBottom: 18 }}
              disabled={verifying} onClick={onVerify}>
              <IconMap size={15} /> {verifying
                ? t('households.verifying')
                : t(hh.verified ? 'households.reVerifyLocation' : 'households.verifyLocation')}
            </button>
          )}

          <KvGroup title={t('households.group.waste')}>
            <dt>{t('households.field.members')}</dt><dd>{hh.members ? n(hh.members) : '—'}</dd>
            <dt>{t('households.field.membersUnder5')}</dt><dd>{hh.membersUnder5 == null ? '—' : n(hh.membersUnder5)}</dd>
            <dt>{t('households.field.membersFemale')}</dt><dd>{hh.membersFemale == null ? '—' : n(hh.membersFemale)}</dd>
            <dt>{t('households.field.storage')}</dt><dd>{optLabel(storageTypes, hh.storage)}</dd>
            <dt>{t('households.field.suitableTime')}</dt><dd>{optLabel(suitableTimes, hh.suitableTime)}</dd>
          </KvGroup>

          {!potential && (
            <KvGroup title={t('households.group.charge')}>
              <dt>{t('households.field.tier')}</dt>
              <dd>{optLabel(tiers, hh.tier)} <span className="muted-3">({taka(tierCharge(hh.tier))})</span></dd>
              <dt>{t('households.field.serviceCharge')}</dt>
              <dd>{taka(charge)}{t('common.perMonth')} {charge !== tierCharge(hh.tier) && <span className="muted-3">{t('households.agreedRate')}</span>}</dd>
              <dt>{t('households.field.paymentMode')}</dt><dd>{optLabel(paymentModes, hh.paymentMode)}</dd>
              <dt>{t('households.field.expectedPayment')}</dt><dd>{hh.paymentDay ? t('households.dayOfMonth', { day: n(hh.paymentDay) }) : '—'}</dd>
              <dt>{t('households.field.status')}</dt><dd><Status value={hh.status} /></dd>
              {/* Derived from the visit log, so it can no longer go stale. */}
              <dt>{t('households.field.lastVisit')}</dt><dd>{hh.lastVisit ? dateTime(hh.lastVisit) : <span className="badge badge-warn"><span className="dot" />{t('common.never')}</span>}</dd>
              <dt>{t('households.field.outstanding')}</dt><dd>{hh.dues > 0 ? <b style={{ color: 'var(--danger)' }}>{taka(hh.dues)}</b> : t('households.duesClear', { amount: taka(0) })}</dd>
            </KvGroup>
          )}

          {potential && (
            <KvGroup title={t('households.group.survey')}>
              <dt>{t('households.field.reason')}</dt><dd>{optLabel(potentialReasons, hh.reason)}</dd>
              <dt>{t('households.field.timeGap')}</dt><dd>{optLabel(timeGaps, hh.timeGap)}</dd>
              <dt>{t('households.field.currentPractice')}</dt><dd>{optLabel(currentPractices, hh.currentPractice)}</dd>
              <dt>{t('households.field.estTier')}</dt>
              <dd>{optLabel(tiers, hh.tier)} <span className="muted-3">{t('households.estCharge', { amount: taka(tierCharge(hh.tier)) })}</span></dd>
              <dt>{t('households.field.surveyedBy')}</dt><dd>{hh.surveyor ? collectorName(hh.surveyor) : '—'}</dd>
              <dt>{t('households.field.surveyedOn')}</dt><dd>{hh.surveyedAt ? date(hh.surveyedAt) : '—'}</dd>
            </KvGroup>
          )}
          {potential && (
            <div className="card-pad" style={{ background: 'var(--brand-050)', borderRadius: 10, marginTop: 16 }}>
              <div className="small" style={{ fontWeight: 600, color: 'var(--brand-700)' }}>{t('households.potentialTitle')}</div>
              <div className="tiny muted mt-4">{t('households.potentialNote')}</div>
            </div>
          )}
          <div className="row gap-8 mt-24">
            {onConvert && <button className="btn btn-primary grow" disabled={verifying} onClick={onConvert}><IconArrow size={15} /> {t('households.bringUnderService')}</button>}
            {onEdit && <button className={`btn ${onConvert ? 'btn-ghost' : 'btn-primary'} grow`} onClick={onEdit}><IconEdit size={15} /> {t('common.edit')}</button>}
          </div>
        </div>
      </aside>
    </>
  )
}
