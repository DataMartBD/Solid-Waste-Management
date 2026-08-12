import { useState, useMemo, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Status } from './ui.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from './Modal.jsx'
import { IconSearch, IconHome } from './Icons.jsx'
import { holdings as holdingsApi } from '../api/endpoints.js'
import { HoldingForm } from '../pages/Holdings.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

// The household form and detail view, lifted out of the old global Households
// page so the per-building register can use them unchanged.
//
// A household is the same record wherever it is edited, so there is one form
// for it. What differs is the context: on a building's page the holding is
// already known and fixed, so the picker is hidden and the building is passed
// in. Everywhere else the picker still asks.

export const TYPE_META = {
  under_service: { key: 'households.type.under_service', badge: 'badge-ok' },
  potential: { key: 'households.type.potential', badge: 'badge-info' },
}

export const TODAY = new Date().toISOString().slice(0, 10)

// Location is not handled on this page. A building has one position, so the
// pin and its verification trail belong to the Holding Master; a household
// reads them through its holding and can neither show nor change them here.
const num = (v) => Number(v) || 0

// The household's address, derived from its holding. Mirrors what the server
// writes when the field is left blank, so what the form shows and what gets
// stored are the same string rather than two near-misses.
export function addressFor(holding, unit) {
  if (!holding) return ''
  const base = holding.address || `Holding ${holding.holdingNo}, ${holding.road}`
  return unit ? `Flat ${unit}, ${base}` : base
}

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
export function underPayload(d) {
  return {
    ...profileOf(d),
    // `ward` and `road` are no longer sent: they belong to the holding and are
    // read-only on this endpoint, so posting them was at best ignored and at
    // worst implied they could be edited here.
    head: d.head.trim(), phone: d.phone || '', holding: d.holding, unit: d.unit || '',
    tier: d.tier, status: d.status,
    charge: num(d.charge), paymentMode: d.paymentMode, paymentDay: num(d.paymentDay) || 5,
  }
}

// …and the same for a potential customer, which keeps the survey answers instead
// of the billing/status fields. Payment terms are only agreed once the holding is
// actually brought under service, so they are dropped here.
export function potentialPayload(d) {
  return {
    ...profileOf(d),
    head: d.head.trim(), phone: d.phone || '', holding: d.holding, unit: d.unit || '',
    estTier: d.tier, surveyor: d.surveyor || null, surveyedAt: d.surveyedAt || TODAY,
    reason: d.reason, timeGap: d.timeGap, currentPractice: d.currentPractice,
  }
}

