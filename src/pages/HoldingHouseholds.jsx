import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader, StatCard, EmptyState } from '../components/ui.jsx'
import { ExportMenu } from '../components/ExportMenu.jsx'
import DataTable from '../components/DataTable.jsx'
import {
  HouseholdForm, HouseholdDrawer, TYPE_META, TODAY,
  underPayload, potentialPayload, addressFor,
} from '../components/HouseholdForm.jsx'
import { holdings as holdingsApi } from '../api/endpoints.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useData } from '../context/DataContext.jsx'
import { useLang } from '../i18n/index.jsx'
import { IconHome, IconPlus, IconEdit, IconEye, IconTrash, IconArrow } from '../components/Icons.jsx'

// The families inside one building.
//
// This replaces the old city-wide Households list. A household only means
// anything in relation to its building — the address, the pin and the round all
// belong to the holding — so the register is entered through the building
// rather than as one flat list of every family in Khulna.
//
// Both kinds of record live here, because both belong to a building:
//
//   under service  — a family giving waste to a collector, and being billed
//   potential      — a surveyed family not yet paying, with the survey answers
//                    kept until somebody brings them under service
//
// Bringing a potential customer under service is the one action that turns the
// second into the first, and it stays on this page because that decision is
// made while looking at the building.

// The building's address, read the way one is said aloud: the owner, then out
// from the road to the district. Missing parts are dropped rather than left as
// gaps — every holding registered before district and thana existed has neither,
// and "Owner · KDA Avenue · W-14 ·  · " reads as a bug.
function addressLine(holding) {
  return [
    holding.ownerName, holding.road, holding.ward, holding.thana, holding.district,
  ].filter(Boolean).join(' · ')
}

