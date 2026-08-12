import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader, Section, EmptyState } from '../components/ui.jsx'
import { Field, FormRow, FormSection } from '../components/Modal.jsx'
import { holdings as api } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { IconPlus, IconHome, IconTrash } from '../components/Icons.jsx'

// Registering a building and the families in it, on one page.
//
// A modal was the wrong shape for this. The two records are entered on one
// visit to one door, and between them they carry about forty fields — which in
// a dialog meant scrolling a small box, and made the household side a reduced
// version of itself. As a page there is room for both: the building on the
// left, its families on the right, which is also how they relate.
//
// The whole page is one save. A form that half-succeeded would leave a building
// registered with some of its flats missing and nothing to say which, and the
// operator standing at the door has no way to tell.

const BLANK_HOLDING = {
  district: '', thana: '', ward: '', road: '', holdingNo: '', holdingType: '',
  ownerName: '', ownerPhone: '', ownerAltPhone: '', ownerEmail: '',
  floors: '', unitsTotal: '', notes: '',
}

// A family row as the form holds it. `id` is absent until it has been saved,
// which is exactly what tells the server to create rather than update.
function blankFamily(catalog) {
  return {
    _key: `new-${Math.random().toString(36).slice(2, 9)}`,
    head: '', customerType: catalog?.customerTypes?.[0]?.id || '',
    phone: '', altPhone: '', profession: '', email: '', contactPerson: '', bloodGroup: '',
    unit: '', holdingType: catalog?.holdingTypes?.[0]?.id || '', floor: '', address: '',
    members: '', membersUnder5: '', membersFemale: '',
    storage: catalog?.storageTypes?.[0]?.id || '',
    suitableTime: catalog?.suitableTimes?.[0]?.id || '',
    tier: catalog?.tiers?.[0]?.id || '', charge: '',
    paymentMode: catalog?.paymentModes?.[0]?.id || '', paymentDay: 5,
  }
}

// A saved household, in the shape the form edits.
function familyFromRecord(row) {
  return {
    _key: row.id,
    id: row.id,
    head: row.head || '', customerType: row.customerType || '',
    phone: row.phone || '', altPhone: row.altPhone || '', profession: row.profession || '',
    email: row.email || '', contactPerson: row.contactPerson || '',
    bloodGroup: row.bloodGroup || '',
    unit: row.unit || '', holdingType: row.holdingType || '', floor: row.floor || '',
    address: row.address || '',
    members: row.members ?? '', membersUnder5: row.membersUnder5 ?? '',
    membersFemale: row.membersFemale ?? '',
    storage: row.storage || '', suitableTime: row.suitableTime || '',
    tier: row.tier || '', charge: row.charge ?? '',
    paymentMode: row.paymentMode || '', paymentDay: row.paymentDay ?? 5,
    // Read for the badge only. The editor does not send a status, so an
    // inactive family stays inactive rather than being flipped back by an
    // edit that was about something else.
    status: row.status || 'active',
    // Read-only, shown so the operator can see what a family owes without
    // leaving the page. Never sent back.
    dues: row.dues ?? 0,
    qr: row.qr || null,
  }
}

const num = (v) => (v === '' || v == null ? undefined : Number(v))

// `paymentDay` is a day of the month — a bill falls due on the 5th, every month
// — but the form asks for it with a date picker. The month shown is simply the
// current one, so the calendar opens somewhere sensible; only the day is kept.
// The range is pinned to the 1st–28th because those are the only days every
// month actually has.
function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const dayToDate = (day) => (day ? `${thisMonth()}-${String(day).padStart(2, '0')}` : '')
const dateToDay = (value) => {
  const day = Number(String(value || '').slice(8, 10))
  return day >= 1 && day <= 28 ? day : ''
}