function HoldingPicker({ value, wards, disabled, onChange }) {
  const { t } = useLang()
  const { catalog } = useData()
  const [options, setOptions] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const box = useRef(null)

  const label = (o) => `${o.holdingNo} · ${o.road} · ${o.ward}`

  // Debounced so a fast typist makes one request per pause, not one per key.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await holdingsApi.list({ search: query || undefined })
        if (!cancelled) setOptions(Array.isArray(data) ? data : data.results || [])
      } catch {
        if (!cancelled) setOptions([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, open])

  // Resolve the current value to a row so an edit form shows the holding it is
  // actually on, rather than an empty box that reads as "none chosen".
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (selected?.id === value) return
    let cancelled = false
    holdingsApi.get(value).then((row) => { if (!cancelled) setSelected(row) }).catch(() => {})
    return () => { cancelled = true }
  }, [value, selected])

  // Clicking outside commits whatever is selected and drops the draft query.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(row) {
    setSelected(row)
    setOpen(false)
    setQuery('')
    // The address travels with the building — that is the point of the holding
    // owning it. Handing the row up lets the form fill its address field.
    onChange(row.id, row)
  }

  return (
    <>
      <div className="field" ref={box} style={{ position: 'relative' }}>
        <label>{t('holdings.pick')}</label>
        <input
          className="input"
          disabled={disabled}
          value={open ? query : (selected ? label(selected) : '')}
          placeholder={t('holdings.pickPlaceholder')}
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          autoComplete="off"
        />
        {open && (
          <div className="holding-menu">
            {loading && <div className="holding-menu-note">{t('common.loading')}</div>}
            {!loading && options.length === 0 && (
              <div className="holding-menu-note">{t('holdings.noMatch')}</div>
            )}
            {options.map((o) => (
              <button
                type="button"
                key={o.id}
                className={`holding-menu-item${o.id === value ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o)}
              >
                <span style={{ fontWeight: 600 }}>{o.holdingNo}</span>
                <span className="tiny muted-3"> · {o.road} · {o.ward}</span>
                <div className="tiny muted-3">{o.ownerName}</div>
              </button>
            ))}
          </div>
        )}
        <div className="tiny muted-3" style={{ marginTop: 4 }}>{t('holdings.pickHint')}</div>
      </div>
      <div className="row gap-8" style={{ marginTop: 2 }}>
        {selected && <span className="tiny muted-3">{t('holdings.col.owner')}: {selected.ownerName}</span>}
        <button type="button" className="link-btn tiny" disabled={disabled} onClick={() => setCreating(true)}>
          {t('holdings.addInline')}
        </button>
      </div>

      {creating && (
        <HoldingForm
          holding={{}}
          catalog={{ ...catalog, wards }}
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            // Select what was just created, so the flow continues in one go.
            setCreating(false)
            setOptions((prev) => [saved, ...prev])
            pick(saved)
          }}
        />
      )}
    </>
  )
}

function FieldError({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{children}</div>
}

export function HouseholdForm({
  initial, collectors, lists, tierCharge, onClose, onSave,
  // The building, when the form is opened from that building's own page. Given
  // one, the picker is hidden: the answer is already known and offering to
  // change it would be a way to move a family into another block by accident.
  holding = null,
}) {
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
    // Without this the server refuses the blank id and the generic
    // "some fields need attention" envelope is all the user sees, with nothing
    // pointing at the holding.
    if (!form.holding) { setError({ detail: t('holdings.pickRequired') }); return }
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
            <Field third label={t('households.field.email')} type="email" value={form.email} onChange={set('email')} placeholder={t('households.ph.email')} disabled={busy} />
            <Field third label={t('households.field.contactPerson')} value={form.contactPerson} onChange={set('contactPerson')} disabled={busy}
              placeholder={t('households.ph.contactPerson')} hint={t('households.hint.contactPerson')} />
            {/* Eight fixed values, two characters each — it rides along with the
                email row rather than taking one of its own. */}
            <Field narrow as="select" label={t('households.field.bloodGroup')} value={form.bloodGroup} onChange={set('bloodGroup')} disabled={busy}
              options={[{ value: '', label: '—' }, ...bloodGroups.map((b) => ({ value: b, label: b }))]}
              hint={t('households.hint.bloodGroup')} />
          </FormRow>
          <FieldError>{fieldError('email')}</FieldError>
        </FormSection>

        <FormSection title={t('households.group.address')}>
          {/* Ward, road and holding number are no longer typed here: they belong
              to the holding and are copied down on save, so an edit made here
              would be silently overwritten. Choosing the building sets all
              three at once — which is also what makes "holding first, then
              household" true rather than merely advised. */}
          {holding ? (
            <div className="field">
              <label>{t('holdings.pick')}</label>
              <div className="input" style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-2)' }}>
                {holding.holdingNo} · {holding.ownerName} · {holding.road}
              </div>
              <div className="tiny muted-3">{t('holdings.lockedToBuilding')}</div>
            </div>
          ) : (
          <HoldingPicker
            value={form.holding}
            wards={wards}
            disabled={busy}
            onChange={(id, row) => setForm((f) => ({
              ...f,
              holding: id,
              // Kept so editing the flat number can rebuild the address without
              // another round trip. Payload builders list their fields, so this
              // never reaches the server.
              _holdingRow: row || f._holdingRow,
              // The address belongs to the building, so it follows the building.
              // Rebuilt from the holding rather than copied, so a flat number
              // already typed stays in it: "Flat 3B, Holding 142/B, KDA Avenue".
              address: row ? addressFor(row, f.unit) : f.address,
            }))}
          />
          )}
          <FieldError>{fieldError('holding') || fieldError('non_field_errors')}</FieldError>
          <FormRow>
            <Field third label={t('holdings.unit')} value={form.unit || ''} disabled={busy}
              hint={t('holdings.unitHint')}
              onChange={(e) => setForm((f) => ({
                ...f,
                unit: e.target.value,
                address: f._holdingRow ? addressFor(f._holdingRow, e.target.value) : f.address,
              }))} />
            <Field third as="select" label={t('households.field.holdingType')} value={form.holdingType} onChange={set('holdingType')} disabled={busy}
              options={holdingTypes.map((ht) => ({ value: ht.id, label: optLabel(holdingTypes, ht.id) }))} />
            <Field third label={t('households.field.floor')} value={form.floor} onChange={set('floor')} placeholder={t('households.ph.floor')} disabled={busy} />
          </FormRow>
          <FieldError>{fieldError('unit')}</FieldError>
          <Field as="textarea" label={t('households.field.address')} value={form.address} onChange={set('address')} disabled={busy}
            placeholder={t('households.ph.address')} rows={2} />
        </FormSection>

        {/* No location block here any more. A building has one position, so the
            pin, its accuracy and the verification trail live on the Holding
            Master — this form would only ever have shown a copy. */}

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

export function HouseholdDrawer({ hh, collectorName, lists, tierCharge, effectiveCharge, onClose, onEdit, onConvert, busy }) {
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
            <dt>{t('households.field.holdingNo')}</dt><dd>{hh.holdingNo}{hh.unit ? ` · ${hh.unit}` : ''}</dd>
            <dt>{t('households.field.holdingType')}</dt><dd>{optLabel(holdingTypes, hh.holdingType)}</dd>
            <dt>{t('households.field.floor')}</dt><dd>{hh.floor ? digits(hh.floor) : '—'}</dd>
            <dt>{t('households.field.address')}</dt><dd>{hh.address || '—'}</dd>
          </KvGroup>

          {/* The building's position, shown here for context. It is not edited
              from this screen — pinning happens on the Holding Master. */}
          <KvGroup title={t('households.group.holdingLocation')}>
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
              <div className="tiny" style={{ color: 'var(--warn-fg)', marginTop: 6 }}>
                {t('households.verifyOnHolding', { holding: hh.holdingNo })}
              </div>
            </div>
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
            {onConvert && <button className="btn btn-primary grow" disabled={busy} onClick={onConvert}><IconArrow size={15} /> {t('households.bringUnderService')}</button>}
            {onEdit && <button className={`btn ${onConvert ? 'btn-ghost' : 'btn-primary'} grow`} onClick={onEdit}><IconEdit size={15} /> {t('common.edit')}</button>}
          </div>
        </div>
      </aside>
    </>
  )
}
