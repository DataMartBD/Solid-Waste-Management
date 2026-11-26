import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import DataTable from '../components/DataTable.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { sortWards } from './Holdings.jsx'
import { SearchSelect } from '../components/SearchSelect.jsx'
import { users as api } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { IconUsers, IconPlus, IconCheck, IconAlert } from '../components/Icons.jsx'
import { pickableAgencies } from '../utils/agencies.js'

// Operator accounts.
//
// Until this page existed the only way to give somebody a login was the Django
// admin or a shell, which meant the people who run the service could not add the
// people who do the work. Administrators only, on both sides: the server
// restricts reading as well as writing, because the list is every operator's
// phone number, national ID and next of kin.
//
// An agency admin sees and creates only their own contractor's accounts — the
// server narrows the list, so this page shows whatever it is given rather than
// keeping a second copy of the rule. A super admin sees everybody.
//
// Two things it deliberately does not do:
//
//   * **Delete.** Visits, payments, complaints and surveys all point at the user
//     who recorded them, so removing an account would strip the name off work
//     that was done. Deactivating stops the sign-in and keeps the history.
//   * **Let you edit your own authority.** Role, scope and the active flag are
//     locked on your own row — the account making the change is the one that
//     would have to undo it.

const ROLE_TONES = {
  super_admin: 'danger',
  agency_admin: 'brand',
  supervisor: 'ok',
  collector: 'info',
  bill_collector: 'warn',
  kcc_viewer: 'muted',
}

const ROLES = ['collector', 'bill_collector', 'supervisor', 'agency_admin', 'super_admin', 'kcc_viewer']
// All an agency admin may add or manage; the server holds them to it too.
const AGENCY_ADMIN_MANAGES = ['collector', 'bill_collector', 'supervisor']
// A supervisor: waste and bill collectors of their own area only.
const SUPERVISOR_MANAGES = ['collector', 'bill_collector']
const SCOPES = ['ward', 'zone', 'agency', 'city']


function blankUser(agencies) {
  return {
    phone: '', name: '', role: 'collector',
    scopeKind: 'ward', scopeZone: '', scopeWards: [], city: '',
    agency: pickableAgencies(agencies).length === 1 ? pickableAgencies(agencies)[0].id : '',
    email: '', altPhone: '', nid: '', bloodGroup: '', emergencyContact: '',
    password: '',
  }
}

