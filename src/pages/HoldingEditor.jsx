import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { PageHeader, Section, EmptyState } from '../components/ui.jsx'
import { Field, FormRow, FormSection } from '../components/Modal.jsx'
import { SearchSelect } from '../components/SearchSelect.jsx'
import { captureFix } from './Holdings.jsx'
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
//
// Everything is holding-wise: the service charge, the bill, the collection and
// the QR tag belong to the building, so the charge is set on the left. The
// customers on the right are a record of who lives there — and only when the
// building is collected floor by floor. At a single collection point (everyone
// brings their waste to one place) the flats are not registered at all.

const BLANK_HOLDING = {
  agency: '',
  district: '', thana: '', city: '', ward: '', road: '', lane: '', holdingNo: '', holdingType: '',
  ownerRole: 'owner', ownerName: '', ownerPhone: '',
  collectionPoint: 'single',
  floors: '', unitsTotal: '', notes: '',
  // Service charge — one per building.
  charge: '', paymentMode: '', paymentDay: 5,
}

// A customer row as the form holds it — one flat. `id` is absent until it has
// been saved, which is exactly what tells the server to create rather than
// update. The table asks for the customer's name, mobile, flat number, members
// and whether the flat is their own or rented.
function blankFamily(prefill) {
  return {
    _key: `new-${Math.random().toString(36).slice(2, 9)}`,
    head: prefill?.head || '', phone: prefill?.phone || '', unit: '', members: '',
    // Rented unless said otherwise.
    occupancy: prefill?.occupancy || 'rented', charge: '', status: 'active',
  }
}

// A new row nobody has typed into — the ones the flat count added and may take away.
// The default "rented" on its own does not count as typing.
const isUntouched = (r) => !r.id && !r.head && !r.phone && !r.unit && r.members === ''
  && (!r.occupancy || r.occupancy === 'rented') && r.charge === ''