export default function HoldingEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, taka, lang } = useLang()
  const { canWrite } = useAuth()
  const { catalog } = useData()
  const isNew = !id

  const [form, setForm] = useState(BLANK_HOLDING)
  const [families, setFamilies] = useState([])
  const [open, setOpen] = useState(null)      // which family is expanded
  const [loading, setLoading] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rowErrors, setRowErrors] = useState({})

  const load = useCallback(async () => {
    if (isNew) return
    setLoading(true)
    try {
      const [holding, members] = await Promise.all([api.get(id), api.households(id)])
      setForm({
        district: holding.district || '', thana: holding.thana || '',
        ward: holding.ward || '', road: holding.road || '',
        holdingNo: holding.holdingNo || '', holdingType: holding.holdingType || '',
        ownerName: holding.ownerName || '', ownerPhone: holding.ownerPhone || '',
        ownerAltPhone: holding.ownerAltPhone || '', ownerEmail: holding.ownerEmail || '',
        floors: holding.floors ?? '', unitsTotal: holding.unitsTotal ?? '',
        notes: holding.notes || '',
      })
      const rows = Array.isArray(members) ? members : members.results || []
      setFamilies(rows.map(familyFromRecord))
      setError('')
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [id, isNew, t])

  useEffect(() => { load() }, [load])

  // Defaults for a brand-new building, once the catalog has arrived.
  useEffect(() => {
    if (!isNew || !catalog?.holdingTypes?.length) return
    setForm((f) => (f.holdingType ? f : { ...f, holdingType: catalog.holdingTypes[0].id }))
  }, [isNew, catalog])

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }
  const roads = catalog?.roadsByWard?.[form.ward] || []

  // District narrows the thana list, the same way ward narrows the road list.
  // Both are stored and sent as English names — the Bangla name is what the
  // operator reads, not what the record keeps, so a database exported in one
  // language still means something in the other.
  const thanas = catalog?.thanasByDistrict?.[form.district] || []
  const geoLabel = (row) => (lang === 'bn' && row.nameBn ? row.nameBn : row.name)
  const setDistrict = (e) => {
    // A thana belongs to exactly one district, so it cannot survive the change.
    setForm((f) => ({ ...f, district: e.target.value, thana: '' }))
    setError('')
  }

  function setFamily(index, key, value) {
    setFamilies((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
    setRowErrors((e) => { const next = { ...e }; delete next[index]; return next })
    setError('')
  }

  function addFamily() {
    const row = blankFamily(catalog)
    setFamilies((rows) => [...rows, row])
    setOpen(row._key)
    setError('')
  }

  // Only a row that has never been saved can leave the page this way. A family
  // already on the register is retired by setting it inactive, because its
  // bills, payments and collection history hang off it.
  function dropFamily(index) {
    setFamilies((rows) => rows.filter((_, i) => i !== index))
    setRowErrors({})
  }

  const payload = useMemo(() => ({
    ...form,
    floors: form.floors === '' ? null : Number(form.floors),
    unitsTotal: form.unitsTotal === '' ? null : Number(form.unitsTotal),
    households: families.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      head: r.head.trim(), customerType: r.customerType || undefined,
      phone: r.phone, altPhone: r.altPhone, profession: r.profession,
      email: r.email, contactPerson: r.contactPerson, bloodGroup: r.bloodGroup,
      unit: r.unit.trim(), holdingType: r.holdingType || undefined, floor: r.floor,
      address: r.address,
      members: num(r.members), membersUnder5: num(r.membersUnder5),
      membersFemale: num(r.membersFemale),
      storage: r.storage || undefined, suitableTime: r.suitableTime || undefined,
      tier: r.tier, charge: num(r.charge),
      paymentMode: r.paymentMode || undefined, paymentDay: num(r.paymentDay),
    })),
  }), [form, families])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!form.ward) { setError(t('holdings.wardRequired')); return }
    if (!form.road) { setError(t('holdings.roadRequired')); return }
    if (!form.holdingNo.trim()) { setError(t('holdings.holdingNoRequired')); return }
    if (!form.ownerName.trim()) { setError(t('holdings.ownerRequired')); return }

    const blank = families.findIndex((r) => !r.head.trim())
    if (blank !== -1) {
      setRowErrors({ [blank]: { head: t('holdings.family.headRequired') } })
      setOpen(families[blank]._key)
      setError(t('holdings.family.fixRows'))
      return
    }

    setBusy(true)
    setRowErrors({})
    try {
      const saved = isNew ? await api.create(payload) : await api.update(id, payload)
      navigate('/app/holdings', { state: { savedHolding: saved.id } })
    } catch (err) {
      // The server answers with one entry per family row, empty where the row
      // is fine, so a message lands on the family it belongs to.
      const perRow = err?.fields?.households
      if (Array.isArray(perRow) && perRow.some((r) => r && Object.keys(r).length)) {
        const marked = Object.fromEntries(
          perRow.map((r, i) => [i, r]).filter(([, r]) => r && Object.keys(r).length)
        )
        setRowErrors(marked)
        const first = Number(Object.keys(marked)[0])
        setOpen(families[first]?._key ?? null)
        setError(t('holdings.family.fixRows'))
      } else {
        setError(err?.fieldError?.('holdingNo') || err?.detail || t('common.requestFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  const opt = (list) => (catalog?.[list] || []).map((o) => ({ value: o.id, label: t(o.key) }))
  const activeCount = families.filter((r) => r.status === 'active').length

  if (loading) {
    return <div className="fade-in"><Section>{t('common.loading')}</Section></div>
  }

  return (
    <div className="fade-in">
      <PageHeader
        sticky
        title={isNew ? t('holdings.formNew') : t('holdings.formEdit')}
        subtitle={isNew
          ? t('holdings.editor.subtitleNew')
          // The dictionary has no plural rules, so the two cases are two keys.
          : families.length === 1
            ? t('holdings.editor.subtitleEditOne', { id })
            : t('holdings.editor.subtitleEdit', { id, count: families.length })}
        actions={<>
          <button type="button" className="btn" onClick={() => navigate('/app/holdings')}>
            {t('holdings.editor.backToList')}
          </button>
          {canWrite && (
            <button type="submit" form="holding-editor" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner" /> : t('holdings.editor.save')}
            </button>
          )}
        </>}
      />

      {error && <div className="app-banner error" role="alert">{error}</div>}

      <form id="holding-editor" onSubmit={submit}>
        <div className="editor-split">
          {/* ---------------------------------------------- the building --- */}
          <Section title={<><IconHome size={16} /> {t('holdings.editor.buildingPanel')}</>}>
            <FormSection title={t('holdings.group.address')} first>
              {/* National geography, above the city's own wards. Ordered the way
                  an address is read out: district, then thana, then ward. */}
              <FormRow>
                <Field half as="select" label={t('holdings.district')} value={form.district}
                  onChange={setDistrict} disabled={busy}
                  options={[{ value: '', label: '—' },
                    ...(catalog?.districts || []).map((d) => ({ value: d.name, label: geoLabel(d) }))]} />
                <Field half as="select" label={t('holdings.thana')} value={form.thana}
                  onChange={set('thana')} disabled={busy}
                  hint={form.district ? undefined : t('holdings.pickDistrictFirst')}
                  options={[{ value: '', label: '—' },
                    ...thanas.map((row) => ({ value: row.name, label: geoLabel(row) }))]} />
              </FormRow>
              <FormRow>
                <Field half as="select" label={t('holdings.col.ward')} value={form.ward}
                  onChange={(e) => { set('ward')(e); setForm((f) => ({ ...f, road: '' })) }}
                  disabled={busy}
                  options={[{ value: '', label: '—' },
                    ...(catalog?.wards || []).map((w) => ({ value: w.id, label: w.name }))]} />
                <Field half as="select" label={t('holdings.col.road')} value={form.road}
                  onChange={set('road')} disabled={busy}
                  hint={form.ward ? undefined : t('holdings.editor.pickWardFirst')}
                  options={[{ value: '', label: '—' },
                    ...roads.map((name) => ({ value: name, label: name }))]} />
              </FormRow>
              <FormRow>
                <Field half label={t('holdings.col.holdingNo')} value={form.holdingNo}
                  onChange={set('holdingNo')} placeholder="142/B" disabled={busy} autoFocus={isNew} />
                <Field half as="select" label={t('holdings.holdingType')} value={form.holdingType}
                  onChange={set('holdingType')} disabled={busy} options={opt('holdingTypes')} />
              </FormRow>
              <FormRow>
                <Field half label={t('holdings.floors')} type="number" min="0"
                  value={form.floors} onChange={set('floors')} disabled={busy} />
                <Field half label={t('holdings.unitsTotal')} type="number" min="0"
                  value={form.unitsTotal} onChange={set('unitsTotal')} disabled={busy}
                  hint={t('holdings.unitsHint')} />
              </FormRow>
            </FormSection>

            <FormSection title={t('holdings.group.owner')}>
              <FormRow>
                <Field half label={t('holdings.ownerName')} value={form.ownerName}
                  onChange={set('ownerName')} disabled={busy} />
                <Field half label={t('holdings.ownerPhone')} value={form.ownerPhone}
                  onChange={set('ownerPhone')} placeholder="01XXXXXXXXX" disabled={busy} />
              </FormRow>
              <FormRow>
                <Field half label={t('holdings.editor.ownerAltPhone')} value={form.ownerAltPhone}
                  onChange={set('ownerAltPhone')} placeholder="01XXXXXXXXX" disabled={busy} />
                <Field half label={t('holdings.editor.ownerEmail')} type="email"
                  value={form.ownerEmail} onChange={set('ownerEmail')} disabled={busy} />
              </FormRow>
            </FormSection>

            {/* No status picker. A building being registered is in service, and
                a record retired later is handled where that decision is made,
                not on the form used to enter it. */}
            <FormSection title={t('holdings.editor.notesGroup')}>
              <Field as="textarea" label={t('holdings.notes')} value={form.notes}
                onChange={set('notes')} disabled={busy} rows={3} />
              {/* The pin is deliberately absent. A building has one position and
                  confirming it is a separate, stamped action taken standing at
                  the door — not a coordinate typed at a desk. */}
              <div className="tiny muted-3">{t('holdings.editor.locationNote')}</div>
            </FormSection>
          </Section>

          {/* ---------------------------------------------- the families --- */}
          <Section
            title={<>{t('holdings.editor.familiesPanel')}{' '}
              <span className="tiny muted">
                {t('holdings.editor.familyCount', { count: families.length, active: activeCount })}
              </span></>}
            actions={canWrite && (
              <button type="button" className="btn btn-ghost" onClick={addFamily} disabled={busy}>
                <IconPlus size={14} /> {t('holdings.family.add')}
              </button>
            )}
            pad={false}
          >
            {families.length === 0 && (
              <EmptyState>{t('holdings.family.none')}</EmptyState>
            )}

            <div className="family-list">
              {families.map((row, index) => (
                <FamilyCard
                  key={row._key}
                  row={row}
                  index={index}
                  expanded={open === row._key}
                  errors={rowErrors[index]}
                  busy={busy}
                  catalog={catalog}
                  t={t}
                  taka={taka}
                  opt={opt}
                  onToggle={() => setOpen(open === row._key ? null : row._key)}
                  onChange={(key, value) => setFamily(index, key, value)}
                  onDrop={() => dropFamily(index)}
                />
              ))}
            </div>
          </Section>
        </div>
      </form>
    </div>
  )
}

// One family: a summary line that is always visible, and the full field set
// underneath when it is open. Collapsed by default so a twelve-flat building is
// a list you can read rather than twelve forms stacked on top of each other.
function FamilyCard({
  row, index, expanded, errors, busy, catalog, t, taka, opt, onToggle, onChange, onDrop,
}) {
  const set = (key) => (e) => onChange(key, e.target.value)
  const isSaved = Boolean(row.id)
  const bad = errors && Object.keys(errors).length > 0

  return (
    <div className={`family-card${expanded ? ' open' : ''}${bad ? ' bad' : ''}`}>
      <div className="family-head">
        <button type="button" className="family-toggle" onClick={onToggle} aria-expanded={expanded}>
          <span className="family-index">{index + 1}</span>
          <span className="family-title">
            {row.unit
              ? <><strong>{row.unit}</strong> · {row.head || t('holdings.editor.unnamed')}</>
              : (row.head || t('holdings.editor.unnamed'))}
          </span>
          {row.status === 'inactive' && (
            <span className="badge badge-muted"><span className="dot" />{t('status.inactive')}</span>
          )}
          {isSaved
            ? <span className="tiny muted-3 mono">{row.id}</span>
            : <span className="badge badge-info"><span className="dot" />{t('holdings.editor.unsaved')}</span>}
        </button>
        {/* Only an unsaved row can be removed here — see `dropFamily`. */}
        {!isSaved && (
          <button type="button" className="btn btn-ghost family-remove" onClick={onDrop}
            disabled={busy} title={t('holdings.family.remove')}
            aria-label={t('holdings.family.remove')}>
            <IconTrash size={14} />
          </button>
        )}
      </div>

      {bad && (
        <div className="family-error">{Object.values(errors).flat().join(' ')}</div>
      )}

      {expanded && (
        <div className="family-body">
          <FormSection title={t('households.group.customer')} first>
            <FormRow>
              <Field half label={t('households.field.name')} value={row.head}
                onChange={set('head')} disabled={busy} />
              <Field half as="select" label={t('households.field.customerType')}
                value={row.customerType} onChange={set('customerType')} disabled={busy}
                options={opt('customerTypes')} />
            </FormRow>
            <FormRow>
              <Field third label={t('households.field.phone')} value={row.phone}
                onChange={set('phone')} placeholder="01XXXXXXXXX" disabled={busy} />
              <Field third label={t('households.field.altPhone')} value={row.altPhone}
                onChange={set('altPhone')} placeholder="01XXXXXXXXX" disabled={busy} />
              <Field third label={t('households.field.profession')} value={row.profession}
                onChange={set('profession')} disabled={busy} />
            </FormRow>
            <FormRow>
              {/* Email takes a third rather than a half so all three still fit
                  on one line in the narrower right-hand column. */}
              <Field third label={t('households.field.email')} type="email" value={row.email}
                onChange={set('email')} disabled={busy} />
              <Field third label={t('households.field.contactPerson')} value={row.contactPerson}
                onChange={set('contactPerson')} disabled={busy} />
              {/* Eight fixed values, two characters each — it joins the row
                  above rather than taking one of its own. */}
              <Field narrow as="select" label={t('households.field.bloodGroup')}
                value={row.bloodGroup} onChange={set('bloodGroup')} disabled={busy}
                options={[{ value: '', label: '—' },
                  ...(catalog?.bloodGroups || []).map((b) => ({ value: b, label: b }))]} />
            </FormRow>
          </FormSection>

          <FormSection title={t('holdings.editor.flatGroup')}>
            <FormRow>
              <Field third label={t('holdings.unit')} value={row.unit} onChange={set('unit')}
                hint={t('holdings.unitHint')} disabled={busy} />
              <Field third as="select" label={t('households.field.holdingType')}
                value={row.holdingType} onChange={set('holdingType')} disabled={busy}
                options={opt('holdingTypes')} />
              <Field third label={t('households.field.floor')} value={row.floor}
                onChange={set('floor')} disabled={busy} />
            </FormRow>
            {/* Ward, road and holding number are not here: they belong to the
                building on the left and are copied down on save. */}
            <Field as="textarea" label={t('households.field.address')} value={row.address}
              onChange={set('address')} rows={2} disabled={busy}
              hint={t('holdings.editor.addressHint')} />
          </FormSection>

          <FormSection title={t('households.group.waste')}>
            <FormRow>
              <Field third type="number" min="0" label={t('households.field.membersCount')}
                value={row.members} onChange={set('members')} disabled={busy} />
              <Field third type="number" min="0" label={t('households.field.membersUnder5Full')}
                value={row.membersUnder5} onChange={set('membersUnder5')} disabled={busy} />
              <Field third type="number" min="0" label={t('households.field.membersFemale')}
                value={row.membersFemale} onChange={set('membersFemale')} disabled={busy} />
            </FormRow>
            <FormRow>
              <Field half as="select" label={t('households.field.storage')} value={row.storage}
                onChange={set('storage')} disabled={busy} options={opt('storageTypes')} />
              <Field half as="select" label={t('households.field.suitableTime')}
                value={row.suitableTime} onChange={set('suitableTime')} disabled={busy}
                options={opt('suitableTimes')} />
            </FormRow>
          </FormSection>

          <FormSection title={t('households.group.charge')}>
            <FormRow>
              <Field half as="select" label={t('households.field.tier')} value={row.tier}
                onChange={set('tier')} disabled={busy}
                options={(catalog?.tiers || []).map((ti) => ({
                  value: ti.id, label: `${t(ti.key)} (${taka(ti.charge)})`,
                }))} />
              <Field half type="number" min="0" label={t('households.field.serviceChargeMonthly')}
                value={row.charge} onChange={set('charge')} disabled={busy}
                hint={t('holdings.editor.chargeHint')} />
            </FormRow>
            <FormRow>
              <Field half as="select" label={t('households.field.paymentMode')}
                value={row.paymentMode} onChange={set('paymentMode')} disabled={busy}
                options={opt('paymentModes')} />
              <Field half type="date" label={t('households.field.paymentDate')}
                min={`${thisMonth()}-01`} max={`${thisMonth()}-28`}
                value={dayToDate(row.paymentDay)}
                onChange={(e) => onChange('paymentDay', dateToDay(e.target.value))}
                hint={t('holdings.editor.paymentDayHint')} disabled={busy} />
            </FormRow>
            {isSaved && (
              <FormRow>
                <Field half label={t('households.field.duesOutstanding')}
                  value={taka(row.dues || 0)} readOnly disabled />
              </FormRow>
            )}
          </FormSection>
        </div>
      )}
    </div>
  )
}