export default function Users() {
  const searchParam = useSearchParams()[0].get('q') || ''
  const { t, date, lang, localName } = useLang()
  const { user: me } = useAuth()
  // An agency admin manages only collectors and supervisors.
  const meAgencyAdmin = me?.roleKey === 'agency_admin'
  const meSupervisor = me?.roleKey === 'supervisor'
  const manages = meAgencyAdmin ? AGENCY_ADMIN_MANAGES : meSupervisor ? SUPERVISOR_MANAGES : null
  const canManage = (row) => !manages || manages.includes(row.role)
  const { catalog, agencies } = useData()
  // The wards a supervisor's collectors may be given: the supervisor's own.
  // Null when not narrowed by ward (then the agency's cities apply, if any).
  const areaWards = useMemo(() => {
    if (!meSupervisor) return null
    if (me.scopeKind === 'ward') return new Set(me.scopeWards || [])
    if (me.scopeKind === 'zone') return new Set(me.zoneWards || [])
    if (me.scopeKind === 'city' && me.city) {
      return new Set((catalog?.wards || []).filter((w) => w.city === me.city).map((w) => w.id))
    }
    return null
  }, [meSupervisor, me, catalog])

  // A user's City Corporation / Pourashova, from their access: the city of
  // their wards, of their zone, the one they are saved with, or their agency's
  // main city. The district is that city's. Neither exists for every-city access.
  const geo = useMemo(() => {
    const cities = new Map((catalog?.cities || []).map((c) => [c.id, c]))
    const zones = new Map((catalog?.zones || []).map((z) => [z.id, z]))
    const wards = new Map((catalog?.wards || []).map((w) => [w.id, w]))
    const districts = new Map((catalog?.districts || []).map((d) => [d.name, d]))
    const agencyById = new Map((agencies || []).map((a) => [a.id, a]))
    const cityIdOf = (r) => {
      if (r.scopeKind === 'ward') {
        const w = wards.get((r.scopeWards || [])[0])
        return w?.city || zones.get(w?.zone)?.city
      }
      if (r.scopeKind === 'zone') return zones.get(r.scopeZone)?.city
      if (r.scopeKind === 'city') return r.city
      return agencyById.get(r.agency)?.city
    }
    const nameOf = (row) => (row ? (lang === 'bn' && row.nameBn) || row.name : '')
    return (r) => {
      const city = cities.get(cityIdOf(r))
      const district = city?.district ? (districts.get(city.district) || { name: city.district }) : null
      return { city: city ? localName(city) : '', district: nameOf(district) }
    }
  }, [catalog, agencies, lang, localName])

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState(null)   // a row, or a blank for "new"
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.list({ role: role || undefined, page_size: 'all' })
      setRows(Array.isArray(data) ? data : data.results || [])
      setError('')
    } catch (err) {
      setError(err?.detail || t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [role, t])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter((r) => r.isActive).length,
    admins: rows.filter((r) => r.role === 'agency_admin' || r.role === 'super_admin').length,
    never: rows.filter((r) => !r.lastLogin).length,
  }), [rows])

  async function setActive(row, active) {
    try {
      await (active ? api.activate(row.id) : api.deactivate(row.id))
      setNote(t(active ? 'users.activated' : 'users.deactivated', { name: row.name }))
      load()
    } catch (err) {
      setError(err?.detail || t('common.requestFailed'))
    }
  }

  const columns = useMemo(() => [
    {
      id: 'name',
      // Name, mobile numbers, email and NID joined, so the search box finds a
      // user by any of them (as its placeholder says); sorting still goes by name, which comes first.
      accessorFn: (r) => [r.name, r.phone, r.altPhone, r.email, r.nid].filter(Boolean).join(' '),
      header: t('users.col.name'),
      cell: ({ row }) => (
        <>
          <div style={{ fontWeight: 600 }}>
            {row.original.name}
            {row.original.id === me?.id && (
              <span className="tiny muted-3"> · {t('users.you')}</span>
            )}
          </div>
          <div className="tiny muted-3 mono">{row.original.phone}</div>
        </>
      ),
    },
    {
      accessorKey: 'role',
      header: t('users.col.role'),
      cell: ({ row }) => (
        <span className={`badge badge-${ROLE_TONES[row.original.role] || 'muted'}`}>
          <span className="dot" />{t(`users.role.${row.original.role}`)}
        </span>
      ),
    },
    {
      accessorKey: 'scope',
      header: t('users.col.scope'),
      cell: ({ row }) => <span className="small">{row.original.scope || '—'}</span>,
    },
    {
      id: 'district',
      accessorFn: (r) => geo(r).district,
      header: t('holdings.district'),
      cell: ({ getValue }) => <span className="small">{getValue() || '—'}</span>,
    },
    {
      id: 'city',
      accessorFn: (r) => geo(r).city,
      header: t('holdings.city'),
      cell: ({ getValue }) => <span className="small">{getValue() || '—'}</span>,
    },
    {
      accessorKey: 'lastLogin',
      header: t('users.col.lastLogin'),
      cell: ({ row }) => (row.original.lastLogin
        ? <span className="small">{date(row.original.lastLogin)}</span>
        // Worth seeing at a glance: an account nobody has ever used is either a
        // typo in the number or somebody who was never told their password.
        : <span className="tiny muted-3">{t('users.neverSignedIn')}</span>),
    },
    {
      accessorKey: 'isActive',
      header: t('users.col.status'),
      cell: ({ row }) => (row.original.isActive
        ? <span className="badge badge-ok"><span className="dot" />{t('users.active')}</span>
        : <span className="badge badge-muted"><span className="dot" />{t('users.inactive')}</span>),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { stopClick: true },
      cell: ({ row }) => (
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          {/* Never offered for your own row — the server refuses it anyway, and
              a button that always errors is worse than no button. */}
          {row.original.id !== me?.id && canManage(row.original) && (
            <button type="button" className="link-btn"
              onClick={() => setActive(row.original, !row.original.isActive)}>
              {t(row.original.isActive ? 'users.deactivate' : 'users.activate')}
            </button>
          )}
          {(row.original.id === me?.id || canManage(row.original)) && (
            <button type="button" className="link-btn" onClick={() => setEditing(row.original)}>
              {t('common.edit')}
            </button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, date, me, geo])

  const exportColumns = [
    { key: 'name', label: t('users.col.name') },
    { key: 'phone', label: t('users.col.phone') },
    { key: 'roleLabel', label: t('users.col.role') },
    { key: 'scope', label: t('users.col.scope') },
    { key: 'district', label: t('holdings.district'), get: (r) => geo(r).district },
    { key: 'city', label: t('holdings.city'), get: (r) => geo(r).city },
    { key: 'email', label: t('users.col.email') },
    { key: 'lastLogin', label: t('users.col.lastLogin') },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        title={t('users.title')}
        subtitle={rows.length === 1
          ? t('users.subtitleOne')
          : t('users.subtitle', { count: rows.length })}
        actions={<>
          <ExportMenu
            title={t('users.title')}
            subtitle={t('common.records', { count: rows.length })}
            columns={exportColumns}
            rows={rows}
            filename="users"
          />
          <button className="btn btn-primary" onClick={() => setEditing(blankUser(agencies))}>
            <IconPlus size={16} /> {t('users.add')}
          </button>
        </>}
      />

      <div className="stat-grid">
        <StatCard icon={<IconUsers size={18} />} label={t('users.stat.total')}
          value={stats.total} sub={t('users.stat.totalSub')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('users.stat.active')}
          value={stats.active} sub={t('users.stat.activeSub')} />
        <StatCard icon={<IconUsers size={18} />} tone="brand" label={t('users.stat.admins')}
          value={stats.admins} sub={t('users.stat.adminsSub')} />
        <StatCard icon={<IconAlert size={18} />} tone={stats.never ? 'warn' : 'ok'}
          label={t('users.stat.never')} value={stats.never} sub={t('users.stat.neverSub')} />
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}
      {note && (
        <div className="app-banner info" role="status">
          <span className="grow">{note}</span>
          <button className="icon-btn" onClick={() => setNote('')} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          // The top-bar search lands here as /app/users?q=…; a new q starts the
          // table afresh with it.
          key={searchParam}
          initialSearch={searchParam}
          columns={columns}
          data={rows}
          loading={loading}
          searchPlaceholder={t('users.searchPlaceholder')}
          empty={<EmptyState>{t('users.empty')}</EmptyState>}
          toolbar={(
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t('users.allRoles')}</option>
              {ROLES.map((r) => <option key={r} value={r}>{t(`users.role.${r}`)}</option>)}
            </select>
          )}
        />
      </div>

      {editing && (
        <UserForm
          initial={editing}
          isMe={editing.id === me?.id}
          canGrantSuper={me?.roleKey === 'super_admin'}
          onlyRoles={manages}
          myAgency={manages ? me?.agency || null : null}
          lockAgency={!!manages}
          areaWards={areaWards}
          wards={catalog?.wards || []}
          zones={catalog?.zones || []}
          cities={catalog?.cities || []}
          districts={catalog?.districts || []}
          agencies={agencies || []}
          bloodGroups={catalog?.bloodGroups || []}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null)
            setNote(t(created ? 'users.created' : 'users.updated', { name: saved.name }))
            load()
          }}
        />
      )}
    </div>
  )
}

