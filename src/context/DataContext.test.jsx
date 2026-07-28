import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { DataProvider, useData } from './DataContext.jsx'

// The store is now a mirror of the server, so the endpoint module is what gets
// stubbed. Each resource needs `list` (loaded on mount) plus whichever writes the
// test exercises.
const RESOURCES = [
  'households', 'potentialCustomers', 'collectors', 'routes', 'assignments',
  'vans', 'complaints', 'bills', 'payments', 'deposits', 'visits',
  'maintenance', 'fuelLogs',
]

vi.mock('../api/endpoints.js', () => {
  const resources = {}
  const RESOURCE_NAMES = [
    'households', 'potentialCustomers', 'collectors', 'routes', 'assignments',
    'vans', 'complaints', 'bills', 'payments', 'deposits', 'visits',
    'maintenance', 'fuelLogs',
  ]
  RESOURCE_NAMES.forEach((name) => {
    resources[name] = {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    }
  })
  // `bills` deliberately has no generic writes: a bill comes from a billing run.
  delete resources.bills.create
  delete resources.bills.remove
  return {
    ...resources,
    RESOURCES: Object.fromEntries(RESOURCE_NAMES.map((name) => [name, `/${name}/`])),
    catalog: { load: vi.fn(async () => ({})) },
  }
})

// The returned object must be referentially stable. In the real provider `user`
// is state, so it only changes when the session does; a fresh object per render
// would re-trigger the load effect on every render.
vi.mock('./AuthContext.jsx', () => {
  const session = { user: { id: 1, roleKey: 'agency_admin' }, ready: true }
  return { useAuth: () => session }
})

const api = await import('../api/endpoints.js')

const CATALOG = {
  zones: [{ id: 'Z-03', key: 'opt.zone.Z-03', name: 'Sonadanga' }],
  wards: [{ id: 'W-14', key: 'opt.ward.W-14', name: 'Ward 14 — Sonadanga', zone: 'Z-03' }],
  roadsByWard: { 'W-14': ['KDA Avenue', 'Majid Sarani'] },
  tiers: [
    { id: 'residential_standard', key: 'opt.tier.residential_standard', label: 'Residential — standard', charge: 100 },
    { id: 'commercial_small', key: 'opt.tier.commercial_small', label: 'Commercial — small', charge: 250 },
  ],
  paymentModes: [{ id: 'cash', key: 'opt.mode.cash', label: 'Cash' }],
  bloodGroups: ['A+', 'B+'],
}

const HOUSEHOLD = {
  id: 'HH-KCC-0012840', head: 'Abdul Karim', ward: 'W-14', road: 'KDA Avenue',
  holding: '142/B', tier: 'residential_standard', charge: 0, dues: 0, status: 'active',
}

async function setupReady() {
  const hook = renderHook(() => useData(), { wrapper: DataProvider })
  await waitFor(() => expect(hook.result.current.ready).toBe(true))
  return hook
}

beforeEach(() => {
  vi.clearAllMocks()
  api.catalog.load.mockResolvedValue(CATALOG)
  RESOURCES.forEach((name) => { api[name].list.mockResolvedValue([]) })
})

describe('loading', () => {
  it('fetches the catalog and every collection once signed in', async () => {
    api.households.list.mockResolvedValueOnce([HOUSEHOLD])
    const { result } = await setupReady()

    expect(api.catalog.load).toHaveBeenCalledTimes(1)
    RESOURCES.forEach((name) => expect(api[name].list).toHaveBeenCalledTimes(1))
    expect(result.current.households).toEqual([HOUSEHOLD])
    expect(result.current.collectors).toEqual([])
  })

  it('still becomes ready when a request fails, and reports the error', async () => {
    const failure = Object.assign(new Error('boom'), { detail: 'Server unavailable' })
    api.households.list.mockRejectedValueOnce(failure)
    const { result } = await setupReady()
    expect(result.current.lastError).toBe(failure)
  })
})

