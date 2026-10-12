// Setup — cities, their zones and wards, and the type lists behind the City
// and Agency forms.
//
// These used to be choices fixed in code. They are rows now, so a corporation
// can add a city, a kind of city (City Corporation, Pourashova…) or a kind of
// agency (private company, in-house service…) without a release. Each city
// also carries its own collection-day times: the cut-off after which
// uncomplained households count as collected, and the next-day deadline for
// late complaints. Zones and wards are where a new city's geography is drawn:
// a ward belongs to a zone, and a zone to a city.
//
// Only a super admin reaches this page; the server refuses every write from
// anyone else. After a save the shared catalog is re-read, so the dropdowns on
// every other page pick the change up straight away.

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, EmptyState } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { IconPlus, IconRefresh } from '../components/Icons.jsx'
import { setup } from '../api/endpoints.js'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'

const TABS = ['cities', 'zones', 'wards', 'dumpingPoints', 'cityTypes', 'agencyTypes']
// Tabs whose rows belong to one city, and the list filter that narrows them.
const BY_CITY = { zones: 'city', wards: 'zone__city', dumpingPoints: 'city' }
const hhmm = (value) => String(value || '').slice(0, 5)

export default function Setup() {
  const { t, localName } = useLang()
  const { reloadCatalog } = useData()
  const [tab, setTab] = useState('cities')
  const [rows, setRows] = useState([])
  const [cityTypes, setCityTypes] = useState([])
  const [cities, setCities] = useState([])
  const [zones, setZones] = useState([])
  const [wards, setWards] = useState([])
  const [cityFilter, setCityFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // a row, or {} for new
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = BY_CITY[tab] && cityFilter ? { [BY_CITY[tab]]: cityFilter } : undefined
      // The reference lists are small, and every form here picks from one of them.
      const [data, types, cityRows, zoneRows, wardRows] = await Promise.all([
        setup[tab].list(params), setup.cityTypes.list(), setup.cities.list(), setup.zones.list(),
        // A dumping point is given the wards it serves.
        tab === 'dumpingPoints' ? setup.wards.list() : Promise.resolve([]),
      ])
      setRows(data)
      setCityTypes(types)
      setCities(cityRows)
      setZones(zoneRows)
      setWards(wardRows)
    } catch (err) {
      setError(err?.detail || t('common.loadFailedUnknown'))
    } finally {
      setLoading(false)
    }
  }, [tab, cityFilter, t])

  useEffect(() => { load() }, [load])

  async function saved(row, created) {
    setEditing(null)
    setNote(t(created ? 'setup.created' : 'setup.updated', { name: row.name || row.label }))
    await Promise.all([load(), reloadCatalog().catch(() => {})])
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('setup.title')}
        subtitle={t('setup.subtitle')}
        actions={(
          <button className="btn btn-primary" onClick={() => { setNote(''); setEditing({}) }}>
            <IconPlus size={16} /> {t(`setup.add.${tab}`)}
          </button>
        )}
      />

      <div className="filter-bar">
        <div className="seg">
          {TABS.map((id) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setNote('') }}>
              {t(`setup.tab.${id}`)}
            </button>
          ))}
        </div>
        {BY_CITY[tab] && (
          <select className="select" style={{ width: 'auto' }} value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)} aria-label={t('setup.filterCity')}>
            <option value="">{t('setup.allCities')}</option>
            {cities.map((c) => <option key={c.id} value={c.id}>{localName(c)}</option>)}
          </select>
        )}
      </div>

      {note && <div className="card card-pad small mb-16" style={{ color: 'var(--ok)' }}>{note}</div>}

      <div className="card">
        {loading ? (
          <div className="center row gap-8" style={{ padding: '40px 16px', justifyContent: 'center' }}>
            <span className="spinner spinner-dark" /> <span className="muted">{t('common.loading')}</span>
          </div>
        ) : error ? (
          <div className="center" style={{ padding: '32px 16px' }}>
            <div style={{ color: 'var(--danger)', fontWeight: 700 }}>{error}</div>
            <button className="btn btn-ghost btn-sm mt-16" onClick={load}><IconRefresh size={15} /> {t('common.retry')}</button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState>{t('setup.empty')}</EmptyState>
        ) : tab === 'cities' ? (
          <CityTable rows={rows} cityTypes={cityTypes} onEdit={setEditing} />
        ) : tab === 'zones' ? (
          <ZoneTable rows={rows} cities={cities} onEdit={setEditing} />
        ) : tab === 'wards' ? (
          <WardTable rows={rows} cities={cities} zones={zones} onEdit={setEditing} />
        ) : tab === 'dumpingPoints' ? (
          <DumpingTable rows={rows} cities={cities} onEdit={setEditing} />
        ) : (
          <TypeTable rows={rows} onEdit={setEditing} />
        )}
      </div>

      {editing && tab === 'cities' && (
        <CityForm city={editing} cityTypes={cityTypes} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing && tab === 'zones' && (
        <ZoneForm zone={editing} cities={cities} defaultCity={cityFilter}
          onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing && tab === 'wards' && (
        <WardForm ward={editing} cities={cities} zones={zones} defaultCity={cityFilter}
          onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing && tab === 'dumpingPoints' && (
        <DumpingForm point={editing} cities={cities} wards={wards} zones={zones} defaultCity={cityFilter}
          onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing && (tab === 'cityTypes' || tab === 'agencyTypes') && (
        <TypeForm kind={tab} row={editing} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </div>
  )
}

function ActiveBadge({ active }) {
  const { t } = useLang()
  return active
    ? <span className="badge badge-ok">{t('setup.active')}</span>
    : <span className="badge badge-muted">{t('setup.inactive')}</span>
}

function CityTable({ rows, cityTypes, onEdit }) {
  const { t, digits, optLabel } = useLang()
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('setup.col.code')}</th>
            <th>{t('setup.col.name')}</th>
            <th>{t('setup.col.type')}</th>
            <th>{t('setup.col.district')}</th>
            <th>{t('setup.col.cutoff')}</th>
            <th>{t('setup.col.deadline')}</th>
            <th>{t('setup.col.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td className="mono">{c.id}</td>
              <td style={{ fontWeight: 600 }}>
                {c.name}
                {c.nameBn && <div className="tiny muted-3">{c.nameBn}</div>}
              </td>
              <td className="small">{c.cityType ? optLabel(cityTypes, c.cityType) : '—'}</td>
              <td className="small">{c.district || '—'}</td>
              <td className="mono">{digits(hhmm(c.collectionCutoff))}</td>
              <td className="mono">{digits(hhmm(c.complaintDeadline))}</td>
              <td><ActiveBadge active={c.active} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(c)}>{t('common.edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TypeTable({ rows, onEdit }) {
  const { t } = useLang()
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('setup.col.code')}</th>
            <th>{t('setup.col.label')}</th>
            <th>{t('setup.col.shown')}</th>
            <th>{t('setup.col.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.id}</td>
              <td style={{ fontWeight: 600 }}>{row.label}</td>
              <td className="small">{t(row.key) === row.key ? row.label : t(row.key)}</td>
              <td><ActiveBadge active={row.active !== false} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(row)}>{t('common.edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The server's message for the first field it refused, else its general one.
function firstError(err, fields, fallback) {
  for (const name of fields) {
    const message = err?.fieldError?.(name)
    if (message) return message
  }
  return err?.detail || fallback
}

function CityForm({ city, cityTypes, onClose, onSaved }) {
  const { t, optLabel } = useLang()
  const isNew = !city.id
  const [form, setForm] = useState({
    id: city.id || '',
    name: city.name || '',
    nameBn: city.nameBn || '',
    cityType: city.cityType || cityTypes[0]?.id || '',
    district: city.district || '',
    collectionCutoff: hhmm(city.collectionCutoff) || '21:00',
    complaintDeadline: hhmm(city.complaintDeadline) || '12:00',
    active: city.active !== false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }

  async function submit(e) {
    e.preventDefault()
    if (!form.id.trim() || !form.name.trim()) { setError(t('setup.required')); return }
    setBusy(true)
    try {
      const body = { ...form, id: form.id.trim().toUpperCase(), cityType: form.cityType || null }
      const row = isNew ? await setup.cities.create(body) : await setup.cities.update(city.id, body)
      onSaved(row, isNew)
    } catch (err) {
      setError(firstError(err, ['id', 'name', 'cityType', 'collectionCutoff', 'complaintDeadline'], t('common.requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? t('setup.cityNew') : t('setup.cityEdit')} subtitle={isNew ? t('setup.cityHint') : city.id}
      onClose={onClose} width={600}>
      <form onSubmit={submit}>
        <FormRow>
          <Field narrow label={t('setup.col.code')} value={form.id} onChange={set('id')} disabled={busy || !isNew}
            placeholder="KCC" maxLength={8} autoFocus={isNew} />
          <Field half label={t('setup.col.name')} value={form.name} onChange={set('name')} disabled={busy} />
        </FormRow>
        <FormRow>
          <Field half label={t('setup.col.nameBn')} value={form.nameBn} onChange={set('nameBn')} disabled={busy} />
          <Field half as="select" label={t('setup.col.type')} value={form.cityType} onChange={set('cityType')} disabled={busy}
            hint={t('setup.typeHint')}
            options={[{ value: '', label: '—' }, ...cityTypes.filter((ct) => ct.active !== false || ct.id === form.cityType)
              .map((ct) => ({ value: ct.id, label: optLabel(cityTypes, ct.id) }))]} />
        </FormRow>
        <FormRow>
          <Field half label={t('setup.col.district')} value={form.district} onChange={set('district')} disabled={busy} />
          <Field half as="select" label={t('setup.col.status')} value={form.active ? 'yes' : 'no'}
            onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'yes' }))} disabled={busy}
            options={[{ value: 'yes', label: t('setup.active') }, { value: 'no', label: t('setup.inactive') }]} />
        </FormRow>
        <FormRow>
          <Field half type="time" label={t('setup.col.cutoff')} value={form.collectionCutoff} onChange={set('collectionCutoff')}
            disabled={busy} hint={t('setup.cutoffHint')} />
          <Field half type="time" label={t('setup.col.deadline')} value={form.complaintDeadline} onChange={set('complaintDeadline')}
            disabled={busy} hint={t('setup.deadlineHint')} />
        </FormRow>
        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function TypeForm({ kind, row, onClose, onSaved }) {
  const { t } = useLang()
  const isNew = !row.id
  const prefix = kind === 'cityTypes' ? 'opt.cityType' : 'opt.agencyType'
  const [form, setForm] = useState({ id: row.id || '', label: row.label || '', active: row.active !== false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    // The code is the stored value: lower-case, no spaces, so it stays a safe key.
    const id = form.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!id || !form.label.trim()) { setError(t('setup.required')); return }
    setBusy(true)
    try {
      const body = { label: form.label.trim(), active: form.active }
      const saved = isNew
        ? await setup[kind].create({ ...body, id, key: `${prefix}.${id}` })
        : await setup[kind].update(row.id, body)
      onSaved(saved, isNew)
    } catch (err) {
      setError(firstError(err, ['id', 'label'], t('common.requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t(isNew ? `setup.add.${kind}` : 'setup.typeEdit')} subtitle={isNew ? t('setup.typeNewHint') : row.id}
      onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <Field label={t('setup.col.code')} value={form.id} disabled={busy || !isNew} autoFocus={isNew}
          onChange={(e) => { setForm((f) => ({ ...f, id: e.target.value })); setError('') }}
          placeholder="union_parishad" hint={isNew ? t('setup.codeHint') : undefined} />
        <Field label={t('setup.col.label')} value={form.label} disabled={busy}
          onChange={(e) => { setForm((f) => ({ ...f, label: e.target.value })); setError('') }} />
        <Field as="select" label={t('setup.col.status')} value={form.active ? 'yes' : 'no'} disabled={busy}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'yes' }))}
          hint={t('setup.inactiveHint')}
          options={[{ value: 'yes', label: t('setup.active') }, { value: 'no', label: t('setup.inactive') }]} />
        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// A city's name in the active language, from its id.
const useCityName = (cities) => {
  const { localName } = useLang()
  return (id) => {
    const city = cities.find((c) => c.id === id)
    return city ? localName(city) : id || '—'
  }
}

// Codes are primary keys shared by every city, so "W-14" can exist only once.
const cleanCode = (value) => value.trim().toUpperCase().replace(/\s+/g, '-')

function ZoneTable({ rows, cities, onEdit }) {
  const { t } = useLang()
  const cityName = useCityName(cities)
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('setup.col.code')}</th>
            <th>{t('setup.col.name')}</th>
            <th>{t('setup.col.city')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((z) => (
            <tr key={z.id}>
              <td className="mono">{z.id}</td>
              <td style={{ fontWeight: 600 }}>
                {z.name}
                {z.nameBn && <div className="tiny muted-3">{z.nameBn}</div>}
              </td>
              <td className="small">{cityName(z.city)}</td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(z)}>{t('common.edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WardTable({ rows, cities, zones, onEdit }) {
  const { t, digits, lang } = useLang()
  const cityName = useCityName(cities)
  const zoneName = (id) => {
    const zone = zones.find((z) => z.id === id)
    return zone ? (lang === 'bn' && zone.nameBn) || zone.name : id
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('setup.col.code')}</th>
            <th>{t('setup.col.name')}</th>
            <th>{t('setup.col.zone')}</th>
            <th>{t('setup.col.city')}</th>
            <th>{t('setup.col.centre')}</th>
            <th>{t('setup.col.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td className="mono">{w.id}</td>
              <td style={{ fontWeight: 600 }}>
                {w.name}
                {w.nameBn && <div className="tiny muted-3">{w.nameBn}</div>}
              </td>
              <td className="small">{zoneName(w.zone)}</td>
              <td className="small">{cityName(w.city)}</td>
              <td className="mono tiny">{w.lat != null && w.lng != null ? digits(`${w.lat}, ${w.lng}`) : '—'}</td>
              <td><ActiveBadge active={w.active !== false} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(w)}>{t('common.edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ZoneForm({ zone, cities, defaultCity, onClose, onSaved }) {
  const { t, localName } = useLang()
  const isNew = !zone.id
  const [form, setForm] = useState({
    id: zone.id || '', name: zone.name || '', nameBn: zone.nameBn || '',
    city: zone.city || defaultCity || cities[0]?.id || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }

  async function submit(e) {
    e.preventDefault()
    const id = cleanCode(form.id)
    if (!id || !form.name.trim() || !form.city) { setError(t('setup.requiredCity')); return }
    setBusy(true)
    try {
      const body = { name: form.name.trim(), nameBn: form.nameBn.trim(), city: form.city }
      const row = isNew
        ? await setup.zones.create({ ...body, id, key: `opt.zone.${id}` })
        : await setup.zones.update(zone.id, body)
      onSaved(row, isNew)
    } catch (err) {
      setError(firstError(err, ['id', 'name', 'nameBn', 'city'], t('common.requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? t('setup.add.zones') : t('setup.zoneEdit')} subtitle={isNew ? t('setup.zoneHint') : zone.id}
      onClose={onClose} width={520}>
      <form onSubmit={submit}>
        <FormRow>
          <Field narrow label={t('setup.col.code')} value={form.id} onChange={set('id')} disabled={busy || !isNew}
            placeholder="SCC-Z1" maxLength={8} autoFocus={isNew} />
          <Field half label={t('setup.col.name')} value={form.name} onChange={set('name')} disabled={busy}
            placeholder={t('setup.zoneNamePlaceholder')} />
        </FormRow>
        <Field label={t('setup.col.nameBn')} value={form.nameBn} onChange={set('nameBn')} disabled={busy}
          placeholder={t('setup.zoneNameBnPlaceholder')} hint={t('setup.nameBnHint')} />
        <Field as="select" label={t('setup.col.city')} value={form.city} onChange={set('city')} disabled={busy}
          options={[{ value: '', label: '—' }, ...cities.map((c) => ({ value: c.id, label: localName(c) }))]} />
        {isNew && <div className="tiny muted-3">{t('setup.codeUniqueHint')}</div>}
        {error && <div className="small mt-8" style={{ color: 'var(--danger)' }}>{error}</div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function WardForm({ ward, cities, zones, defaultCity, onClose, onSaved }) {
  const { t, localName, lang } = useLang()
  const isNew = !ward.id
  const startZone = ward.zone || ''
  const startCity = ward.city || zones.find((z) => z.id === startZone)?.city || defaultCity || cities[0]?.id || ''
  const [form, setForm] = useState({
    id: ward.id || '', name: ward.name || '', nameBn: ward.nameBn || '', city: startCity, zone: startZone,
    lat: ward.lat ?? '', lng: ward.lng ?? '', active: ward.active !== false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }
  // The zone list narrows to the chosen city; picking another city clears the zone.
  const cityZones = zones.filter((z) => !form.city || z.city === form.city)
  const setCity = (e) => { setForm((f) => ({ ...f, city: e.target.value, zone: '' })); setError('') }

  async function submit(e) {
    e.preventDefault()
    const id = cleanCode(form.id)
    if (!id || !form.name.trim() || !form.zone) { setError(t('setup.requiredZone')); return }
    const blank = (v) => v === '' || v == null
    if ([form.lat, form.lng].some((v) => !blank(v) && Number.isNaN(Number(v)))) {
      setError(t('setup.badCoord'))
      return
    }
    setBusy(true)
    try {
      const body = {
        name: form.name.trim(),
        nameBn: form.nameBn.trim(),
        zone: form.zone,
        lat: blank(form.lat) ? null : Number(form.lat),
        lng: blank(form.lng) ? null : Number(form.lng),
        active: form.active,
      }
      const row = isNew
        ? await setup.wards.create({ ...body, id, key: `opt.ward.${id}` })
        : await setup.wards.update(ward.id, body)
      onSaved(row, isNew)
    } catch (err) {
      setError(firstError(err, ['id', 'name', 'nameBn', 'zone', 'lat', 'lng'], t('common.requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? t('setup.add.wards') : t('setup.wardEdit')} subtitle={isNew ? t('setup.wardHint') : ward.id}
      onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <FormRow>
          <Field narrow label={t('setup.col.code')} value={form.id} onChange={set('id')} disabled={busy || !isNew}
            placeholder="SCC-W22" maxLength={8} autoFocus={isNew} />
          <Field half label={t('setup.col.name')} value={form.name} onChange={set('name')} disabled={busy}
            placeholder={t('setup.wardNamePlaceholder')} />
        </FormRow>
        <Field label={t('setup.col.nameBn')} value={form.nameBn} onChange={set('nameBn')} disabled={busy}
          placeholder={t('setup.wardNameBnPlaceholder')} hint={t('setup.nameBnHint')} />
        <FormRow>
          <Field half as="select" label={t('setup.col.city')} value={form.city} onChange={setCity} disabled={busy}
            options={[{ value: '', label: '—' }, ...cities.map((c) => ({ value: c.id, label: localName(c) }))]} />
          <Field half as="select" label={t('setup.col.zone')} value={form.zone} onChange={set('zone')} disabled={busy}
            options={[{ value: '', label: '—' }, ...cityZones.map((z) => ({ value: z.id, label: `${(lang === 'bn' && z.nameBn) || z.name} (${z.id})` }))]} />
        </FormRow>
        <FormRow>
          <Field half label={t('setup.col.lat')} value={form.lat} onChange={set('lat')} disabled={busy}
            inputMode="decimal" placeholder="24.8949" hint={t('setup.centreHint')} />
          <Field half label={t('setup.col.lng')} value={form.lng} onChange={set('lng')} disabled={busy}
            inputMode="decimal" placeholder="91.8687" />
        </FormRow>
        <Field as="select" label={t('setup.col.status')} value={form.active ? 'yes' : 'no'} disabled={busy}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'yes' }))}
          hint={t('setup.inactiveHint')}
          options={[{ value: 'yes', label: t('setup.active') }, { value: 'no', label: t('setup.inactive') }]} />
        {isNew && <div className="tiny muted-3">{t('setup.codeUniqueHint')}</div>}
        {error && <div className="small mt-8" style={{ color: 'var(--danger)' }}>{error}</div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

const DUMP_KINDS = ['dumping_area', 'disposal_site', 'transfer_station']

function DumpingTable({ rows, cities, onEdit }) {
  const { t, n, localName } = useLang()
  const cityName = useCityName(cities)
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>{t('setup.col.name')}</th>
            <th>{t('setup.col.kind')}</th>
            <th>{t('setup.col.city')}</th>
            <th>{t('setup.col.servesWards')}</th>
            <th>{t('setup.col.capacity')}</th>
            <th>{t('setup.col.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>
                {localName(p)}
                {p.nameBn && <div className="tiny muted-3">{p.name}</div>}
              </td>
              <td className="small">{t(`setup.kind.${p.kind}`)}</td>
              <td className="small">{cityName(p.city)}</td>
              <td className="small mono">{(p.wards || []).join(', ') || '—'}</td>
              <td className="small">{p.capacityTonnes != null ? t('setup.tonnesPerDay', { n: n(p.capacityTonnes) }) : '—'}</td>
              <td><ActiveBadge active={p.active !== false} /></td>
              <td><button className="btn btn-ghost btn-sm" onClick={() => onEdit(p)}>{t('common.edit')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DumpingForm({ point, cities, wards, zones, defaultCity, onClose, onSaved }) {
  const { t, localName, wardName } = useLang()
  const isNew = !point.id
  const [form, setForm] = useState({
    name: point.name || '', nameBn: point.nameBn || '', kind: point.kind || 'dumping_area',
    city: point.city || defaultCity || cities[0]?.id || '', wards: point.wards || [],
    lat: point.lat ?? '', lng: point.lng ?? '', capacityTonnes: point.capacityTonnes ?? '',
    notes: point.notes || '', active: point.active !== false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }
  // It serves wards of its own city only.
  const cityOfZone = new Map(zones.map((z) => [z.id, z.city]))
  const cityWards = wards.filter((w) => cityOfZone.get(w.zone) === form.city)
  const toggleWard = (id) => setForm((f) => ({
    ...f, wards: f.wards.includes(id) ? f.wards.filter((w) => w !== id) : [...f.wards, id],
  }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.city) { setError(t('setup.requiredCity')); return }
    const blank = (v) => v === '' || v == null
    if ([form.lat, form.lng, form.capacityTonnes].some((v) => !blank(v) && Number.isNaN(Number(v)))) {
      setError(t('setup.badCoord'))
      return
    }
    setBusy(true)
    try {
      const body = {
        name: form.name.trim(), nameBn: form.nameBn.trim(), kind: form.kind, city: form.city,
        wards: form.wards.filter((id) => cityWards.some((w) => w.id === id)),
        lat: blank(form.lat) ? null : Number(form.lat),
        lng: blank(form.lng) ? null : Number(form.lng),
        capacityTonnes: blank(form.capacityTonnes) ? null : Number(form.capacityTonnes),
        notes: form.notes, active: form.active,
      }
      const row = isNew ? await setup.dumpingPoints.create(body) : await setup.dumpingPoints.update(point.id, body)
      onSaved(row, isNew)
    } catch (err) {
      setError(firstError(err, ['name', 'city', 'wards', 'lat', 'lng', 'capacityTonnes'], t('common.requestFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? t('setup.add.dumpingPoints') : t('setup.dumpingEdit')} subtitle={t('setup.dumpingHint')}
      onClose={onClose} width={600}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half label={t('setup.col.name')} value={form.name} onChange={set('name')} disabled={busy} autoFocus={isNew} />
          <Field half label={t('setup.col.nameBn')} value={form.nameBn} onChange={set('nameBn')} disabled={busy} />
        </FormRow>
        <FormRow>
          <Field half as="select" label={t('setup.col.kind')} value={form.kind} onChange={set('kind')} disabled={busy}
            options={DUMP_KINDS.map((k) => ({ value: k, label: t(`setup.kind.${k}`) }))} />
          <Field half as="select" label={t('setup.col.city')} value={form.city} disabled={busy}
            onChange={(e) => { setForm((f) => ({ ...f, city: e.target.value, wards: [] })); setError('') }}
            options={[{ value: '', label: '—' }, ...cities.map((c) => ({ value: c.id, label: localName(c) }))]} />
        </FormRow>
        <div className="field">
          <label>{t('setup.col.servesWards')}</label>
          <div className="check-grid">
            {cityWards.map((w) => (
              <label key={w.id} className="check">
                <input type="checkbox" disabled={busy} checked={form.wards.includes(w.id)} onChange={() => toggleWard(w.id)} />
                <span>{wardName(w.id)}</span>
              </label>
            ))}
            {cityWards.length === 0 && <span className="tiny muted">{t('setup.noWardsInCity')}</span>}
          </div>
        </div>
        <FormRow>
          <Field third label={t('setup.col.lat')} value={form.lat} onChange={set('lat')} disabled={busy} inputMode="decimal" />
          <Field third label={t('setup.col.lng')} value={form.lng} onChange={set('lng')} disabled={busy} inputMode="decimal" />
          <Field third label={t('setup.col.capacity')} value={form.capacityTonnes} onChange={set('capacityTonnes')}
            disabled={busy} inputMode="decimal" hint={t('setup.capacityHint')} />
        </FormRow>
        <Field as="select" label={t('setup.col.status')} value={form.active ? 'yes' : 'no'} disabled={busy}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'yes' }))}
          options={[{ value: 'yes', label: t('setup.active') }, { value: 'no', label: t('setup.inactive') }]} />
        {error && <div className="small mt-8" style={{ color: 'var(--danger)' }}>{error}</div>}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
