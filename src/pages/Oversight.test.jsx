import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Oversight from './Oversight.jsx'

// The City Oversight page: each tab draws what its endpoint returns, the
// service trend shows each group's latest period by default, and the city
// picker in the header is sent to every tab.

const oversight = vi.fn()
const trend = vi.fn()
const collection = vi.fn()

// One frozen object, as the real context hands out: a fresh `api` per render
// would make every load effect fire again, forever.
const API = {
      reports: {
        oversight: (...a) => oversight(...a),
        serviceTrend: { load: (...a) => trend(...a), export: vi.fn() },
        complaintPerformance: { load: vi.fn(() => Promise.resolve({ rows: [], nature: [] })), export: vi.fn() },
        complaintsOverdue: { load: vi.fn(() => Promise.resolve({ rows: [] })), export: vi.fn() },
        register: () => ({ load: vi.fn(() => Promise.resolve({ rows: [] })), export: vi.fn() }),
        agencyTargets: { load: vi.fn(() => Promise.resolve({ rows: [] })), export: vi.fn() },
        cityCollection: { load: (...a) => collection(...a), export: vi.fn() },
        kpis: vi.fn(() => new Promise(() => {})),
      },
}
vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ api: API }) }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ isAdmin: true, isSuperAdmin: true }) }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  percent: (v) => `${v}%`,
  date: (v) => String(v),
  period: (v) => String(v),
  digits: (v) => String(v),
  wardName: (v) => v,
  lang: 'en',
}

const page = (url = '/app/city-dashboard') => render(<MemoryRouter initialEntries={[url]}><Oversight /></MemoryRouter>)
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

describe('Oversight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oversight.mockResolvedValue({
      period: '2026-11', served: 90, servedBefore: 80, registered: 100, servedPct: 90,
      change: 10, changePct: 12.5, trend: 'up', target: 120, targetServed: 90, targetPct: 75,
      complaintsOpen: 4, complaintsOverdue: 1, slaPct: 80, collectorsActive: 10,
      collectorsCheckedIn: 8, vansTotal: 5, vansActive: 4,
      league: [{ agency: 'AGN-1', name: 'Green Co', registered: 100, served: 90, servedPct: 90, trend: 'up', complaints: 3, slaPct: 80, per100: 3, collectedPct: 95, missed: 2 }],
      pickupToday: { date: '2026-11-24', due: 50, confirmed: 30, auto: 0, pending: 20, complaints: 1, closed: false, cutoff: '21:00' },
      city: { id: 'KCC', name: 'Khulna' },
      cities: [{ id: 'KCC', name: 'Khulna' }, { id: 'SCC', name: 'Sylhet' }],
    })
    collection.mockResolvedValue({
      city: { id: 'KCC', name: 'Khulna', cutoff: '21:00', complaintDeadline: '23:00' },
      today: { date: '2026-11-24', closed: false, cutoff: '21:00', due: 50, confirmed: 30, auto: 0, pending: 20, complaints: 1 },
      totals: { due: 100, collected: 90, collectedPct: 90, confirmed: 80, confirmedPct: 80, auto: 10, missed: 10, missedPct: 10 },
      rows: [], byAgency: [], byWard: [{ ward: 'W-01', wardName: 'Ward 1', due: 10, confirmed: 8, auto: 1, missed: 1, collectedPct: 90, confirmedPct: 80 }],
    })
    trend.mockResolvedValue({
      rows: [
        { group: 'AGN-1', name: 'Green Co', period: '2026-10', registered: 100, served: 80, servedPct: 80, new: 0, dropped: 0, change: null, changePct: null, trend: 'flat' },
        { group: 'AGN-1', name: 'Green Co', period: '2026-11', registered: 100, served: 90, servedPct: 90, new: 2, dropped: 1, change: 10, changePct: 12.5, trend: 'up' },
      ],
    })
  })

  it('opens on the overview with the agency league table and today pickup', async () => {
    page()
    expect(await screen.findByText('Green Co')).toBeInTheDocument()
    expect(screen.getByText('oversight.card.served')).toBeInTheDocument()
    expect(screen.getByText('oversight.card.pickup')).toBeInTheDocument()
    expect(screen.getByText('oversight.col.collected30')).toBeInTheDocument()
    expect(screen.getByText('95%')).toBeInTheDocument()
  })

  it('has the collection tab, and the old City Collection link lands on it', async () => {
    page('/app/city-dashboard?tab=collection')
    await waitFor(() => expect(collection).toHaveBeenCalledWith({ mode: 'daily' }))
    expect(await screen.findByText('Ward 1')).toBeInTheDocument()
    // Complaints and the per-agency table live on the overview, not here.
    expect(screen.queryByText('city.today.complaints')).toBeNull()
    expect(screen.queryByText('city.byAgency')).toBeNull()
  })

  it('sends the picked city to every tab', async () => {
    page()
    const picker = await screen.findByLabelText('oversight.pickCity')
    fireEvent.change(picker, { target: { value: 'SCC' } })
    await waitFor(() => expect(oversight).toHaveBeenCalledWith({ city: 'SCC' }))
    fireEvent.click(screen.getByText('oversight.tab.collection'))
    await waitFor(() => expect(collection).toHaveBeenCalledWith({ mode: 'daily', city: 'SCC' }))
    fireEvent.click(screen.getByText('oversight.tab.trend'))
    await waitFor(() => expect(trend).toHaveBeenCalledWith({ by: 'agency', mode: 'monthly', city: 'SCC' }))
  })

  it('shows the latest period per group, or every period on request', async () => {
    page()
    fireEvent.click(screen.getByText('oversight.tab.trend'))
    await waitFor(() => expect(trend).toHaveBeenCalledWith({ by: 'agency', mode: 'monthly' }))
    expect(await screen.findByText('2026-11')).toBeInTheDocument()
    expect(screen.queryByText('2026-10')).toBeNull()
    fireEvent.click(screen.getByLabelText('oversight.allPeriods'))
    expect(screen.getByText('2026-10')).toBeInTheDocument()

    fireEvent.click(screen.getByText('oversight.by.collector'))
    await waitFor(() => expect(trend).toHaveBeenCalledWith({ by: 'collector', mode: 'monthly' }))
  })
})