describe('reference data', () => {
  it('exposes the catalog lists and label helpers', async () => {
    const { result } = await setupReady()
    expect(result.current.wards).toHaveLength(1)
    expect(result.current.tierLabel('residential_standard')).toBe('Residential — standard')
    expect(result.current.tierCharge('commercial_small')).toBe(250)
    expect(result.current.wardShort('W-14')).toBe('Ward 14')
    expect(result.current.allRoads).toEqual(['KDA Avenue', 'Majid Sarani'])
  })

  // A negotiated charge overrides the tier's standard charge.
  it('effectiveCharge prefers a negotiated amount over the tier', async () => {
    const { result } = await setupReady()
    expect(result.current.effectiveCharge({ tier: 'residential_standard', charge: 0 })).toBe(100)
    expect(result.current.effectiveCharge({ tier: 'residential_standard', charge: 150 })).toBe(150)
    // Potential customers carry `estTier` rather than `tier`.
    expect(result.current.effectiveCharge({ estTier: 'commercial_small' })).toBe(250)
  })
})

describe('writes', () => {
  it('creates without sending a browser-generated id', async () => {
    const { result } = await setupReady()
    api.households.create.mockResolvedValueOnce(HOUSEHOLD)

    let response
    await act(async () => {
      response = await result.current.upsert('households', { id: 'HH-draft-1', head: 'Abdul Karim' })
    })

    expect(response.ok).toBe(true)
    expect(api.households.create).toHaveBeenCalledWith({ head: 'Abdul Karim' })
    expect(result.current.households).toEqual([HOUSEHOLD])
  })

  it('updates a record it already knows about', async () => {
    api.households.list.mockResolvedValueOnce([HOUSEHOLD])
    const { result } = await setupReady()
    api.households.update.mockResolvedValueOnce({ ...HOUSEHOLD, head: 'Karim Uddin' })

    await act(async () => {
      await result.current.upsert('households', { ...HOUSEHOLD, head: 'Karim Uddin' })
    })

    expect(api.households.update).toHaveBeenCalledWith('HH-KCC-0012840', expect.objectContaining({ head: 'Karim Uddin' }))
    expect(result.current.households[0].head).toBe('Karim Uddin')
  })

  // A failed write must not throw: pages call these without awaiting in places,
  // and an unhandled rejection there would take out the view.
  it('reports a failure instead of throwing', async () => {
    const { result } = await setupReady()
    const failure = Object.assign(new Error('nope'), { detail: 'Road is unknown in Ward 14.' })
    api.households.create.mockRejectedValueOnce(failure)

    let response
    await act(async () => { response = await result.current.create('households', { head: 'X' }) })
    expect(response).toEqual({ ok: false, data: null, error: failure })
    expect(result.current.lastError).toBe(failure)
  })

  it('explains that a resource has no generic write rather than crashing', async () => {
    const { result } = await setupReady()
    let response
    await act(async () => { response = await result.current.create('bills', { hh: 'HH-1' }) })
    expect(response.ok).toBe(false)
    expect(response.error.code).toBe('unsupported')
  })

  it('refetches what a delete could have cascaded to', async () => {
    api.households.list.mockResolvedValue([HOUSEHOLD])
    const { result } = await setupReady()
    api.households.remove.mockResolvedValueOnce(null)
    api.households.list.mockResolvedValue([])

    await act(async () => { await result.current.remove('households', HOUSEHOLD.id) })

    expect(api.households.remove).toHaveBeenCalledWith(HOUSEHOLD.id)
    // The server cascade also touches routes, visits, bills, payments and complaints.
    expect(api.routes.list).toHaveBeenCalledTimes(2)
    expect(api.visits.list).toHaveBeenCalledTimes(2)
    expect(result.current.households).toEqual([])
  })
})

describe('lookups', () => {
  it('resolves names and records from loaded state', async () => {
    api.collectors.list.mockResolvedValueOnce([{ id: 'C-042', name: 'Rafiqul Islam' }])
    api.vans.list.mockResolvedValueOnce([{ id: 'VAN-KCC-017', driver: 'C-042' }])
    api.households.list.mockResolvedValueOnce([HOUSEHOLD])
    const { result } = await setupReady()

    expect(result.current.collectorName('C-042')).toBe('Rafiqul Islam')
    expect(result.current.collectorName('C-999')).toBe('C-999')
    expect(result.current.vanForDriver('C-042').id).toBe('VAN-KCC-017')
    expect(result.current.householdById(HOUSEHOLD.id).head).toBe('Abdul Karim')
  })
})