// A saved household, in the shape the form edits.
function familyFromRecord(row) {
  return {
    _key: row.id,
    id: row.id,
    head: row.head || '', phone: row.phone || '', unit: row.unit || '',
    members: row.members ?? '', occupancy: row.occupancy || '',
    charge: row.charge ? String(row.charge) : '',
    // Read for the badge only. The editor does not send a status, so an
    // inactive family stays inactive rather than being flipped back by an
    // edit that was about something else.
    status: row.status || 'active',
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
  // Back to where the editor was opened from: the Holdings list, or a
  // holding's customer page.
  const backTo = useLocation().state?.from || '/app/holdings'
  const { t, taka, lang, localName } = useLang()
  const { canWrite, user } = useAuth()
  // An agency of their own means the server will stamp it; there is nothing to ask.
  const myAgency = user?.agency || null
  const { catalog, agencies } = useData()
  const isNew = !id
  // A ward-bound account (a collector) may only register buildings in its own
  // wards — the server refuses the rest — so the list offers only those.
  const myWards = user?.scopeKind === 'ward' && user?.scopeWards?.length ? user.scopeWards : null

  // A collector with one ward starts with it chosen.
  const [form, setForm] = useState(() => (
    isNew && myWards?.length === 1 ? { ...BLANK_HOLDING, ward: myWards[0] } : BLANK_HOLDING
  ))
  // Read-only facts about a saved building: its QR tag and what it owes.
  const [service, setService] = useState({ qr: null, dues: 0, effectiveCharge: 0 })
  // A new building's location is read from this device as the form opens and
  // saved with it — the person registering it is normally standing at it.
  const [gps, setGps] = useState({ status: isNew ? 'reading' : 'off' })
  const readGps = useCallback(async () => {
    setGps({ status: 'reading' })
    const fix = await captureFix()
    setGps(fix.ok ? { status: 'ok', ...fix } : { status: 'failed', reason: fix.reason })
  }, [])
  useEffect(() => { if (isNew) readGps() }, [isNew, readGps])

  // The building photo: the saved one, a newly chosen file, or "remove it".
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])
  function choosePhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { setError(t('holdings.photo.notImage')); return }
    if (file.size > 8 * 1024 * 1024) { setError(t('holdings.photo.tooBig')); return }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    setPhotoRemoved(false)
    setError('')
  }
  function clearPhoto() {
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoRemoved(Boolean(photoUrl))
  }
  const [families, setFamilies] = useState([])
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
        agency: holding.agency || '',
        district: holding.district || '', thana: holding.thana || '',
        ward: holding.ward || '', road: holding.road || '', lane: holding.lane || '',
        holdingNo: holding.holdingNo || '', holdingType: holding.holdingType || '',
        ownerRole: holding.ownerRole || 'owner',
        ownerName: holding.ownerName || '', ownerPhone: holding.ownerPhone || '',
        collectionPoint: holding.collectionPoint || 'single',
        floors: holding.floors ?? '', unitsTotal: holding.unitsTotal ?? '',
        notes: holding.notes || '',
        charge: holding.charge || '',
        paymentMode: holding.paymentMode || '', paymentDay: holding.paymentDay ?? 5,
      })
      setService({
        qr: holding.qr || null, dues: holding.dues ?? 0,
        effectiveCharge: holding.effectiveCharge ?? 0,
      })
      setPhotoUrl(holding.photoUrl || null)
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
    if (!isNew || !catalog?.paymentModes) return
    setForm((f) => ({
      ...f,
      paymentMode: f.paymentMode || catalog.paymentModes?.[0]?.id || '',
    }))
  }, [isNew, catalog])

  const set = (k) => (e) => {
    const value = e.target.value
    setForm((f) => ({
      ...f,
      [k]: value,
      // A kacha house (কাঁচা বাড়ি) is always collected at one place.
      ...(k === 'holdingType' && value === 'kacha' ? { collectionPoint: 'single' } : {}),
    }))
    setError('')
  }
  const roads = catalog?.roadsByWard?.[form.ward] || []

  // District → City Corporation / Pourashova → Ward → Road, each narrowing the
  // next. A district shows every city and pourashova set up in it (Setup gives
  // each its district); thana is no longer asked for. The city is not stored on
  // the holding — it is the ward's — so for a saved building it is read back
  // from the ward.
  const wardCity = (wardId) => (catalog?.wards || []).find((w) => w.id === wardId)?.city || ''
  const city = form.city || wardCity(form.ward)
  const cityChoices = (catalog?.cities || []).filter((c) => !form.district || c.district === form.district)
  const wardChoices = (catalog?.wards || []).filter((w) => (!myWards || myWards.includes(w.id))
    && (!city || w.city === city))
  // Built once per city / language, not on every keystroke — with no city
  // chosen this is every ward in the country.
  const wardOptions = useMemo(() => {
    const cities = new Map((catalog?.cities || []).map((c) => [c.id, c]))
    return wardChoices.map((w) => {
      const owner = city ? null : cities.get(w.city)
      return {
        value: w.id,
        label: owner ? `${localName(w)} · ${localName(owner)}` : localName(w),
        keywords: [w.id, w.name, w.nameBn, owner?.name, owner?.nameBn],
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, city, myWards?.join(','), localName])
  const setCity = (e) => {
    setForm((f) => ({ ...f, city: e.target.value, ward: '', road: '' }))
    setError('')
  }

  // Both are stored and sent as English names — the Bangla name is what the
  // operator reads, not what the record keeps, so a database exported in one
  // language still means something in the other.
  const geoLabel = (row) => (lang === 'bn' && row.nameBn ? row.nameBn : row.name)
  const setDistrict = (e) => {
    // A thana, and a city of another district, cannot survive the change.
    const district = e.target.value
    setForm((f) => {
      const current = f.city || wardCity(f.ward)
      const keeps = !district || (catalog?.cities || []).some((c) => c.id === current && c.district === district)
      return keeps
        ? { ...f, district, thana: '' }
        : { ...f, district, thana: '', city: '', ward: '', road: '' }
    })
    setError('')
  }

  function setFamily(index, key, value) {
    setFamilies((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)))
    setRowErrors((e) => { const next = { ...e }; delete next[index]; return next })
    setError('')
  }

  function addFamily() {
    setFamilies((rows) => [...rows, blankFamily()])
    setError('')
  }

  // Only a row that has never been saved can leave the page this way. A family
  // already on the register is retired by setting it inactive, because
  // complaints may name it.
  function dropFamily(index) {
    setFamilies((rows) => rows.filter((_, i) => i !== index))
    setRowErrors({})
  }

  const kacha = form.holdingType === 'kacha'
  const singlePoint = kacha || form.collectionPoint === 'single'
  // Floors and flats are asked for a multi-storey building (বহুতল ভবন) only.
  const multiStorey = form.holdingType === 'multi_storey'

  // The flat count starts the customer table: one row per flat. Raising it adds
  // empty rows; lowering it takes away only rows nobody has typed into, so a
  // flat already entered or saved is never lost by a change of number. In a
  // one-flat house the row starts with the owner's mobile, as their own home.
  const flats = multiStorey ? Number(form.unitsTotal) || 0 : 0
  useEffect(() => {
    if (singlePoint || loading) return
    setFamilies((rows) => {
      let next = rows
      while (next.length > flats && next.length && isUntouched(next[next.length - 1])) {
        next = next.slice(0, -1)
      }
      if (next.length < flats) {
        const add = Array.from({ length: flats - next.length }, () => blankFamily(
          flats === 1 && next.length === 0
            ? { head: form.ownerName.trim(), phone: form.ownerPhone.trim() } : null,
        ))
        next = [...next, ...add]
      }
      return next === rows ? rows : next
    })
    // The owner's phone is read once, when the rows are made — not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flats, singlePoint, loading])

  // Rows with something in them are saved; untouched new rows are not.
  const sent = singlePoint ? [] : families
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => !isUntouched(r))

  // Flat numbers as sent: typed ones as they are, and blank ones numbered in
  // turn (1, 2, 3 …) past any number already used — a building may have only
  // one flat without a number, so a blank is never sent twice.
  const units = useMemo(() => {
    const taken = new Set(sent.map(({ r }) => r.unit.trim().toLowerCase()).filter(Boolean))
    let next = 1
    return sent.map(({ r }) => {
      if (r.unit.trim()) return r.unit.trim()
      while (taken.has(String(next))) next += 1
      taken.add(String(next))
      return String(next++)
    })
  }, [sent])

  const payload = useMemo(() => ({
    ...form,
    collectionPoint: singlePoint ? 'single' : form.collectionPoint,
    // The city only narrows the ward list; the holding's city is its ward's.
    city: undefined,
    // Omitted rather than sent empty when nobody picked one: the server fills it
    // from the creator's own agency, and a null would talk it out of that.
    agency: form.agency || undefined,
    holdingType: form.holdingType || null,
    // Hidden unless multi-storey: then they are not sent, so a building's
    // recorded counts are left as they were.
    floors: multiStorey ? (form.floors === '' ? null : Number(form.floors)) : undefined,
    unitsTotal: multiStorey ? (form.unitsTotal === '' ? null : Number(form.unitsTotal)) : undefined,
    // No tier: every amount is typed. A tier saved earlier is left as it was.
    charge: num(form.charge) ?? 0,
    paymentMode: form.paymentMode || null,
    paymentDay: num(form.paymentDay),
    // A single collection point registers no flats, so none are sent.
    households: sent.map(({ r }, i) => ({
      ...(r.id ? { id: r.id } : {}),
      head: r.head.trim(), phone: r.phone.trim(), unit: units[i], members: num(r.members),
      occupancy: r.occupancy, charge: num(r.charge) ?? 0,
    })),
  }), [form, sent, units])

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (!form.ward) { setError(t('holdings.wardRequired')); return }
    if (!form.road.trim()) { setError(t('holdings.roadRequired')); return }
    if (!form.holdingNo.trim()) { setError(t('holdings.holdingNoRequired')); return }
    if (!form.ownerName.trim()) { setError(t('holdings.ownerRequired')); return }

    // Each flat filled in needs its flat number and a valid mobile.
    const problems = {}
    sent.forEach(({ r, index }) => {
      const row = {}
      if (!r.head.trim()) row.head = t('holdings.family.headRequired')
      if (!r.phone.trim()) row.phone = t('holdings.flatTable.phoneRequired')
      else if (!/^01\d{9}$/.test(r.phone.trim())) row.phone = t('holdings.phoneHint')
      if (Object.keys(row).length) problems[index] = row
    })
    if (Object.keys(problems).length) {
      setRowErrors(problems)
      setError(t('holdings.family.fixRows'))
      return
    }

    setBusy(true)
    setRowErrors({})
    try {
      const saved = isNew ? await api.create(payload) : await api.update(id, payload)
      // The location and the photo go up once the building exists. If only
      // one of them fails, the holding is saved and stays open here.
      if (isNew && gps.status === 'ok') {
        try {
          await api.verify(saved.id, { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, placedByHand: false })
        } catch (err) {
          setError(`${t('holdings.gps.saveFailed')} ${err?.fieldError?.('lat') || err?.detail || ''}`.trim())
          navigate(`/app/holdings/${saved.id}/edit`, { replace: true, state: { from: backTo } })
          return
        }
      }
      try {
        if (photoFile) await api.uploadPhoto(saved.id, photoFile)
        else if (photoRemoved) await api.removePhoto(saved.id)
      } catch (err) {
        setError(`${t('holdings.photo.failed')} ${err?.detail || ''}`.trim())
        if (isNew) navigate(`/app/holdings/${saved.id}/edit`, { replace: true, state: { from: backTo } })
        return
      }
      navigate(backTo, { state: { savedHolding: saved.id } })
    } catch (err) {
      // The server answers with one entry per family row, empty where the row
      // is fine, so a message lands on the family it belongs to.
      // The server numbers the rows it was sent; map them back to the table.
      const perRow = err?.fields?.households
      if (Array.isArray(perRow) && perRow.some((r) => r && Object.keys(r).length)) {
        const marked = Object.fromEntries(
          perRow.map((r, i) => [sent[i]?.index ?? i, r]).filter(([, r]) => r && Object.keys(r).length)
        )
        setRowErrors(marked)
        setError(t('holdings.family.fixRows'))
      } else {
        setError(err?.fieldError?.('ownerPhone') || err?.fieldError?.('unitsTotal')
          || err?.fieldError?.('holdingNo') || err?.fieldError?.('paymentDay')
          || err?.fieldError?.('charge') || (typeof perRow === 'string' ? perRow : perRow?.[0])
          || err?.detail || t('common.requestFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  const opt = (list) => (catalog?.[list] || []).map((o) => ({ value: o.id, label: t(o.key) }))
  // The monthly amount, worked out the way the server bills it: the collection
  // point decides — one place → the building charge, floor by floor → the
  // flats' charges, both → the two added together.
  const basis = singlePoint ? 'building'
    : { floor: 'flat', both: 'both' }[form.collectionPoint] || 'building'
  const flatCharges = basis === 'building' ? 0 : sent
    .filter(({ r }) => r.status !== 'inactive')
    .reduce((sum, { r }) => sum + (num(r.charge) || 0), 0)
  const buildingCharge = basis === 'flat' ? 0 : num(form.charge) || 0
  const monthlyTotal = buildingCharge + flatCharges
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
          <button type="button" className="btn" onClick={() => navigate(backTo)}>
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
        <div className="editor-stack">
          {/* ---------------------------------------------- the building --- */}
          <Section title={<><IconHome size={16} /> {t('holdings.editor.buildingPanel')}</>}>
            {/* Owner first: the person this building is registered to. Widths
                follow what each field holds — see FIELD_SIZES. */}
            <FormSection first>
              <FormRow>
                <Field size="sm" as="select" label={t('holdings.ownerRole')} value={form.ownerRole}
                  onChange={set('ownerRole')} disabled={busy}
                  options={['owner', 'president', 'secretary'].map((v) => ({ value: v, label: t(`holdings.ownerRole.${v}`) }))} />
                <Field size="lg" mark label={t('holdings.ownerName')} value={form.ownerName}
                  onChange={set('ownerName')} disabled={busy} hint={t('holdings.ownerRoleHint')}
                  autoFocus={isNew} />
                <Field size="sm" label={t('holdings.ownerPhone')} value={form.ownerPhone}
                  onChange={set('ownerPhone')} placeholder="01XXXXXXXXX" inputMode="numeric"
                  maxLength={11} disabled={busy} hint={t('holdings.phoneHint')} />
              </FormRow>
            </FormSection>

            <FormSection>
              {/* Ordered the way an address is read out: district, then the city
                  corporation or pourashova in it, then its ward and road. */}
              <FormRow>
                <SearchSelect size="md" label={t('holdings.district')} value={form.district}
                  onChange={(value) => setDistrict({ target: { value } })} disabled={busy}
                  placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
                  options={(catalog?.districts || []).map((d) => ({
                    value: d.name, label: geoLabel(d), keywords: [d.name, d.nameBn],
                  }))} />
                <SearchSelect size="md" label={t('holdings.city')} value={city}
                  onChange={(value) => setCity({ target: { value } })} disabled={busy}
                  placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
                  hint={form.district && cityChoices.length === 0 ? t('holdings.noCityInDistrict') : undefined}
                  options={cityChoices.map((c) => ({
                    value: c.id, label: localName(c), keywords: [c.id, c.name, c.nameBn],
                  }))} />
                {/* With no city chosen, every ward is listed, so each says whose it is. */}
                <SearchSelect size="md" mark label={t('holdings.col.ward')} value={form.ward}
                  onChange={(value) => { setForm((f) => ({ ...f, ward: value, road: '' })); setError('') }}
                  disabled={busy} placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
                  hint={city && wardChoices.length === 0 ? t('holdings.noWardInCity') : undefined}
                  options={wardOptions} />
              </FormRow>
              <FormRow>
                {/* Typed by hand; the ward's known roads are offered as you type,
                    and a new name is added to the ward on save. */}
                <Field size="lg" mark label={t('holdings.col.road')} value={form.road}
                  onChange={set('road')} disabled={busy || !form.ward} list="holding-road-names"
                  placeholder={t('holdings.roadPlaceholder')}
                  hint={form.ward ? t('holdings.roadHint') : t('holdings.editor.pickWardFirst')} />
                <datalist id="holding-road-names">
                  {roads.map((name) => <option key={name} value={name} />)}
                </datalist>
                <Field size="lg" label={t('holdings.lane')} value={form.lane}
                  onChange={set('lane')} placeholder={t('holdings.lanePlaceholder')} disabled={busy}
                  hint={t('holdings.laneHint')} />
                <Field size="sm" mark label={t('holdings.col.holdingNo')} value={form.holdingNo}
                  onChange={set('holdingNo')} placeholder="142/B" disabled={busy} />
              </FormRow>
              <FormRow>
                <Field size="md" as="select" label={t('holdings.buildingType')} value={form.holdingType}
                  onChange={set('holdingType')} disabled={busy}
                  options={[{ value: '', label: '—' },
                    // A building on a type no longer offered still shows it.
                    ...(form.holdingType && !(catalog?.holdingTypes || []).some((h) => h.id === form.holdingType)
                      ? [{ value: form.holdingType, label: t(`opt.holdingType.${form.holdingType}`) }] : []),
                    ...opt('holdingTypes')]} />
                {/* Floors and flats: a multi-storey building only. */}
                {multiStorey && (
                  <>
                    <Field size="xs" label={t('holdings.floors')} type="number" min="0"
                      value={form.floors} onChange={set('floors')} disabled={busy} />
                    <Field size="xs" label={t('holdings.unitsTotal')} type="number" min="0"
                      value={form.unitsTotal} onChange={set('unitsTotal')} disabled={busy}
                      hint={singlePoint ? undefined : t('holdings.unitsHint')} />
                  </>
                )}
                {/* Not asked for a kacha house: it is always a single collection point. */}
                {!kacha && (
                  <Field size="md" as="select" label={t('holdings.collectionPoint')} value={form.collectionPoint}
                    onChange={set('collectionPoint')} disabled={busy}
                    hint={t(`holdings.collectionPoint.${form.collectionPoint}Hint`)}
                    options={['single', 'floor', 'both'].map((v) => ({ value: v, label: t(`holdings.collectionPoint.${v}`) }))} />
                )}
              </FormRow>
              {kacha && <div className="tiny muted-3">{t('holdings.collectionPoint.kachaAuto')}</div>}
              {/* The device's location, saved with a new building. */}
              {isNew && (
                <div className={`form-note ${gps.status === 'ok' ? 'ok' : gps.status === 'failed' ? 'bad' : 'info'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span className="grow">
                    {gps.status === 'reading' && t('holdings.gps.reading')}
                    {gps.status === 'ok' && t('holdings.gps.ok', {
                      lat: gps.lat.toFixed(6), lng: gps.lng.toFixed(6),
                      accuracy: gps.accuracy == null ? '?' : gps.accuracy,
                    })}
                    {gps.status === 'failed' && t(`holdings.gps.${gps.reason}`)}
                  </span>
                  {gps.status !== 'reading' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={readGps} disabled={busy}>
                      {t('holdings.gps.again')}
                    </button>
                  )}
                </div>
              )}
              {/* Only shown to someone the server cannot infer it for. An agency
                  admin or a bound supervisor gets their own stamped on save, so
                  asking them would be asking a question with one answer — and
                  offering a choice they are not allowed to make. */}
              {!myAgency && (
                <FormRow>
                  <Field size="md" as="select" label={t('holdings.agency')} value={form.agency}
                    onChange={set('agency')} disabled={busy}
                    hint={t('holdings.agencyHint')}
                    options={[{ value: '', label: t('holdings.agencyNone') },
                      ...(agencies || []).map((a) => ({ value: a.id, label: localName(a) }))]} />
                </FormRow>
              )}
            </FormSection>

            <FormSection>
              <FormRow>
                {basis !== 'flat' && (
                  <Field size="sm" type="number" min="0" label={t('holdings.buildingCharge')}
                    value={form.charge} onChange={set('charge')} disabled={busy}
                    hint={t('holdings.chargeTypedHint')} />
                )}
                <Field size="sm" label={t('holdings.monthlyTotal')} value={taka(monthlyTotal)} readOnly disabled
                  hint={basis === 'both'
                    ? t('holdings.monthlyBreakdown', { building: taka(buildingCharge), flats: taka(flatCharges) })
                    : basis === 'flat' ? t('holdings.monthlyFromFlats') : undefined} />
                <Field size="md" as="select" label={t('households.field.paymentMode')}
                  value={form.paymentMode} onChange={set('paymentMode')} disabled={busy}
                  options={[{ value: '', label: '—' }, ...opt('paymentModes')]} />
                <Field size="sm" type="date" label={t('households.field.paymentDate')}
                  min={`${thisMonth()}-01`} max={`${thisMonth()}-28`}
                  value={dayToDate(form.paymentDay)}
                  onChange={(e) => { setForm((f) => ({ ...f, paymentDay: dateToDay(e.target.value) })); setError('') }}
                  hint={t('holdings.editor.paymentDayHint')} disabled={busy} />
                {!isNew && (
                  <Field size="sm" label={t('households.field.duesOutstanding')}
                    value={taka(service.dues || 0)} readOnly disabled />
                )}
              </FormRow>
            </FormSection>

            {/* No status picker. A building being registered is in service, and
                a record retired later is handled where that decision is made,
                not on the form used to enter it. */}
            {/* The building photo and the notes share a row. */}
            <FormSection>
              <FormRow>
                <div className="field" style={{ flex: '0 1 340px', minWidth: 260 }}>
                  <label>{t('holdings.photo.title')}</label>
                  <div className="row gap-16" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    {(photoPreview || (!photoRemoved && photoUrl)) ? (
                      <img src={photoPreview || photoUrl} alt={t('holdings.photo.title')}
                        style={{ width: 140, height: 105, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                    ) : (
                      <div className="muted-3 small" style={{ width: 140, height: 105, borderRadius: 10, border: '1px dashed var(--border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {t('holdings.photo.none')}
                      </div>
                    )}
                    <div className="col" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                        {photoPreview || photoUrl ? t('holdings.photo.change') : t('holdings.photo.add')}
                        {/* `capture` opens the camera on a phone; a computer gets a file picker. */}
                        <input type="file" accept="image/*" capture="environment" hidden
                          disabled={busy} onChange={choosePhoto} />
                      </label>
                      {(photoPreview || (!photoRemoved && photoUrl)) && (
                        <button type="button" className="link-btn small" onClick={clearPhoto} disabled={busy}>
                          {t('holdings.photo.remove')}
                        </button>
                      )}
                      <div className="tiny muted-3">{t('holdings.photo.hint')}</div>
                    </div>
                  </div>
                </div>
                <Field size="lg" as="textarea" label={t('holdings.notes')} value={form.notes}
                  onChange={set('notes')} disabled={busy} rows={5} />
              </FormRow>
              {/* The pin is deliberately absent. A building has one position and
                  confirming it is a separate, stamped action taken standing at
                  the door — not a coordinate typed at a desk. */}
              <div className="tiny muted-3">{t('holdings.editor.locationNote')}</div>
            </FormSection>
          </Section>

          {/* ---------------------------------------------- the customers --- */}
          {singlePoint ? (
            <Section title={t('holdings.editor.familiesPanel')}>
              <div className="app-banner info">{t('holdings.collectionPoint.noFlats')}</div>
              {families.some((r) => r.id) && (
                <div className="tiny muted-3 mt-8">
                  {t('holdings.collectionPoint.keptCustomers', { count: families.filter((r) => r.id).length })}
                </div>
              )}
            </Section>
          ) : (
            <Section
              title={<>{t('holdings.editor.familiesPanel')}{' '}
                <span className="tiny muted">
                  {t('holdings.editor.familyCount', { count: families.filter((r) => r.id).length, active: activeCount })}
                </span></>}
              actions={canWrite && (
                <button type="button" className="btn btn-ghost" onClick={addFamily} disabled={busy}>
                  <IconPlus size={14} /> {t('holdings.family.add')}
                </button>
              )}
              pad={false}
            >
              {/* Households must equal units: a reminder while they do not. */}
              {multiStorey && form.unitsTotal !== '' && Number(form.unitsTotal) !== sent.length && (
                <div className={`app-banner ${sent.length > Number(form.unitsTotal) ? 'error' : 'info'}`} style={{ margin: 12 }}>
                  {t(sent.length > Number(form.unitsTotal) ? 'holdings.units.tooMany' : 'holdings.units.tooFew',
                    { active: sent.length, units: Number(form.unitsTotal) })}
                </div>
              )}
              {families.length === 0 ? (
                <EmptyState>{t('holdings.flatTable.empty')}</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="data flat-table">
                    <thead>
                      <tr>
                        <th style={{ width: 44 }}>#</th>
                        <th>{t('holdings.flatTable.name')}<span className="req-mark"> *</span></th>
                        <th>{t('holdings.flatTable.phone')}<span className="req-mark"> *</span></th>
                        <th>{t('holdings.flatTable.unit')}</th>
                        <th>{t('holdings.flatTable.members')}</th>
                        {basis !== 'building' && <th>{t('holdings.flatTable.charge')}</th>}
                        <th>{t('holdings.flatTable.occupancy')}</th>
                        <th style={{ width: 44 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {families.map((row, index) => {
                        const bad = rowErrors[index] || {}
                        const message = Object.values(bad).flat().join(' ')
                        return (
                          <tr key={row._key} className={message ? 'row-bad' : undefined}>
                            <td className="muted-3">
                              {index + 1}
                              {row.status === 'inactive' && (
                                <div className="tiny"><span className="badge badge-muted">{t('status.inactive')}</span></div>
                              )}
                            </td>
                            <td>
                              <input className="input" value={row.head} disabled={busy}
                                aria-label={t('holdings.flatTable.name')}
                                onChange={(e) => setFamily(index, 'head', e.target.value)} />
                            </td>
                            <td>
                              <input className="input" value={row.phone} placeholder="01XXXXXXXXX"
                                inputMode="numeric" maxLength={11} disabled={busy}
                                aria-label={t('holdings.flatTable.phone')}
                                onChange={(e) => setFamily(index, 'phone', e.target.value)} />
                            </td>
                            <td>
                              <input className="input" value={row.unit} placeholder={t('holdings.flatTable.unitPh')}
                                disabled={busy} aria-label={t('holdings.flatTable.unit')}
                                onChange={(e) => setFamily(index, 'unit', e.target.value)} />
                            </td>
                            <td>
                              <input className="input" type="number" min="0" value={row.members}
                                disabled={busy} aria-label={t('holdings.flatTable.members')}
                                onChange={(e) => setFamily(index, 'members', e.target.value)} />
                            </td>
                            {basis !== 'building' && (
                              <td>
                                <input className="input" type="number" min="0" value={row.charge}
                                  placeholder="0" disabled={busy} aria-label={t('holdings.flatTable.charge')}
                                  onChange={(e) => setFamily(index, 'charge', e.target.value)} />
                              </td>
                            )}
                            <td>
                              <select className="select" value={row.occupancy} disabled={busy}
                                aria-label={t('holdings.flatTable.occupancy')}
                                onChange={(e) => setFamily(index, 'occupancy', e.target.value)}>
                                <option value="">—</option>
                                <option value="own">{t('holdings.occupancy.own')}</option>
                                <option value="rented">{t('holdings.occupancy.rented')}</option>
                              </select>
                              {message && <div className="tiny" style={{ color: 'var(--danger)' }}>{message}</div>}
                            </td>
                            <td>
                              {/* Only an unsaved row can be removed — a saved one is
                                  retired by setting it inactive. */}
                              {!row.id && (
                                <button type="button" className="icon-btn" onClick={() => dropFamily(index)}
                                  disabled={busy} title={t('holdings.family.remove')}
                                  aria-label={t('holdings.family.remove')}>
                                  <IconTrash size={14} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="tiny muted-3" style={{ padding: '8px 12px' }}>{t('holdings.flatTable.hint')}</div>
            </Section>
          )}
        </div>
      </form>
    </div>
  )
}
