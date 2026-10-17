import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import DataTable from '../components/DataTable.jsx'
import { Modal, Field, FormRow, FormSection, ModalActions } from '../components/Modal.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import { holdings as api } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import VerifyLocationModal from '../components/VerifyLocationModal.jsx'
import {
  IconHome, IconPlus, IconCheck, IconAlert, IconMap, IconClipboard, IconDownload,
} from '../components/Icons.jsx'

// Derived server-side from the households on each holding, so it cannot go
// stale the way a stored column would.
const SERVICE_TONES = { full: 'ok', partial: 'warn', none: 'muted' }

// A building is only routable once someone has confirmed where it actually is.
// Until then it has no coordinates at all — never a placeholder, because a
// made-up point is worse than a blank one: it looks planned and sends a
// collector to the wrong lane.
//
// Confirming a pin is a dedicated server action (POST …/holdings/{id}/verify/),
// not a field write: the server stamps who verified it and when, and refuses a
// coordinate outside Bangladesh.
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

export default function Holdings() {
  const { t, n, taka } = useLang()
  const { canWrite, user, isAdmin } = useAuth()
  const [importing, setImporting] = useState(false)
  const { catalog } = useData()
  const navigate = useNavigate()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ward, setWard] = useState('')
  const [service, setService] = useState('')

  // --- pin verification, which belongs to the building ------------------- //
  // A GPS reading in a narrow lane is a claim, not a fact — so it is shown to
  // whoever is standing there and only written once they confirm it. Pinning
  // once here makes every household in the building routable at a stroke.
  const [verifying, setVerifying] = useState(null) // holding under review
  const [locating, setLocating] = useState(false)  // a GPS read is in flight
  const [saving, setSaving] = useState(false)
  const [geoError, setGeoError] = useState(null)
  const [fix, setFix] = useState(null)
  const captureToken = useRef(0)                   // drops readings from an abandoned capture

  const readPosition = useCallback(async () => {
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
  }, [t, n])

  function openVerify(row) {
    setVerifying(row); setFix(null); setGeoError(null)
    readPosition()
  }

  function closeVerify() {
    captureToken.current += 1 // orphan any reading still in flight
    setVerifying(null); setFix(null); setGeoError(null); setLocating(false)
  }

  async function commitVerification({ lat, lng, accuracy, placedByHand }) {
    if (!verifying || saving) return
    setSaving(true)
    setGeoError(null)
    try {
      await api.verify(verifying.id, { lat, lng, accuracy, placedByHand })
      closeVerify()
      load()
    } catch (err) {
      // A pin outside Bangladesh comes back as a field error on lat or lng.
      setGeoError(err?.fieldError?.('lat') || err?.fieldError?.('lng') || err?.detail || t('holdings.verifyFailed'))
    } finally {
      setSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.list({ ward: ward || undefined, serviceStatus: service || undefined })
      setRows(Array.isArray(data) ? data : data.results || [])
      setError('')
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [ward, service, t])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    const total = rows.length
    const served = rows.filter((r) => r.serviceStatus !== 'none').length
    const unverified = rows.filter((r) => !r.verified).length
    const families = rows.reduce((sum, r) => sum + (r.householdCount || 0), 0)
    return { total, served, unverified, families }
  }, [rows])

  // The register is a DataTable now: sorting, paging and the whole-list search
  // come from TanStack, so this page only says what a column *is*.
  const columns = useMemo(() => [
    {
      accessorKey: 'holdingNo',
      header: t('holdings.col.holdingNo'),
      cell: ({ row }) => (
        <>
          <div style={{ fontWeight: 600 }}>{row.original.holdingNo}</div>
          {row.original.collectionPoint && (
            <div className="tiny muted-3">{t(`holdings.collectionPoint.${row.original.collectionPoint}`)}</div>
          )}
        </>
      ),
    },
    {
      id: 'geo',
      // One column, not two: they are a single address line read top down, and
      // splitting them would push the register past the width it fits in. The
      // accessor is both names joined so the whole-table search finds a holding
      // by its thana, not only by its district, and sorting groups by district.
      accessorFn: (row) => [row.district, row.thana].filter(Boolean).join(' '),
      header: t('holdings.col.district'),
      cell: ({ row }) => (row.original.district
        ? (
          <>
            <div>{row.original.district}</div>
            {row.original.thana && <div className="tiny muted-3">{row.original.thana}</div>}
          </>
        )
        // Registered before the fields existed, and nothing in the data says
        // which district a ward is in — so it is blank rather than guessed.
        : <span className="muted-3">—</span>),
    },
    { accessorKey: 'ward', header: t('holdings.col.ward') },
    {
      accessorKey: 'road',
      header: t('holdings.col.road'),
      cell: ({ row }) => (
        <>
          <div>{row.original.road}</div>
          {row.original.lane && <div className="tiny muted-3">{row.original.lane}</div>}
        </>
      ),
    },
    {
      accessorKey: 'ownerName',
      header: t('holdings.col.owner'),
      cell: ({ row }) => (
        <>
          <div>{row.original.ownerName}</div>
          {row.original.ownerRole && row.original.ownerRole !== 'owner' && (
            <div className="tiny muted-3">{t(`holdings.ownerRole.${row.original.ownerRole}`)}</div>
          )}
          {row.original.ownerPhone && (
            <div className="tiny muted-3 mono">{row.original.ownerPhone}</div>
          )}
        </>
      ),
    },
    {
      accessorKey: 'householdCount',
      header: t('holdings.col.households'),
      cell: ({ row }) => {
        // The dictionary has no plural rules, so the two cases are two keys.
        const count = row.original.householdCount || 0
        const label = count === 1
          ? t('holdings.familyCountOne')
          : t('holdings.familyCount', { count: n(count) })
        const units = row.original.unitsTotal
        if (units == null) return label
        // Households must equal units — show both, amber until they do.
        return (
          <span className="row gap-8">
            {label}
            <span className={`badge ${row.original.unitsMatch ? 'badge-ok' : 'badge-warn'}`}
              title={row.original.unitsMatch ? t('holdings.units.match') : t('holdings.units.mismatch')}>
              {t('holdings.units.ofUnits', { active: n(row.original.activeHouseholdCount || 0), units: n(units) })}
            </span>
          </span>
        )
      },
    },
    {
      // The service charge and the dues are the building's: one bill a month.
      accessorKey: 'effectiveCharge',
      header: t('holdings.col.charge'),
      cell: ({ row }) => (row.original.effectiveCharge
        ? <span>{taka(row.original.effectiveCharge)}<span className="tiny muted-3">{t('common.perMonth')}</span></span>
        : <span className="tiny muted">—</span>),
    },
    {
      accessorKey: 'dues',
      header: t('households.field.duesOutstanding'),
      cell: ({ row }) => (
        <span style={{ color: row.original.dues ? 'var(--danger-fg)' : undefined, fontWeight: row.original.dues ? 600 : 400 }}>
          {taka(row.original.dues || 0)}
        </span>
      ),
    },
    {
      accessorKey: 'serviceStatus',
      header: t('holdings.col.service'),
      cell: ({ row }) => (
        <span className={`badge badge-${SERVICE_TONES[row.original.serviceStatus] || 'muted'}`}>
          <span className="dot" />{t(`holdings.service.${row.original.serviceStatus}`)}
        </span>
      ),
    },
    {
      accessorKey: 'verified',
      header: t('holdings.col.located'),
      cell: ({ row }) => (row.original.verified
        ? <span className="badge badge-ok"><span className="dot" />{t('holdings.located')}</span>
        : <span className="badge badge-warn"><span className="dot" />{t('holdings.notLocated')}</span>),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      // The buttons here are their own targets; without this the row's own
      // click would fire too and navigate away mid-action.
      meta: { stopClick: true },
      cell: ({ row }) => (
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          {canWrite && (
            <button type="button" className="icon-btn" title={t('holdings.verify')}
              onClick={() => openVerify(row.original)}>
              <IconMap size={16} />
            </button>
          )}
          {/* Survey this building. The id travels in the URL so the form knows
              which premises it is about — it fills the address in and the
              survey keeps the reference, which is what stops conversion
              registering a second copy of a building already on the list.
              A survey started from Surveys instead carries no reference, and
              that is the ordinary case: the point of surveying is finding the
              doors nobody has on record. */}
          {canWrite && (
            <button type="button" className="icon-btn" title={t('holdings.surveyThis')}
              onClick={() => navigate(`/app/surveys/new?holding=${row.original.id}`)}>
              <IconClipboard size={16} />
            </button>
          )}
          {canWrite && (
            <button type="button" className="link-btn"
              onClick={() => navigate(`/app/holdings/${row.original.id}/edit`)}>
              {t('common.edit')}
            </button>
          )}
        </div>
      ),
    },
  ], [t, n, taka, canWrite, navigate])

  const exportColumns = [
    { key: 'id', label: t('holdings.col.id') },
    { key: 'holdingNo', label: t('holdings.col.holdingNo') },
    // Separate columns in an export, unlike on screen: a spreadsheet is filtered
    // and pivoted on one field at a time.
    { key: 'district', label: t('holdings.col.district') },
    { key: 'thana', label: t('holdings.col.thana') },
    { key: 'road', label: t('holdings.col.road') },
    { key: 'lane', label: t('holdings.lane') },
    { key: 'ward', label: t('holdings.col.ward') },
    { key: 'ownerName', label: t('holdings.col.owner') },
    { key: 'ownerPhone', label: t('holdings.col.phone') },
    { key: 'householdCount', label: t('holdings.col.households') },
    { key: 'qr', label: t('holdings.qr') },
    { key: 'effectiveCharge', label: t('holdings.col.charge') },
    { key: 'dues', label: t('households.field.duesOutstanding') },
    { key: 'serviceStatus', label: t('holdings.col.service') },
  ]

  return (
    <div className="fade-in">
      <PageHeader
        title={t('holdings.title')}
        subtitle={t('holdings.subtitle', { count: n(stats.total), families: n(stats.families) })}
        actions={<>
          <ExportMenu
            title={t('holdings.title')}
            subtitle={t('common.records', { count: n(rows.length) })}
            columns={exportColumns}
            rows={rows}
            filename="holdings"
          />
          {/* Bulk upload is an administrator's job: it can create a city's
              whole register in one go. */}
          {isAdmin && (
            <button className="btn" onClick={() => setImporting(true)}>
              <IconDownload size={16} style={{ transform: 'rotate(180deg)' }} /> {t('holdings.import.button')}
            </button>
          )}
          {canWrite && (
            <button className="btn btn-primary" onClick={() => navigate('/app/holdings/new')}>
              <IconPlus size={16} /> {t('holdings.register')}
            </button>
          )}
        </>}
      />
      {importing && (
        <ImportModal onClose={() => setImporting(false)} onDone={() => { setImporting(false); load() }} />
      )}

      <div className="stat-grid">
        <StatCard icon={<IconHome size={18} />} label={t('holdings.stat.total')} value={n(stats.total)} sub={t('holdings.stat.totalSub')} />
        <StatCard icon={<IconCheck size={18} />} label={t('holdings.stat.served')} value={n(stats.served)} sub={t('holdings.stat.servedSub')} tone="ok" />
        <StatCard icon={<IconAlert size={18} />} label={t('holdings.stat.unverified')} value={n(stats.unverified)} sub={t('holdings.stat.unverifiedSub')} tone="warn" />
        <StatCard icon={<IconHome size={18} />} label={t('holdings.stat.families')} value={n(stats.families)} sub={t('holdings.stat.familiesSub')} />
      </div>

      {/* Same toolbar + full-width card the Households page uses, so the two
          registers read as one screen rather than two different products. */}
      <div className="row gap-8 wrap" style={{ margin: '18px 0 12px' }}>
        <div className="seg">
          {[
            ['', t('holdings.filter.all', { count: n(stats.total) })],
            ['full', t('holdings.service.full')],
            ['partial', t('holdings.service.partial')],
            ['none', t('holdings.service.none')],
          ].map(([k, l]) => (
            <button key={k || 'all'} type="button" className={service === k ? 'on' : ''} onClick={() => setService(k)}>{l}</button>
          ))}
        </div>
        <select className="select" style={{ width: 'auto' }} value={ward} onChange={(e) => setWard(e.target.value)}>
          <option value="">{t('holdings.allWards')}</option>
          {(catalog?.wards || []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder={t('holdings.searchPlaceholder')}
        empty={<EmptyState>{t('holdings.empty')}</EmptyState>}
        // A building's families are a page of their own now, so the row opens
        // it rather than expanding in place.
        onRowClick={(row) => navigate(`/app/holdings/${row.id}/households`)}
      />

      {verifying && (
        <VerifyLocationModal
          // The modal was written against a household. A holding carries the
          // same facts under different names, so it is adapted here rather than
          // teaching the shared component about two shapes.
          household={{
            ...verifying,
            head: verifying.ownerName,
            holding: verifying.holdingNo,
          }}
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

    </div>
  )
}

export function HoldingForm({ holding, catalog, onClose, onSaved }) {
  const { t } = useLang()
  const isNew = !holding?.id
  const [form, setForm] = useState({
    ward: holding?.ward || '',
    road: holding?.road || '',
    holdingNo: holding?.holdingNo || '',
    ownerName: holding?.ownerName || '',
    ownerPhone: holding?.ownerPhone || '',
    floors: holding?.floors ?? '',
    unitsTotal: holding?.unitsTotal ?? '',
    notes: holding?.notes || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError('') }
  // The catalog serves roads as `roadsByWard` — ward id to a list of road
  // *names* — which is the shape the Households form has always used. Reading
  // a `catalog.roads` array that the bundle never contained left this dropdown
  // permanently empty, and a road is required, so no holding could be created
  // from this form at all.
  const roads = catalog?.roadsByWard?.[form.ward] || []

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.ward) { setError(t('holdings.wardRequired')); return }
    if (!form.road) { setError(t('holdings.roadRequired')); return }
    if (!form.holdingNo.trim()) { setError(t('holdings.holdingNoRequired')); return }
    if (!form.ownerName.trim()) { setError(t('holdings.ownerRequired')); return }

    const body = {
      ...form,
      floors: form.floors === '' ? null : Number(form.floors),
      unitsTotal: form.unitsTotal === '' ? null : Number(form.unitsTotal),
      // Made while registering a customer into it, so its flats are registered.
      ...(isNew ? { collectionPoint: 'floor' } : {}),
    }
    setBusy(true)
    try {
      const saved = isNew ? await api.create(body) : await api.update(holding.id, body)
      onSaved(saved)
    } catch (err) {
      // The server owns the uniqueness rule; surface what it says rather than
      // guessing, so a duplicate address reads as a duplicate address.
      setError(err?.fieldError?.('holdingNo') || err?.detail || t('common.requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={isNew ? t('holdings.formNew') : t('holdings.formEdit')}
      subtitle={t('holdings.formHint')}
      onClose={onClose}
      width={620}
    >
      <form onSubmit={submit}>
        <FormSection title={t('holdings.group.address')} first>
          <FormRow>
            <Field half as="select" label={t('holdings.col.ward')} value={form.ward} onChange={set('ward')}
              options={[{ value: '', label: '—' }, ...(catalog?.wards || []).map((w) => ({ value: w.id, label: w.name }))]} />
            <Field half as="select" label={t('holdings.col.road')} value={form.road} onChange={set('road')}
              options={[{ value: '', label: '—' }, ...roads.map((name) => ({ value: name, label: name }))]} />
          </FormRow>
          <FormRow>
            <Field half label={t('holdings.col.holdingNo')} value={form.holdingNo} onChange={set('holdingNo')} placeholder="142/B" />
          </FormRow>
          <FormRow>
            <Field half label={t('holdings.floors')} type="number" min="0" value={form.floors} onChange={set('floors')} />
            <Field half label={t('holdings.unitsTotal')} type="number" min="0" value={form.unitsTotal} onChange={set('unitsTotal')}
              hint={t('holdings.unitsHint')} />
          </FormRow>
        </FormSection>

        <FormSection title={t('holdings.group.owner')}>
          <FormRow>
            <Field half label={t('holdings.ownerName')} value={form.ownerName} onChange={set('ownerName')} />
            <Field half label={t('holdings.ownerPhone')} value={form.ownerPhone} onChange={set('ownerPhone')} placeholder="01XXXXXXXXX" />
          </FormRow>
          <Field as="textarea" label={t('holdings.notes')} value={form.notes} onChange={set('notes')} />
        </FormSection>

        {error && <div className="form-note bad">{error}</div>}

        <ModalActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : isNew ? t('holdings.register') : t('common.saveChanges')}
          </button>
        </ModalActions>
      </form>
    </Modal>
  )
}

// Bulk upload: pick a file, preview every row, then import the valid ones.
// Nothing is written until the operator has seen the preview and confirmed.
function ImportModal({ onClose, onDone }) {
  const { t, n } = useLang()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(commit) {
    if (!file) { setError(t('holdings.import.chooseFile')); return }
    setBusy(true)
    setError('')
    try {
      const data = await api.importFile(file, commit)
      if (commit) setResult(data)
      else setPreview(data)
    } catch (err) {
      setError(err?.detail || t('common.requestFailed'))
    } finally {
      setBusy(false)
    }
  }

  const summary = (result || preview)?.summary
  const rows = (result || preview)?.rows || []
  const bad = rows.filter((r) => r.status === 'error')

  return (
    <Modal title={t('holdings.import.title')} subtitle={t('holdings.import.subtitle')} onClose={onClose} width={760}>
      {!result && (
        <>
          <div className="row gap-8 wrap" style={{ alignItems: 'center' }}>
            <input type="file" accept=".xlsx,.csv" disabled={busy}
              aria-label={t('holdings.import.file')}
              onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setError('') }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.importTemplate()}>
              <IconDownload size={14} /> {t('holdings.import.template')}
            </button>
          </div>
          <div className="tiny muted-3 mt-8">{t('holdings.import.columns')}</div>
        </>
      )}

      {error && <div className="app-banner error mt-16" role="alert">{error}</div>}

      {summary && (
        <div className="row gap-8 wrap mt-16">
          <span className="badge badge-muted">{t('holdings.import.total', { count: n(summary.total) })}</span>
          <span className="badge badge-ok">{t('holdings.import.valid', { count: n(summary.valid) })}</span>
          {summary.invalid > 0 && <span className="badge badge-danger">{t('holdings.import.invalid', { count: n(summary.invalid) })}</span>}
          {result
            ? <span className="badge badge-info">{t('holdings.import.done', { created: n(summary.created), updated: n(summary.updated) })}</span>
            : <span className="badge badge-info">{t('holdings.import.plan', { create: n(summary.toCreate), update: n(summary.toUpdate) })}</span>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap mt-16" style={{ maxHeight: 320, overflow: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('holdings.import.col.row')}</th>
                <th>{t('holdings.col.holdingNo')}</th>
                <th>{t('holdings.col.owner')}</th>
                <th>{t('holdings.col.ward')}</th>
                <th>{t('holdings.import.col.result')}</th>
              </tr>
            </thead>
            <tbody>
              {(bad.length ? [...bad, ...rows.filter((r) => r.status !== 'error')] : rows).map((r) => (
                <tr key={r.row}>
                  <td className="mono">{n(r.row)}</td>
                  <td className="mono">{r.holdingNo || '—'}</td>
                  <td>{r.name || '—'}</td>
                  <td className="mono">{r.ward || '—'}</td>
                  <td className="small">
                    {r.status === 'error'
                      ? <span style={{ color: 'var(--danger)' }}>{r.errors.join(' ')}</span>
                      : <>
                          <span className={`badge ${r.action === 'update' ? 'badge-info' : 'badge-ok'}`}>
                            {t(`holdings.import.action.${r.action}`)}
                          </span>
                          {r.warnings.length > 0 && <div className="tiny muted-3">{r.warnings.join(' ')}</div>}
                        </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalActions>
        {result ? (
          <button type="button" className="btn btn-primary" onClick={onDone}>{t('holdings.import.close')}</button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
            {!preview ? (
              <button type="button" className="btn btn-primary" onClick={() => run(false)} disabled={busy || !file}>
                {busy ? <span className="spinner" /> : t('holdings.import.check')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => run(true)}
                disabled={busy || !preview.summary.valid}>
                {busy ? <span className="spinner" /> : t('holdings.import.confirm', { count: n(preview.summary.valid) })}
              </button>
            )}
          </>
        )}
      </ModalActions>
    </Modal>
  )
}
