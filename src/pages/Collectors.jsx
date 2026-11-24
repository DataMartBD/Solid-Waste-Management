import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader, StatCard, Status } from '../components/ui.jsx'
import { Modal, Field, FormRow, ModalActions } from '../components/Modal.jsx'
import { SearchSelect } from '../components/SearchSelect.jsx'
import { sortWards } from './Holdings.jsx'
import { IconUsers, IconCheck, IconAlert, IconPlus, IconDownload, IconEye, IconEdit, IconTrash, IconRefresh, IconSearch, IconRoute, IconArrow } from '../components/Icons.jsx'
import { fold } from '../components/DataTable.jsx'
import { useData } from '../context/DataContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { downloadCSV } from '../utils/export.js'
import { pickableAgencies } from '../utils/agencies.js'
import { canAccess } from '../access.js'
import { routesForCollector } from '../utils/collection.js'

const daysUntil = (d) => (d ? Math.round((new Date(d) - new Date()) / 86400000) : null)
const LICENCE_WINDOW_DAYS = 60
// The window the server recomputes coverage / on-time over.
const METRICS_WINDOW_DAYS = 30

const TODAY = new Date().toISOString().slice(0, 10)

// `onTime`, `coverage` and `complaints` are deliberately absent: they are
// server-computed metrics, and `dspId` is assigned by the server when omitted.
const EMPTY = {
  name: '', wards: [], phone: '', license: '', licenseExp: '',
  joined: TODAY, agency: '',
}

// A collector's wards; the home ward alone for a row saved before there could be several.
const wardsOf = (c) => (c?.wards?.length ? c.wards : c?.zone ? [c.zone] : [])

// A collector's wards by name, in ward order: "3, 5, 7".
function useWardList(wards) {
  const { localName } = useLang()
  const byId = useMemo(() => new Map((wards || []).map((w) => [w.id, w])), [wards])
  return (ids) => {
    if (!ids.length) return '—'
    const rows = sortWards(ids.map((id) => byId.get(id) || { id, name: id }), () => '')
    return rows.map((w) => localName(w)).join(', ')
  }
}