function UserForm({
  initial, isMe, canGrantSuper, onlyRoles, myAgency, lockAgency, areaWards, wards, zones, cities, districts, agencies, bloodGroups, onClose, onSaved,
}) {
  const { t, lang, zoneName, localName } = useLang()
  const isNew = !initial.id
  const [form, setForm] = useState({ ...blankUser(agencies), ...initial })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k) => (e) => {
    const value = e.target.value
    // A City Viewer is always city-wide; the City picker then names their city.
    setForm((f) => ({ ...f, [k]: value, ...(k === 'role' && value === 'kcc_viewer' ? { scopeKind: 'city' } : {}) }))
    setError(null)
  }
  const fieldError = (name) => error?.fieldError?.(name)
  const isSuper = form.role === 'super_admin'
  // A City Viewer is city-wide and belongs to no agency: given a city, they
  // see that city only; with none, the whole system.
  const isViewer = form.role === 'kcc_viewer'

  // District -> City Corporation / Pourashova, as on the Agency Master: no city
  // is listed until a district is chosen. The city narrows the zone and ward
  // lists (and wards by zone too), so the form never shows every ward of every
  // city at once. The district is never saved; the city is saved only for a
  // city-wide user. An existing user opens on the district and city of what
  // they already have.
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones])
  const wardById = useMemo(() => new Map(wards.map((w) => [w.id, w])), [wards])
  const cityOfWard = useCallback(
    (w) => w?.city || zoneById.get(w?.zone)?.city || '',
    [zoneById],
  )
  const cityById = useMemo(() => new Map(cities.map((c) => [c.id, c])), [cities])
  // An agency admin's users work where the agency works: only its districts
  // and cities are offered (the server holds the area to them as well).
  const agencyCities = useMemo(() => {
    const own = myAgency && (agencies || []).find((a) => a.id === myAgency)
    const ids = own ? (own.cities?.length ? own.cities : own.city ? [own.city] : []) : []
    return ids.length ? new Set(ids) : null
  }, [agencies, myAgency])
  const areaCities = useMemo(
    () => (areaWards ? new Set(wards.filter((w) => areaWards.has(w.id)).map((w) => w.city || zones.find((z) => z.id === w.zone)?.city)) : null),
    [areaWards, wards, zones],
  )
  const cityOk = (id) => (!agencyCities || agencyCities.has(id)) && (!areaCities || areaCities.has(id))
  const districtChoices = agencyCities
    ? districts.filter((d) => cities.some((c) => c.district === d.name && agencyCities.has(c.id)))
    : districts
  const [pickCity, setPickCity] = useState(() => {
    const first = wardById.get((initial.scopeWards || [])[0])
    const usable = cities.filter((c) => cityOk(c.id))
    return cityOfWard(first) || zoneById.get(initial.scopeZone)?.city || initial.city
      || (usable.length === 1 ? usable[0].id : '')
  })
  const [pickDistrict, setPickDistrict] = useState(() => cityById.get(pickCity)?.district || '')
  const cityChoices = useMemo(
    () => cities.filter((c) => pickDistrict && c.district === pickDistrict && cityOk(c.id))
      .sort((a, b) => String(localName(a)).localeCompare(String(localName(b)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cities, pickDistrict, localName, agencyCities],
  )
  const geoLabel = (row) => (lang === 'bn' && row.nameBn ? row.nameBn : row.name)
  const [pickZone, setPickZone] = useState(() => {
    const own = (initial.scopeWards || []).map((id) => wardById.get(id)?.zone).filter(Boolean)
    return own.length && own.every((z) => z === own[0]) ? own[0] : ''
  })
  const [wardQuery, setWardQuery] = useState('')
  // A city must be chosen before any zone or ward is listed.
  const needsCity = cities.length > 0 && !pickCity
  const zoneChoices = useMemo(
    () => (needsCity ? [] : zones.filter((z) => (!pickCity || z.city === pickCity)
      && (!areaWards || wards.some((w) => w.zone === z.id && areaWards.has(w.id))))),
    [zones, pickCity, needsCity, areaWards, wards],
  )
  const shownWards = useMemo(() => {
    if (needsCity) return []
    const q = wardQuery.trim().toLowerCase()
    return sortWards(wards.filter((w) => (
      (!pickCity || cityOfWard(w) === pickCity)
      && (!areaWards || areaWards.has(w.id))
      && (!pickZone || w.zone === pickZone)
      && (!q || [w.name, w.nameBn, w.id].some((s) => String(s || '').toLowerCase().includes(q)))
    )), () => '')
  }, [wards, needsCity, pickCity, pickZone, wardQuery, cityOfWard, areaWards])

  function chooseCity(city) {
    setPickCity(city)
    setPickZone('')
    // The city is what a city-wide user is saved with; a zone of another city
    // cannot stay chosen for a zone-scoped user.
    setForm((f) => ({
      ...f,
      city,
      scopeZone: f.scopeZone && zoneById.get(f.scopeZone)?.city !== city ? '' : f.scopeZone,
    }))
    setError(null)
  }

  function chooseDistrict(district) {
    setPickDistrict(district)
    if (!district || cityById.get(pickCity)?.district !== district) chooseCity('')
  }

  function tickShown(on) {
    setForm((f) => {
      const shown = new Set(shownWards.map((w) => w.id))
      return {
        ...f,
        scopeWards: on
          ? [...f.scopeWards, ...shownWards.map((w) => w.id).filter((id) => !f.scopeWards.includes(id))]
          : f.scopeWards.filter((id) => !shown.has(id)),
      }
    })
    setError(null)
  }

  function toggleWard(id) {
    setForm((f) => ({
      ...f,
      scopeWards: f.scopeWards.includes(id)
        ? f.scopeWards.filter((w) => w !== id)
        : [...f.scopeWards, id],
    }))
    setError(null)
  }

  // An agency admin is confined by their agency; without one there is nothing
  // to confine them to, so the form will not send it (the server refuses too).
  const needsAgency = form.role === 'agency_admin' && !isMe

  async function submit(event) {
    event.preventDefault()
    if (needsAgency && !(myAgency || form.agency)) {
      setError({ fieldError: (name) => (name === 'agency' ? t('users.agencyMissing') : undefined) })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        phone: form.phone.trim(),
        name: form.name.trim(),
        role: form.role,
        scopeKind: form.scopeKind,
        scopeZone: form.scopeKind === 'zone' ? form.scopeZone : '',
        scopeWards: form.scopeKind === 'ward' ? form.scopeWards : [],
        // Only a city-wide scope can be narrowed to one city; empty means every city.
        city: form.scopeKind === 'city' ? (form.city || null) : null,
        // A super admin answers to no contractor, so the box is cleared rather
        // than merely ignored — otherwise switching an agency admin up to super
        // admin would carry their old agency along and the server would refuse.
        agency: isSuper || isViewer ? null : lockAgency ? myAgency : (form.agency || null),
        email: form.email.trim(),
        altPhone: form.altPhone.trim(),
        nid: form.nid.trim(),
        bloodGroup: form.bloodGroup,
        emergencyContact: form.emergencyContact.trim(),
      }
      // On an edit an empty box means "leave the password alone", not "set it to
      // nothing" — sending a blank would be a silent lockout.
      if (form.password) body.password = form.password
      // Your own role and scope are locked. Sending them unchanged would pass,
      // but not sending them at all is what makes the disabled fields honest.
      if (isMe) {
        delete body.role
        delete body.scopeKind
        delete body.scopeZone
        delete body.scopeWards
        delete body.city
        delete body.agency
      }
      const saved = isNew ? await api.create(body) : await api.update(initial.id, body)
      onSaved(saved, isNew)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? t('users.formNew') : t('users.formEdit')}
      subtitle={isNew ? t('users.formHintNew') : t('users.formHintEdit')}
      onClose={onClose}
      width={640}
    >
      <form onSubmit={submit}>
        {error?.detail && !error?.fields && (
          <div className="app-banner error" role="alert">{error.detail}</div>
        )}

        <FormSection title={t('users.group.identity')} first>
          <FormRow>
            <Field half label={t('users.col.name')} value={form.name} onChange={set('name')}
              disabled={busy} required />
            <Field half label={t('users.col.phone')} value={form.phone} onChange={set('phone')}
              placeholder="01XXXXXXXXX" disabled={busy || !isNew} required
              // The phone number is the login identifier. Changing it would move
              // somebody else's account onto a number they do not hold, so it is
              // set once — a wrong one is deactivated and re-entered.
              hint={isNew ? t('users.phoneHint') : t('users.phoneLocked')} />
          </FormRow>
          <FieldNote>{fieldError('phone') || fieldError('name')}</FieldNote>
          <FormRow>
            <Field half label={t('users.field.password')} type="password"
              value={form.password} onChange={set('password')} disabled={busy}
              required={isNew}
              hint={isNew ? t('users.passwordHint') : t('users.passwordResetHint')} />
            <Field half label={t('users.col.email')} type="email" value={form.email}
              onChange={set('email')} disabled={busy} />
          </FormRow>
          <FieldNote>{fieldError('password') || fieldError('email')}</FieldNote>
        </FormSection>

        <FormSection title={t('users.group.access')}>
          {isMe && (
            <div className="tiny muted-3" style={{ marginBottom: 10 }}>
              {t('users.ownAccessLocked')}
            </div>
          )}
          <FormRow>
            <Field half as="select" label={t('users.col.role')} value={form.role}
              onChange={set('role')} disabled={busy || isMe}
              // Granting the unconfined role is the one escalation this form
              // could otherwise offer: an agency admin makes a super admin,
              // signs in as it, and the confinement is gone. The server refuses
              // it either way; the option is simply not shown.
              options={ROLES
                // City Viewer accounts are the super admin's to create, too.
                .filter((r) => (r !== 'super_admin' && r !== 'kcc_viewer') || canGrantSuper || form.role === r)
                .filter((r) => !onlyRoles || onlyRoles.includes(r) || (isMe && form.role === r))
                .map((r) => ({ value: r, label: t(`users.role.${r}`) }))} />
            <Field half as="select" label={t('users.field.scopeKind')} value={form.scopeKind}
              onChange={set('scopeKind')} disabled={busy || isMe || isViewer}
              hint={t(`users.scopeHint.${form.scopeKind}`)}
              // A supervisor's collector works inside the supervisor's wards.
              options={SCOPES.filter((s) => !areaWards || s === 'ward' || s === 'zone' || s === form.scopeKind)
                .map((s) => ({ value: s, label: t(`users.scope.${s}`) }))} />
          </FormRow>
          <FieldNote>{fieldError('role') || fieldError('scopeKind')}</FieldNote>

          {form.scopeKind !== 'agency' && (
            <>
              <FormRow>
                <SearchSelect size="md" label={t('holdings.district')} value={pickDistrict}
                  onChange={chooseDistrict} disabled={busy || isMe}
                  placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
                  options={districtChoices.map((d) => ({ value: d.name, label: geoLabel(d), keywords: [d.name, d.nameBn] }))} />
                <SearchSelect size="md" label={t('holdings.city')} value={pickCity}
                  onChange={chooseCity} disabled={busy || isMe || !pickDistrict}
                  placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
                  hint={!pickDistrict ? t('users.pickDistrictFirst')
                    : cityChoices.length === 0 ? t('holdings.noCityInDistrict')
                      : form.scopeKind === 'city' && !pickCity ? t('users.allCitiesHint') : undefined}
                  options={cityChoices.map((c) => ({ value: c.id, label: localName(c), keywords: [c.id, c.name, c.nameBn] }))} />
              </FormRow>
              <FieldNote>{fieldError('city')}</FieldNote>
            </>
          )}

          {form.scopeKind === 'zone' && (
            <>
              <FormRow>
                <Field half as="select" label={t('users.field.scopeZone')} value={form.scopeZone}
                  onChange={set('scopeZone')} disabled={busy || isMe}
                  options={[{ value: '', label: '—' },
                    ...zoneChoices.map((z) => ({ value: z.id, label: zoneName(z.id) }))]} />
              </FormRow>
              <FieldNote>{fieldError('scopeZone')}</FieldNote>
            </>
          )}

          {form.scopeKind === 'ward' && (
            <div className="field">
              <label>{t('users.field.scopeWards')}</label>
              <FormRow>
                <Field half as="select" label={t('users.field.filterZone')} value={pickZone}
                  onChange={(e) => setPickZone(e.target.value)} disabled={busy || isMe || needsCity}
                  options={[{ value: '', label: t('users.allZones') },
                    ...zoneChoices.map((z) => ({ value: z.id, label: zoneName(z.id) }))]} />
              </FormRow>

              {/* Everything ticked, whichever city or zone is on screen, so a
                  ward chosen earlier is never hidden by the filter. */}
              {form.scopeWards.length > 0 && (
                <div className="ward-chips">
                  <span className="tiny muted">
                    {t('users.wardsSelected', { count: form.scopeWards.length })}
                  </span>
                  {form.scopeWards.map((id) => (
                    <span key={id} className="ward-chip">
                      {wardById.get(id) ? localName(wardById.get(id)) : id}
                      {!(busy || isMe) && (
                        <button type="button" aria-label={t('users.removeWard')}
                          onClick={() => toggleWard(id)}>×</button>
                      )}
                    </span>
                  ))}
                </div>
              )}

              {needsCity ? (
                <span className="tiny muted">{t('users.pickCityFirst')}</span>
              ) : (
                <>
                  <div className="row gap-8" style={{ margin: '8px 0', flexWrap: 'wrap' }}>
                    <input className="input" style={{ flex: '1 1 180px' }} type="search"
                      placeholder={t('users.searchWards')} aria-label={t('users.searchWards')}
                      value={wardQuery} onChange={(e) => setWardQuery(e.target.value)} />
                    <button type="button" className="btn" disabled={busy || isMe || shownWards.length === 0}
                      onClick={() => tickShown(true)}>{t('users.selectAllWards')}</button>
                    <button type="button" className="btn" disabled={busy || isMe || shownWards.length === 0}
                      onClick={() => tickShown(false)}>{t('users.clearWards')}</button>
                  </div>
                  <div className="check-grid ward-list">
                    {shownWards.map((ward) => (
                      <label key={ward.id} className="check">
                        <input type="checkbox" disabled={busy || isMe}
                          checked={form.scopeWards.includes(ward.id)}
                          onChange={() => toggleWard(ward.id)} />
                        <span>{localName(ward)}</span>
                      </label>
                    ))}
                    {shownWards.length === 0 && (
                      <span className="tiny muted">{t(wards.length ? 'users.noWardsMatch' : 'users.noWards')}</span>
                    )}
                  </div>
                </>
              )}
              <FieldNote>{fieldError('scopeWards')}</FieldNote>
            </div>
          )}

          <FormRow>
            <Field half as="select" label={needsAgency ? `${t('users.field.agency')} *` : t('users.field.agency')}
              value={isSuper || isViewer ? '' : lockAgency ? (myAgency || '') : (form.agency || '')}
              // An agency admin's users are always their own agency's.
              onChange={set('agency')} disabled={busy || isMe || isSuper || isViewer || lockAgency}
              // The agency *is* the boundary: an agency admin without one would
              // be confined to nothing, and a super admin with one would be
              // confined by an agency they do not answer to.
              hint={isSuper ? t('users.agencyNoneForSuper')
                : form.role === 'agency_admin' ? t('users.agencyRequired')
                  : t('users.agencyHint')}
              options={[{ value: '', label: needsAgency ? t('users.chooseAgency') : t('users.noAgency') },
                ...pickableAgencies(agencies, myAgency || initial?.agency).map((a) => ({ value: a.id, label: localName(a) }))]} />
          </FormRow>
          <FieldNote>{fieldError('agency')}</FieldNote>
        </FormSection>

        <FormSection title={t('users.group.contact')}>
          <FormRow>
            <Field third label={t('users.field.altPhone')} value={form.altPhone}
              onChange={set('altPhone')} placeholder="01XXXXXXXXX" disabled={busy} />
            <Field third label={t('users.field.nid')} value={form.nid}
              onChange={set('nid')} disabled={busy} />
            <Field narrow as="select" label={t('users.field.bloodGroup')} value={form.bloodGroup}
              onChange={set('bloodGroup')} disabled={busy}
              options={[{ value: '', label: '—' },
                ...bloodGroups.map((b) => ({ value: b, label: b }))]} />
          </FormRow>
          <FormRow>
            <Field label={t('users.field.emergencyContact')} value={form.emergencyContact}
              onChange={set('emergencyContact')} disabled={busy} />
          </FormRow>
        </FormSection>

        <ModalActions>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

function FieldNote({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger)', marginTop: -6, marginBottom: 8 }}>{children}</div>
}