export default function HoldingHouseholds() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, n, taka, optLabel } = useLang()
  const { canWrite } = useAuth()
  const data = useData()
  const {
    collectors, create, update, remove, act, api, ready,
    tiers, customerTypes, holdingTypes, storageTypes, suitableTimes,
    paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices,
    wards, roadsByWard, tierCharge, effectiveCharge, collectorName,
  } = data

  const [holding, setHolding] = useState(null)
  const [families, setFamilies] = useState([])
  const [potentials, setPotentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [editing, setEditing] = useState(null)   // a family being added or changed
  const [viewing, setViewing] = useState(null)   // the detail drawer
  const [busy, setBusy] = useState(false)

  const lists = useMemo(() => ({
    wards, roadsByWard, tiers, customerTypes, holdingTypes, storageTypes,
    suitableTimes, paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices,
  }), [wards, roadsByWard, tiers, customerTypes, holdingTypes, storageTypes,
    suitableTimes, paymentModes, bloodGroups, potentialReasons, timeGaps, currentPractices])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [building, members, surveyed] = await Promise.all([
        holdingsApi.get(id),
        holdingsApi.households(id),
        api.potentialCustomers.list({ holding: id }),
      ])
      setHolding(building)
      setFamilies(Array.isArray(members) ? members : members.results || [])
      const rows = Array.isArray(surveyed) ? surveyed : surveyed.results || []
      setPotentials(rows.filter((row) => row.holding === id))
      setError('')
    } catch {
      setError(t('common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [id, api, t])

  useEffect(() => { if (ready) load() }, [ready, load])

  // One list, two kinds of row — the same shape the old page used, so the form
  // and the drawer read them unchanged.
  const rows = useMemo(() => [
    ...families.map((h) => ({ ...h, _type: 'under_service', _coll: 'households' })),
    ...potentials.map((p) => ({
      ...p, _type: 'potential', _coll: 'potentialCustomers',
      tier: p.estTier, dues: 0, status: 'potential', qr: null,
    })),
  ], [families, potentials])

  const stats = useMemo(() => ({
    total: rows.length,
    active: families.filter((h) => h.status === 'active').length,
    potential: potentials.length,
    dues: families.reduce((sum, h) => sum + (h.dues || 0), 0),
  }), [rows, families, potentials])

  async function save(form) {
    setBusy(true)
    const isPotential = form._type === 'potential'
    const collection = isPotential ? 'potentialCustomers' : 'households'
    const payload = isPotential ? potentialPayload(form) : underPayload(form)
    // The building is this page's, never the form's — a family added here
    // belongs to the building whose page it was added from.
    payload.holding = id
    const result = form.id
      ? await update(collection, form.id, payload)
      : await create(collection, payload)
    setBusy(false)
    if (result.ok) {
      setEditing(null)
      load()
      setNote({ tone: 'ok', text: t(form.id ? 'households.saved' : 'households.created') })
    }
    return result
  }

  async function removeRow(row) {
    setBusy(true)
    const result = await remove(row._coll, row.id)
    setBusy(false)
    if (result.ok) { load(); setNote({ tone: 'ok', text: t('households.removed') }) }
    else setNote({ tone: 'bad', text: result.error?.detail || t('common.requestFailed') })
  }

  // Conversion keeps the survey row (stamped converted) so the funnel report
  // still has its history.
  async function convert(row) {
    setBusy(true)
    const result = await act(api.potentialCustomers.convert(row.id, {}))
    setBusy(false)
    if (!result.ok) {
      setNote({ tone: 'bad', text: result.error?.detail || t('households.convertFailed') })
      return
    }
    load()
    setNote({
      tone: 'ok',
      text: t('households.convertDone', { name: row.head, id: result.data.household.id }),
    })
  }

  const columns = useMemo(() => [
    {
      accessorKey: 'unit',
      header: t('holdings.unit'),
      cell: ({ row }) => (
        <>
          <div style={{ fontWeight: 600 }}>{row.original.unit || '—'}</div>
          {row.original.floor && <div className="tiny muted-3">{row.original.floor}</div>}
        </>
      ),
    },
    {
      accessorKey: 'head',
      header: t('households.field.name'),
      cell: ({ row }) => (
        <>
          <div>{row.original.head}</div>
          {row.original.phone && <div className="tiny muted-3 mono">{row.original.phone}</div>}
        </>
      ),
    },
    {
      accessorKey: '_type',
      header: t('households.col.type'),
      cell: ({ row }) => (
        <span className={`badge ${TYPE_META[row.original._type].badge}`}>
          <span className="dot" />{t(TYPE_META[row.original._type].key)}
        </span>
      ),
    },
    {
      accessorKey: 'tier',
      header: t('households.field.tier'),
      cell: ({ row }) => optLabel(tiers, row.original.tier),
    },
    {
      accessorKey: 'dues',
      header: t('households.field.duesOutstanding'),
      cell: ({ row }) => (row.original._type === 'potential'
        ? <span className="tiny muted">—</span>
        : <span style={{ color: row.original.dues ? 'var(--danger-fg)' : undefined, fontWeight: row.original.dues ? 600 : 400 }}>
            {taka(row.original.dues || 0)}
          </span>),
    },
    {
      accessorKey: 'status',
      header: t('households.field.status'),
      cell: ({ row }) => t(`status.${row.original.status}`),
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { stopClick: true },
      cell: ({ row }) => (
        <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="act-btn" title={t('common.view')}
            onClick={() => setViewing(row.original)}>
            <IconEye size={16} />
          </button>
          {canWrite && row.original._type === 'potential' && (
            <button type="button" className="act-btn" title={t('households.bringUnderService')}
              style={{ color: 'var(--brand)' }} disabled={busy}
              onClick={() => convert(row.original)}>
              <IconArrow size={16} />
            </button>
          )}
          {canWrite && (
            <button type="button" className="act-btn" title={t('common.edit')}
              onClick={() => setEditing(row.original)}>
              <IconEdit size={16} />
            </button>
          )}
          {canWrite && (
            <button type="button" className="act-btn" title={t('common.delete')} disabled={busy}
              onClick={() => removeRow(row.original)}>
              <IconTrash size={16} />
            </button>
          )}
        </div>
      ),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, taka, optLabel, tiers, canWrite, busy])

  const exportColumns = [
    { key: 'id', label: t('households.col.id') },
    { key: 'unit', label: t('holdings.unit') },
    { key: 'head', label: t('households.field.name') },
    { key: 'phone', label: t('households.field.phone') },
    { key: '_type', label: t('households.col.type') },
    { key: 'tier', label: t('households.field.tier') },
    { key: 'dues', label: t('households.field.duesOutstanding') },
    { key: 'status', label: t('households.field.status') },
  ]

  if (loading && !holding) {
    return <div className="fade-in"><PageHeader title={t('households.title')} /></div>
  }

  return (
    <div className="fade-in">
      <PageHeader
        title={holding ? t('holdings.householdsTitle', { holding: holding.holdingNo }) : t('households.title')}
        subtitle={holding ? addressLine(holding) : undefined}
        actions={<>
          <button type="button" className="btn" onClick={() => navigate('/app/holdings')}>
            {t('holdings.editor.backToList')}
          </button>
          <ExportMenu
            title={t('holdings.householdsTitle', { holding: holding?.holdingNo || id })}
            subtitle={t('common.records', { count: n(rows.length) })}
            columns={exportColumns}
            rows={rows}
            filename={`holding-${id}-households`}
          />
          {canWrite && (
            <button className="btn btn-primary" onClick={() => setEditing({
              _type: 'under_service',
              holding: id,
              _holdingRow: holding,
              address: holding ? addressFor(holding, '') : '',
              head: '', phone: '', unit: '', status: 'active', dues: 0,
              surveyedAt: TODAY,
            })}>
              <IconPlus size={16} /> {t('holdings.addFamily')}
            </button>
          )}
        </>}
      />

      <div className="stat-grid">
        <StatCard icon={<IconHome size={18} />} label={t('holdings.stat.families')}
          value={n(stats.total)} sub={t('holdings.householdsInThisBuilding')} />
        <StatCard icon={<IconHome size={18} />} tone="ok" label={t('holdings.underServiceLabel')}
          value={n(stats.active)} sub={t('holdings.stat.servedSub')} />
        <StatCard icon={<IconHome size={18} />} tone="info" label={t('holdings.potentialLabel')}
          value={n(stats.potential)} sub={t('holdings.potentialSub')} />
        <StatCard icon={<IconHome size={18} />} tone={stats.dues ? 'warn' : 'ok'}
          label={t('households.field.duesOutstanding')} value={taka(stats.dues)}
          sub={t('holdings.duesSub')} />
      </div>

      {error && <div className="app-banner error" role="alert">{error}</div>}
      {note && (
        <div className={`app-banner${note.tone === 'bad' ? ' error' : ' info'}`} role="status">
          <span className="grow">{note.text}</span>
          <button className="icon-btn" onClick={() => setNote(null)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          searchPlaceholder={t('holdings.searchFamilies')}
          empty={<EmptyState>{t('holdings.noFamilies')}</EmptyState>}
          rowKey={(row) => `${row._coll}-${row.id}`}
        />
      </div>

      {editing && (
        <HouseholdForm
          initial={editing}
          holding={holding}
          collectors={collectors}
          lists={lists}
          tierCharge={tierCharge}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {viewing && (
        <HouseholdDrawer
          hh={viewing}
          collectorName={collectorName}
          lists={lists}
          tierCharge={tierCharge}
          effectiveCharge={effectiveCharge}
          busy={busy}
          onClose={() => setViewing(null)}
          onEdit={canWrite ? () => { setEditing(viewing); setViewing(null) } : null}
          onConvert={canWrite ? () => { convert(viewing); setViewing(null) } : null}
        />
      )}
    </div>
  )
}