export default function Collectors() {
  const { collectors, vans, wards, catalog, agencies = [], routes = [], assignments = [], create, update, remove, act, api, vanById } = useData()
  // Each collector's load: the routes they walk and the stops on them.
  const loadOf = useCallback((c) => {
    const held = routesForCollector(c.id, { routes, assignments })
    return { routes: held.length, stops: held.reduce((sum, r) => sum + (r.stops?.length || 0), 0) }
  }, [routes, assignments])
  const wardList = useWardList(wards)
  const { isAdmin, user } = useAuth()
  const navigate = useNavigate()
  // Route assignments live on Route Plan → Assignments; this opens it on the collector.
  // `from` tells Route Plan where its back button returns: the list, or this
  // collector's details panel (reopened through ?open=<id>).
  const assignRoute = canAccess('/app/route-plan', user)
    ? (c, from = 'collectors') => navigate(`/app/route-plan?tab=crew&collector=${encodeURIComponent(c.id)}&from=${from}`)
    : null
  const { t, n, percent, date, lang, localName } = useLang()
  const [selected, setSelected] = useState(null)
  // An agency's own staff add collectors to their agency without choosing it;
  // only corporation staff (no agency of their own) pick one, or transfer.
  const myAgency = user?.agency || null
  const agencyById = useMemo(() => new Map((agencies || []).map((a) => [a.id, a])), [agencies])
  const agencyText = (id) => (id ? (agencyById.get(id) ? localName(agencyById.get(id)) : id) : '')
  const [transferring, setTransferring] = useState(null)

  // A collector's District and City Corporation / Pourashova, from the city of
  // their wards (all of a collector's wards are in one city).
  const geoOf = useMemo(() => {
    const wardById = new Map((wards || []).map((w) => [w.id, w]))
    const cityById = new Map((catalog?.cities || []).map((c) => [c.id, c]))
    const districtByName = new Map((catalog?.districts || []).map((d) => [d.name, d]))
    return (c) => {
      const city = cityById.get(wardById.get(wardsOf(c)[0])?.city)
      const d = city?.district ? districtByName.get(city.district) : null
      return {
        city: city ? localName(city) : '',
        district: d ? (lang === 'bn' && d.nameBn ? d.nameBn : d.name) : (city?.district || ''),
      }
    }
  }, [wards, catalog, lang, localName])
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  // The search box: name, DSP ID or mobile number, any part of it.
  const [params, setParams] = useSearchParams()
  const searchParam = params.get('q') || ''
  const [query, setQuery] = useState(searchParam)
  // A new search from the top bar while already on this page.
  useEffect(() => { if (searchParam) setQuery(searchParam) }, [searchParam])
  // ?open=<id> reopens that collector's details panel (Route Plan's back button).
  const openParam = params.get('open') || ''
  useEffect(() => {
    if (!openParam) return
    const c = collectors.find((x) => x.id === openParam)
    if (!c) return
    setSelected(c)
    // Once only: drop it, so a later refresh of the list does not reopen the panel.
    const next = new URLSearchParams(params)
    next.delete('open')
    setParams(next, { replace: true })
  }, [openParam, collectors, params, setParams])
  const shown = useMemo(() => {
    const q = fold(query).trim()
    if (!q) return collectors
    return collectors.filter((c) => fold([c.name, c.dspId, c.phone].filter(Boolean).join(' ')).includes(q))
  }, [collectors, query])

  const active = collectors.filter((c) => c.attendance === 'checked_in').length
  const licenceSoon = collectors.filter((c) => {
    const days = daysUntil(c.licenseExp)
    return days !== null && days <= LICENCE_WINDOW_DAYS
  }).length
  const avgCov = collectors.length ? Math.round(collectors.reduce((a, c) => a + (c.coverage || 0), 0) / collectors.length) : 0

  function exportCsv() {
    downloadCSV('collectors', collectors, [
      { key: 'name', label: t('collectors.field.name') }, { key: 'dspId', label: t('collectors.th.dspId') },
      { key: 'agency', label: t('collectors.field.agency'), get: (r) => agencyText(r.agency) },
      { key: 'district', label: t('holdings.district'), get: (r) => geoOf(r).district },
      { key: 'city', label: t('holdings.city'), get: (r) => geoOf(r).city },
      { key: 'wards', label: t('collectors.th.zone'), get: (r) => wardList(wardsOf(r)) },
      { key: 'phone', label: t('collectors.field.contact') }, { key: 'license', label: t('collectors.csv.licence') }, { key: 'licenseExp', label: t('collectors.field.licenceExpiry') },
      // The van link is owned by Fleet and read back as `vanId`.
      { key: 'van', label: t('collectors.th.van'), get: (r) => r.vanId || '' },
      { key: 'routes', label: t('collectors.th.routes'), get: (r) => loadOf(r).routes },
      { key: 'stops', label: t('collectors.th.stops'), get: (r) => loadOf(r).stops },
      { key: 'coverage', label: t('collectors.csv.coveragePct') }, { key: 'onTime', label: t('collectors.csv.onTimePct') },
      { key: 'attendance', label: t('collectors.th.attendance'), get: (r) => t(`status.${r.attendance}`) },
    ], { t })
  }

  // Recomputes every collector's coverage and on-time from the visit log. Admin
  // only, because the figures feed staff reviews — the server enforces that too.
  async function refreshMetrics() {
    setBusy(true)
    setNote(null)
    const result = await act(api.collectors.refreshMetrics(METRICS_WINDOW_DAYS), { refresh: ['collectors'] })
    setBusy(false)
    setNote(result.ok
      ? { tone: 'ok', text: t('collectors.metricsRefreshed', { count: n(result.data?.updated || 0), days: n(METRICS_WINDOW_DAYS) }) }
      : { tone: 'bad', text: result.error?.detail || t('collectors.saveFailed') })
  }

  async function removeCollector(c) {
    if (!confirm(t('collectors.removeConfirm', { name: c.name }))) return
    setBusy(true)
    const result = await remove('collectors', c.id)
    setBusy(false)
    if (!result.ok) setNote({ tone: 'bad', text: result.error?.detail || t('collectors.saveFailed') })
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={t('collectors.title')}
        subtitle={t('collectors.subtitle')}
        actions={<>
          {/* Always there for those who can open Route Plan; back onto Assignments
              when this page was reached from Route Plan. */}
          {assignRoute && (
            <button className="btn btn-ghost" onClick={() => navigate(params.get('from') === 'route-plan' ? '/app/route-plan?tab=crew' : '/app/route-plan')}>
              <IconArrow size={15} style={{ transform: 'rotate(180deg)' }} /> {t('collectors.backToRoutePlan')}
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-ghost" disabled={busy} onClick={refreshMetrics}>
              {busy ? <span className="spinner spinner-dark" /> : <IconRefresh size={16} />} {t('collectors.refreshMetrics')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={exportCsv}><IconDownload size={16} /> {t('collectors.export')}</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}><IconPlus size={16} /> {t('collectors.addCollector')}</button>
        </>}
      />

      {note && (
        <div className={`form-note ${note.tone}`} style={{ marginBottom: 16 }}>
          {note.tone === 'ok' ? <IconCheck size={15} /> : <IconAlert size={15} />}<span>{note.text}</span>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard icon={<IconUsers size={18} />} label={t('collectors.stat.totalDsps')} value={n(collectors.length)} sub={t('collectors.stat.totalDspsSub')} />
        <StatCard icon={<IconCheck size={18} />} tone="ok" label={t('collectors.stat.checkedIn')} value={n(active)} sub={t('collectors.stat.checkedInSub', { count: n(collectors.length) })} progress={collectors.length ? (active / collectors.length) * 100 : 0} />
        <StatCard icon={<IconAlert size={18} />} tone="warn" label={t('collectors.stat.licenceDue')} value={n(licenceSoon)} sub={t('collectors.stat.licenceDueSub', { days: n(LICENCE_WINDOW_DAYS) })} />
        <StatCard icon={<IconCheck size={18} />} tone="info" label={t('collectors.stat.avgCoverage')} value={percent(avgCov)} sub={t('collectors.stat.avgCoverageSub')} />
      </div>

      <div className="row gap-8 wrap" style={{ marginBottom: 12 }}>
        <div className="chip-input">
          <IconSearch size={16} />
          <input placeholder={t('collectors.searchPlaceholder')} aria-label={t('collectors.searchPlaceholder')}
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="grow" />
        <span className="tiny muted">{t('common.shown', { count: n(shown.length) })}</span>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>{t('collectors.th.collector')}</th><th>{t('collectors.th.dspId')}</th><th>{t('collectors.field.agency')}</th><th>{t('holdings.district')}</th><th>{t('holdings.city')}</th><th>{t('collectors.th.zone')}</th><th>{t('collectors.th.van')}</th><th>{t('collectors.th.routes')}</th><th>{t('collectors.th.licenceExp')}</th><th>{t('collectors.th.coverage')}</th><th>{t('collectors.th.onTime')}</th><th>{t('collectors.th.attendance')}</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const licDays = daysUntil(c.licenseExp)
                const licenceSoonRow = licDays !== null && licDays <= LICENCE_WINDOW_DAYS
                return (
                  <tr key={c.id}>
                    <td style={{ cursor: 'pointer' }} onClick={() => setSelected(c)}>
                      <div className="row gap-12">
                        <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>{c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
                        <span style={{ fontWeight: 600 }}>{c.name}</span>
                      </div>
                    </td>
                    <td className="mono small">{c.dspId}</td>
                    <td className="small">{agencyText(c.agency) || <span className="muted-3">—</span>}</td>
                    <td>{geoOf(c).district || <span className="muted-3">—</span>}</td>
                    <td>{geoOf(c).city || <span className="muted-3">—</span>}</td>
                    <td>{wardList(wardsOf(c))}</td>
                    <td className="mono small">{c.vanId || <span className="muted-3">—</span>}</td>
                    <td>{(() => {
                      const load = loadOf(c)
                      return load.routes
                        ? <span className="small">{t('collectors.routesLoad', { routes: n(load.routes), stops: n(load.stops) })}</span>
                        : <span className="badge badge-warn"><span className="dot" />{t('collectors.noRoute')}</span>
                    })()}</td>
                    <td><span className={licenceSoonRow ? 'badge badge-warn' : 'badge badge-muted'}>{date(c.licenseExp)}</span></td>
                    <td><div className="row gap-8"><div className="mini-bar"><i style={{ width: `${c.coverage || 0}%` }} /></div><span className="tiny mono">{percent(c.coverage || 0)}</span></div></td>
                    <td className="mono">{percent(c.onTime || 0)}</td>
                    <td><Status value={c.attendance} /></td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="act-btn" title={t('common.details')} onClick={() => setSelected(c)}><IconEye size={16} /></button>
                        <button className="act-btn" title={t('common.edit')} onClick={() => setEditing(c)}><IconEdit size={15} /></button>
                        {assignRoute && <button className="act-btn" title={t('collectors.assignRoute')} aria-label={t('collectors.assignRoute')} onClick={() => assignRoute(c)}><IconRoute size={15} /></button>}
                        <button className="act-btn danger" title={t('collectors.remove')} disabled={busy} onClick={() => removeCollector(c)}><IconTrash size={15} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <CollectorDrawer c={selected} wardText={wardList(wardsOf(selected))} van={vanById(selected.vanId)}
        agencyText={agencyText(selected.agency)}
        onTransfer={myAgency ? null : () => { setTransferring(selected); setSelected(null) }}
        onAssignRoute={assignRoute ? () => assignRoute(selected, 'collector-details') : null}
        onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null) }} />}
      {transferring && (
        <TransferModal c={transferring} agencies={agencies} currentText={agencyText(transferring.agency)}
          onClose={() => setTransferring(null)}
          onSave={async (body) => {
            const result = await act(api.collectors.transfer(transferring.id, body), { refresh: ['collectors', 'agencies'] })
            if (result.ok) {
              setTransferring(null)
              setNote({ tone: 'ok', text: t('collectors.transferred', { name: transferring.name, agency: agencyText(body.agency) }) })
            }
            return result
          }} />
      )}
      {editing && (
        <CollectorForm
          initial={editing}
          vans={vans}
          wards={wards}
          cities={catalog?.cities || []}
          districts={catalog?.districts || []}
          agencies={agencies}
          myAgency={myAgency}
          agencyText={agencyText}
          onTransfer={myAgency || !editing.id ? null : () => { setTransferring(editing); setEditing(null) }}
          onClose={() => setEditing(null)}
          onSave={async ({ driver, ...data }) => {
            const payload = {
              name: data.name.trim(), wards: data.wards, phone: data.phone,
              license: data.license, licenseExp: data.licenseExp || null,
              // Status and attendance are not on the form: the round and the
              // depot check-in set them, and a new collector starts idle and checked in.
              joined: data.joined || null,
              // Only sent when the operator typed one; otherwise the server mints it.
              ...(data.dspId ? { dspId: data.dspId } : {}),
              // Chosen once, on a new collector, by corporation staff; an
              // agency's own staff get theirs from the server. Later: Transfer.
              ...(!data.id && !myAgency && data.agency ? { agency: data.agency } : {}),
            }
            const saved = data.id
              ? await update('collectors', data.id, payload)
              : await create('collectors', payload)
            if (!saved.ok) return saved

            // One server call owns the pairing: it also releases this collector
            // from any other van, which the old two-step client sync could not
            // guarantee — a failure between the two writes left them driving two.
            const wasDriving = data.vanId || ''
            if (driver !== wasDriving) {
              const pairing = driver
                ? await act(api.vans.assignDriver(driver, saved.data.id), { refresh: ['vans', 'collectors'] })
                : await act(api.vans.assignDriver(wasDriving, null), { refresh: ['vans', 'collectors'] })
              if (!pairing.ok) return pairing
            }
            setEditing(null)
            return saved
          }}
        />
      )}
    </div>
  )
}

function CollectorForm({ initial, vans, wards, cities, districts, agencies, myAgency, agencyText, onTransfer, onClose, onSave }) {
  const { t, lang, localName } = useLang()
  // The van link comes from the collector's own read-only `vanId`.
  const [form, setForm] = useState({ ...initial, wards: wardsOf(initial), driver: initial.vanId || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // District -> City Corporation / Pourashova -> wards, as on the Holding Master.
  // Neither district nor city is saved: both are the wards'. An existing
  // collector opens on the city of the wards they already serve.
  const wardById = useMemo(() => new Map(wards.map((w) => [w.id, w])), [wards])
  // A collector works only in their agency's cities: the user's own agency,
  // the one they are with, or (new, corporation staff) the one picked above.
  const ownerId = myAgency || (initial.id ? initial.agency : form.agency)
  const allowedCities = useMemo(() => {
    const owner = (agencies || []).find((a) => a.id === ownerId)
    const ids = owner ? (owner.cities?.length ? owner.cities : owner.city ? [owner.city] : []) : []
    return ids.length ? new Set(ids) : null
  }, [agencies, ownerId])
  const cityAllowed = (id) => !allowedCities || allowedCities.has(id)
  const onlyCity = allowedCities?.size === 1 ? [...allowedCities][0] : ''
  const [city, setCity] = useState(() => wardById.get(wardsOf(initial)[0])?.city || (initial.id ? '' : onlyCity))
  const [district, setDistrict] = useState(() => cities.find((c) => c.id === city)?.district || '')
  const cityChoices = cities.filter((c) => (!district || c.district === district) && cityAllowed(c.id))
  const districtChoices = allowedCities
    ? districts.filter((d) => cities.some((c) => c.district === d.name && allowedCities.has(c.id)))
    : districts
  // Another agency picked: a city it does not work in is dropped (and with it
  // the wards); a single-city agency's city is filled in.
  useEffect(() => {
    if (city && !cityAllowed(city)) { setCity(''); setDistrict(''); setForm((f) => ({ ...f, wards: [] })) }
    else if (!city && onlyCity) {
      setCity(onlyCity)
      setDistrict(cities.find((c) => c.id === onlyCity)?.district || '')
    }
  }, [allowedCities]) // eslint-disable-line react-hooks/exhaustive-deps
  const wardChoices = useMemo(
    () => (city ? sortWards(wards.filter((w) => w.city === city), () => '') : []),
    [wards, city],
  )
  const geoLabel = (row) => (lang === 'bn' && row.nameBn ? row.nameBn : row.name)

  // All of a collector's wards are in one city, so a new city starts them afresh.
  function chooseCity(value) {
    if (value !== city) setForm((f) => ({ ...f, wards: [] }))
    setCity(value)
  }
  function chooseDistrict(value) {
    setDistrict(value)
    const keeps = !value || cities.some((c) => c.id === city && c.district === value)
    if (!keeps) chooseCity('')
  }
  function toggleWard(id) {
    setForm((f) => ({ ...f, wards: f.wards.includes(id) ? f.wards.filter((w) => w !== id) : [...f.wards, id] }))
  }
  const allTicked = wardChoices.length > 0 && wardChoices.every((w) => form.wards.includes(w.id))

  const fieldError = (name) => error?.fieldError?.(name)
  // A van follows its collector, so another agency's van is not offered: only
  // KCC's unowned vans, this agency's own, and the one they drive now.
  const vanChoices = vans.filter((v) => !v.agency || v.agency === ownerId || v.id === initial.vanId)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) { setError({ detail: t('collectors.nameRequired') }); return }
    if (!form.wards.length) { setError({ detail: t('collectors.wardRequired') }); return }
    setBusy(true)
    setError(null)
    const result = await onSave(form)
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={initial.id ? t('collectors.editTitle') : t('collectors.addTitle')} subtitle={initial.id ? initial.dspId : t('collectors.newProfile')} onClose={onClose} width={560}>
      <form onSubmit={submit}>
        <FormRow>
          <Field half label={t('collectors.field.fullName')} value={form.name} onChange={set('name')} autoFocus disabled={busy} />
          <Field half label={t('collectors.field.contact')} value={form.phone} onChange={set('phone')} placeholder={t('collectors.placeholder.phone')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('name') || fieldError('phone')}</FieldError>
        <FormRow>
          {!initial.id && !myAgency ? (
            <Field half as="select" label={t('collectors.field.agency')} value={form.agency || ''}
              onChange={set('agency')} disabled={busy}
              options={[{ value: '', label: t('collectors.noAgency') },
                ...pickableAgencies(agencies).map((a) => ({ value: a.id, label: localName(a) }))]} />
          ) : (
            <div className="field half">
              <label>{t('collectors.field.agency')}</label>
              <div className="row gap-8">
                <input className="input grow" readOnly disabled
                  value={agencyText(initial.id ? initial.agency : myAgency) || t('collectors.noAgency')} />
                {onTransfer && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onTransfer}>
                    {t('collectors.transfer')}
                  </button>
                )}
              </div>
            </div>
          )}
        </FormRow>
        <FieldError>{fieldError('agency')}</FieldError>
        <FormRow>
          <SearchSelect size="md" label={t('holdings.district')} value={district}
            onChange={chooseDistrict} disabled={busy}
            placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
            options={districtChoices.map((d) => ({ value: d.name, label: geoLabel(d), keywords: [d.name, d.nameBn] }))} />
          <SearchSelect size="md" label={t('holdings.city')} value={city}
            onChange={chooseCity} disabled={busy}
            placeholder={t('common.typeToSearch')} emptyText={t('common.noMatch')}
            hint={district && cityChoices.length === 0 ? t('holdings.noCityInDistrict') : undefined}
            options={cityChoices.map((c) => ({ value: c.id, label: localName(c), keywords: [c.id, c.name, c.nameBn] }))} />
        </FormRow>
        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <label>
              {t('collectors.field.wards')}<span className="req-mark" aria-hidden="true"> *</span>
              {form.wards.length > 0 && <span className="tiny muted-3"> · {t('collectors.wardsSelected', { count: form.wards.length })}</span>}
            </label>
            {wardChoices.length > 0 && (
              <button type="button" className="link-btn" disabled={busy}
                onClick={() => setForm((f) => ({ ...f, wards: allTicked ? [] : wardChoices.map((w) => w.id) }))}>
                {t(allTicked ? 'collectors.clearWards' : 'collectors.selectAllWards')}
              </button>
            )}
          </div>
          {!city ? (
            <span className="tiny muted">{t('holdings.editor.pickCityFirst')}</span>
          ) : wardChoices.length === 0 ? (
            <span className="tiny muted">{t('holdings.noWardInCity')}</span>
          ) : (
            <div className="check-grid ward-list">
              {wardChoices.map((w) => (
                <label key={w.id} className="check">
                  <input type="checkbox" disabled={busy}
                    checked={form.wards.includes(w.id)} onChange={() => toggleWard(w.id)} />
                  <span>{localName(w)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <FieldError>{fieldError('wards') || fieldError('zone')}</FieldError>
        <FormRow>
          <Field half label={t('collectors.field.licenceNo')} value={form.license} onChange={set('license')} placeholder={t('collectors.placeholder.licence')} disabled={busy} />
          <Field half label={t('collectors.field.licenceExpiry')} type="date" value={form.licenseExp || ''} onChange={set('licenseExp')} disabled={busy} />
        </FormRow>
        <FieldError>{fieldError('licenseExp') || fieldError('dspId')}</FieldError>
        <FormRow>
          <Field half as="select" label={t('collectors.field.van')} value={form.driver} onChange={set('driver')} disabled={busy}
            options={[{ value: '', label: t('collectors.field.unassigned') }, ...vanChoices.map((v) => ({ value: v.id, label: `${v.id} (${t(`collectors.vanType.${v.type}`)})` }))]} />
        </FormRow>
        <FieldError>{fieldError('driver')}</FieldError>
        {/* Coverage, on-time and the complaint count are computed server-side, so
            the form no longer offers them as editable numbers. */}
        <div className="tiny muted-3 mt-8">{t('collectors.metricsReadOnly')}</div>
        {error?.detail && (
          <div className="form-note bad" style={{ marginTop: 12 }}>
            <IconAlert size={15} />{/* A reason not tied to one field (e.g. a ward outside the
                account's area) says what it is, not just "fields need attention". */}
            <span>{fieldError('non_field_errors') || error.detail}</span>
          </div>
        )}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <><span className="spinner" /> {t('collectors.saving')}</> : initial.id ? t('common.save') : t('collectors.addCollector')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// One server field message, under the row that produced it.
function FieldError({ children }) {
  if (!children) return null
  return <div className="tiny" style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>{children}</div>
}

function CollectorDrawer({ c, van, wardText, agencyText, onTransfer, onAssignRoute, onClose, onEdit }) {
  const { t, n, percent, date, digits } = useLang()
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div className="row gap-12">
            <div className="avatar" style={{ width: 46, height: 46, fontSize: 16, borderRadius: 12 }}>{c.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</div>
            <div><h3 style={{ fontSize: 17 }}>{c.name}</h3><div className="tiny muted-3 mono mt-4">{c.dspId}</div></div>
          </div>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          <div className="row gap-8" style={{ marginBottom: 18 }}><Status value={c.status} /><Status value={c.attendance} /></div>
          <dl className="kv">
            <dt>{t('collectors.field.contact')}</dt><dd className="mono">{digits(c.phone)}</dd>
            <dt>{t('collectors.field.agency')}</dt><dd>{agencyText || '—'}</dd>
            <dt>{t('collectors.field.wards')}</dt><dd>{wardText}</dd>
            <dt>{t('collectors.field.joined')}</dt><dd>{date(c.joined)}</dd>
            <dt>{t('collectors.field.licenceNo')}</dt><dd className="mono">{c.license}</dd>
            <dt>{t('collectors.field.licenceExpiry')}</dt><dd>{date(c.licenseExp)}</dd>
            <dt>{t('collectors.field.van')}</dt><dd className="mono">{van ? `${van.id} (${t(`collectors.vanType.${van.type}`)})` : '—'}</dd>
          </dl>
          <h4 className="mt-24" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-3)' }}>{t('collectors.performance')}</h4>
          <div className="grid mt-8" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {/* `complaints` is a live count of this collector's open tickets. */}
            {[[t('collectors.perf.coverage'), percent(c.coverage || 0)], [t('collectors.perf.onTime'), percent(c.onTime || 0)], [t('collectors.perf.complaints'), n(c.complaints || 0)]].map(([l, v]) => (
              <div key={l} className="center" style={{ padding: '14px 8px', background: 'var(--surface-2)', borderRadius: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{v}</div><div className="tiny muted-3 mt-4">{l}</div>
              </div>
            ))}
          </div>
          <div className="row gap-8 mt-24">
            <button className="btn btn-primary grow" onClick={onEdit}><IconEdit size={15} /> {t('collectors.editReassign')}</button>
            {onAssignRoute && <button className="btn btn-ghost grow" onClick={onAssignRoute}><IconRoute size={15} /> {t('collectors.assignRoute')}</button>}
            {onTransfer && <button className="btn btn-ghost grow" onClick={onTransfer}>{t('collectors.transfer')}</button>}
            <button className="btn btn-ghost grow" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      </aside>
    </>
  )
}

// Moves a collector to another (active) agency as of a date. The server closes
// the old employment and opens the new one, so the history stays whole.
function TransferModal({ c, agencies, currentText, onClose, onSave }) {
  const { t, localName } = useLang()
  const [form, setForm] = useState({ agency: '', onDate: TODAY, note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(null) }
  const choices = pickableAgencies(agencies).filter((a) => a.id !== c.agency)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.agency) { setError({ detail: t('collectors.transferPickAgency') }); return }
    setBusy(true)
    const result = await onSave({ agency: form.agency, onDate: form.onDate || null, note: form.note.trim() })
    setBusy(false)
    if (result && !result.ok) setError(result.error)
  }

  return (
    <Modal title={t('collectors.transferTitle')} subtitle={c.name} onClose={onClose} width={460}>
      <form onSubmit={submit}>
        <div className="tiny muted" style={{ marginBottom: 8 }}>{t('collectors.transferFrom', { agency: currentText || t('collectors.noAgency') })}</div>
        <Field as="select" label={t('collectors.transferTo')} value={form.agency} onChange={set('agency')} disabled={busy}
          options={[{ value: '', label: t('collectors.chooseAgency') },
            ...choices.map((a) => ({ value: a.id, label: localName(a) }))]} />
        <FieldError>{error?.fieldError?.('agency')}</FieldError>
        <Field label={t('collectors.transferDate')} type="date" value={form.onDate} onChange={set('onDate')} disabled={busy} />
        <FieldError>{error?.fieldError?.('onDate')}</FieldError>
        <Field label={t('collectors.transferNote')} value={form.note} onChange={set('note')} disabled={busy} />
        {error?.detail && (
          <div className="form-note bad" style={{ marginTop: 12 }}>
            <IconAlert size={15} /><span>{error.detail}</span>
          </div>
        )}
        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : null} {t('collectors.transfer')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}
