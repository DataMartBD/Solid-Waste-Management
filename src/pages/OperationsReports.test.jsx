import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OperationsReports from './OperationsReports.jsx'

// Operations Reports: six groups of tabs; the super admin's agency pick is sent
// to every tab; agency users get no picker. The components it borrows from the
// old Reports page are stubbed — they have their own data needs.

const scorecard = vi.fn()
const contract = vi.fn()
const auth = { isSuperAdmin: true }

const API = {
  reports: {
    agency: {
      scorecard: { load: (...a) => scorecard(...a), export: vi.fn() },
      contract: (...a) => contract(...a),
      complaintPerformance: { load: vi.fn(() => Promise.resolve({ rows: [], nature: [] })), export: vi.fn() },
      complaintsOverdue: { load: vi.fn(() => Promise.resolve({ rows: [] })), export: vi.fn() },
      register: () => ({ load: vi.fn(() => Promise.resolve({ rows: [] })), export: vi.fn() }),
      collectionSheet: { load: vi.fn(() => Promise.resolve({
        totals: { due: 3, confirmed: 2, auto: 0, skipped: 0, missed: 1, notRecorded: 0, collectedPct: 67 },
        rows: [
          { day: '2026-11-24', collector: 'C-1', name: 'Rahim', agency: 'Green Co', due: 3, confirmed: 2, auto: 0, skipped: 0, missed: 1, notRecorded: 0, collectedPct: 67 },
          { day: '2026-11-24', collector: null, name: '', agency: '', due: 2, confirmed: 0, auto: 0, skipped: 0, missed: 0, notRecorded: 2, collectedPct: 0 },
        ],
      })), export: vi.fn() },
      missedHoldings: { load: vi.fn(() => Promise.resolve({
        holdings: 1, repeat: 1, missed: 1, skipped: 1,
        rows: [{ holding: 'H-3', holdingNo: '7/C', owner: 'Salma', phone: '019', road: 'KDA', wardName: 'Ward 1', collector: 'C-1', collectorName: 'Rahim', missed: 1, skipped: 1, times: 2, reasonCounts: { noOne: 1 }, last: '2026-11-20' }],
      })), export: vi.fn() },
      fuel: { load: vi.fn(() => Promise.resolve({
        period: '2026-11', dropPct: 15,
        totals: { cost: 3000, costBefore: 2000, litres: 25, km: 150, vans: 1, check: 1, costPerKm: 20 },
        rows: [{ id: 'VAN-1', plate: 'KHULNA-T-1', agency: 'Green Co', driver: 'Rahim', fills: 1, litres: 25, cost: 3000, costBefore: 2000, km: 150, kmpl: 6, usualKmpl: 8, check: true, costPerKm: 20, holdings: 2, costPerHolding: 1500 }],
      })), export: vi.fn() },
      maintenance: { load: vi.fn(() => Promise.resolve({
        totals: { jobs: 1, cost: 400, downtimeDays: 2, open: 1, serviceDue: 1 },
        rows: [{ id: 'VAN-1', plate: 'KHULNA-T-1', agency: 'Green Co', jobs: 1, scheduled: 0, unscheduled: 1, cost: 400, downtimeDays: 2, open: 1, last: '2026-11-20', lastReason: 'Puncture', serviceDueIn: 300 }],
        jobs: [{ id: 'M-1', van: 'VAN-1', kind: 'unscheduled', reason: 'Puncture', vendor: '', opened: '2026-11-20', closed: null, downtimeH: 48, cost: 400 }],
      })), export: vi.fn() },
      surveyProgress: { load: vi.fn((p) => Promise.resolve(p.by === 'ward'
        ? { by: 'ward', totals: { holdings: 4, surveyed: 2, coverage: 50, surveys: 2, converted: 1 },
            rows: [{ ward: 'W-1', wardName: 'Ward 1', holdings: 4, surveyed: 2, coverage: 50, notSurveyed: 2, surveys: 2, converted: 1 }] }
        : { by: 'surveyor', totals: { surveys: 2, draft: 0, submitted: 1, reviewed: 0, converted: 1, rejected: 0 },
            rows: [{ surveyor: 'C-1', name: 'Surveyor Rahim', surveys: 2, daysWorked: 1, perDay: 2, draft: 0, submitted: 1, reviewed: 0, converted: 1, rejected: 0, conversion: 50, last: '2026-11-20' }] })), export: vi.fn() },
      repeatComplaints: { load: vi.fn(() => Promise.resolve({
        holdings: 1, complaints: 3, open: 1, minimum: 2, byType: {},
        rows: [{ holding: 'H-9', holdingNo: '9/A', owner: 'Rokeya', phone: '', road: 'KDA', wardName: 'Ward 1', complaints: 3, open: 1, typeCounts: { missed_collection: 3 }, mainType: 'missed_collection', first: '2026-11-01', last: '2026-11-20', assigned: '' }],
      })), export: vi.fn() },
      routeCompletion: { load: vi.fn(() => Promise.resolve({
        by: 'day', totals: { routeDays: 2, started: 1, onTime: 0, onTimePct: 0, completion: 40 },
        rows: [{ day: '2026-11-24', route: 'RT-1', routeName: 'KDA Avenue', wardName: '14', collector: 'C-1', collectorName: 'Rahim', stops: 5, served: 2, auto: 0, notServed: 0, completion: 40, first: '07:00', last: '10:15', windowEnd: '09:30', onTime: false, started: true }],
      })), export: vi.fn() },
      attendance: { load: vi.fn((p) => Promise.resolve({
        by: p.by, period: '2026-11', recordingSince: null, graceMinutes: 15,
        totals: { days: 24, present: 20, absent: 2, noRecord: 2, late: 3, attendancePct: 83.3 },
        rows: p.by === 'day'
          ? [{ day: '2026-11-24', collector: 'C-1', name: 'Attending Rahim', status: 'present', checkIn: '06:40', firstScan: '06:55', startsAt: '06:00', late: true }]
          : [{ collector: 'C-1', name: 'Attending Rahim', agency: 'Green Co', days: 24, present: 20, absent: 2, noRecord: 2, late: 3, attendancePct: 83.3, startsAt: '06:00' }],
      })), export: vi.fn() },
      monthlyPack: { load: vi.fn(() => Promise.resolve({
        period: '2026-11', partial: true, agency: 'Green Co',
        figures: [{ label: 'Collected %', value: '92%' }, { label: 'Fuel cost (BDT)', value: 3000 }],
        sections: [{ title: 'Collector scorecard', columns: [], rows: [{}] }, { title: 'Fuel by van', columns: [], rows: [] }],
      })), export: vi.fn() },
    },
  },
}
const DATA = { api: API, agencies: [{ id: 'AGN-1', name: 'Green Co', status: 'active' }] }
vi.mock('../context/DataContext.jsx', () => ({ useData: () => DATA }))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => auth }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  percent: (v) => `${v}%`,
  date: (v) => String(v),
  taka: (v) => `৳${v}`,
  period: (v) => String(v),
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))
vi.mock('./Reports.jsx', () => ({
  WasteByCollector: ({ extra }) => <div>waste-by-period {JSON.stringify(extra)}</div>,
  KpiScorecard: ({ extra }) => <div>kpi-scorecard {JSON.stringify(extra)}</div>,
  CustomerReports: () => <div>customer-coverage</div>,
}))

describe('OperationsReports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.isSuperAdmin = true
    scorecard.mockResolvedValue({
      period: '2026-11',
      weights: { coverage: 40, collection: 30, onTime: 20, complaints: 10 },
      rows: [
        { id: 'C-1', rank: 1, name: 'Rahim', agency: 'Green Co', wards: 1, holdings: 4, served: 2, coverage: 50, skipped: 0, complaints: 0, billed: 0, received: 0, collectionPct: 0, onTime: 80, score: 46 },
      ],
    })
    contract.mockResolvedValue({
      rank: 1, of: 3, period: '2026-11', served: 2, registered: 4, servedPct: 50, trend: 'up',
      target: 10, targetServed: 2, targetPct: 20, complaintsOpen: 0, complaintsOverdue: 0, slaPct: 0,
      collectorsActive: 1, collectorsCheckedIn: 0, vansTotal: 0, vansActive: 0, league: [], targets: [],
    })
  })

  it('opens on daily collection by day, and splits it by collector on request', async () => {
    render(<OperationsReports />)
    await waitFor(() => expect(API.reports.agency.collectionSheet.load).toHaveBeenCalledWith(expect.objectContaining({ by: 'day' })))
    fireEvent.click(screen.getByText('agencyReports.daily.by.collector'))
    expect(await screen.findByText('agencyReports.sheet.noCollector')).toBeInTheDocument()
    expect(API.reports.agency.collectionSheet.load).toHaveBeenLastCalledWith(expect.objectContaining({ by: 'collector' }))
  })

  it('ranks collectors, with the old waste report as the by-period view', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.staff'))
    expect(await screen.findByText('Rahim')).toBeInTheDocument()
    expect(screen.getByText('46')).toBeInTheDocument()
    fireEvent.click(screen.getByText('agencyReports.score.by.period'))
    expect(screen.getByText('waste-by-period {}')).toBeInTheDocument()
  })

  it('sends the super admin pick to every tab, the borrowed ones too', async () => {
    render(<OperationsReports />)
    fireEvent.change(await screen.findByLabelText('agencyReports.pickAgency'), { target: { value: 'AGN-1' } })
    await waitFor(() => expect(API.reports.agency.collectionSheet.load).toHaveBeenLastCalledWith(expect.objectContaining({ agency: 'AGN-1' })))
    fireEvent.click(screen.getByText('agencyReports.group.contract'))  // opens on Targets & KPIs
    expect(screen.getByText('kpi-scorecard {"agency":"AGN-1"}')).toBeInTheDocument()
    await waitFor(() => expect(contract).toHaveBeenCalledWith({ agency: 'AGN-1' }))
    expect(await screen.findByText(/agencyReports\.rank:/)).toBeInTheDocument()
  })

  it('lists missed holdings with the skip reasons translated', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.tab.missed'))
    expect(await screen.findByText('Salma')).toBeInTheDocument()
    expect(screen.getByText('collection.skip.noOne ×1')).toBeInTheDocument()
  })

  it('marks a route finished after its window as late', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.tab.routes'))
    expect(await screen.findByText('07:00 – 10:15')).toBeInTheDocument()
    expect(screen.getByText('agencyReports.routes.late')).toBeInTheDocument()
  })

  it('shows attendance per collector, and every day with late arrivals', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.staff'))
    fireEvent.click(screen.getByText('agencyReports.tab.attendance'))
    expect(await screen.findByText('Attending Rahim')).toBeInTheDocument()
    expect(screen.getAllByText('83.3%').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('agencyReports.att.by.day'))
    expect(await screen.findByText('06:40')).toBeInTheDocument()
    expect(screen.getAllByText('agencyReports.att.late').length).toBeGreaterThan(1)
  })

  it('lists holdings that complain again', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.complaints'))
    fireEvent.click(screen.getByText('agencyReports.tab.repeat'))
    expect(await screen.findByText('Rokeya')).toBeInTheDocument()
    expect(screen.getByText('complaints.type.missed_collection ×3')).toBeInTheDocument()
  })

  it('flags a van burning more fuel than usual', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.fleet'))  // opens on fuel
    expect(await screen.findByText('KHULNA-T-1')).toBeInTheDocument()
    expect(screen.getByText('6 · agencyReports.fuel.check')).toBeInTheDocument()
    expect(screen.getByText('agencyReports.fuel.vsBefore:{"pct":"+50"}')).toBeInTheDocument()
  })

  it('shows maintenance per van and the open jobs', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.fleet'))
    fireEvent.click(screen.getByText('agencyReports.tab.maintenance'))
    expect(await screen.findByText('agencyReports.maint.stillOpen')).toBeInTheDocument()
    expect(screen.getByText('agencyReports.maint.inKm:{"km":"300"}')).toBeInTheDocument()
  })

  it('keeps surveys, customers and registers under Records', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.records'))  // opens on survey progress
    expect(await screen.findByText('Surveyor Rahim')).toBeInTheDocument()
    fireEvent.click(screen.getByText('agencyReports.survey.by.ward'))
    expect(await screen.findByText('Ward 1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('agencyReports.tab.customers'))
    expect(screen.getByText('customer-coverage')).toBeInTheDocument()
  })

  it('previews the monthly report and downloads it as a PDF', async () => {
    render(<OperationsReports />)
    fireEvent.click(screen.getByText('agencyReports.group.contract'))
    fireEvent.click(screen.getByText('agencyReports.tab.pack'))
    expect(await screen.findByText('92%')).toBeInTheDocument()
    expect(screen.getByText('agencyReports.pack.partial')).toBeInTheDocument()
    fireEvent.click(screen.getByText('agencyReports.pack.download'))
    expect(API.reports.agency.monthlyPack.export).toHaveBeenCalledWith(expect.objectContaining({ format: 'pdf' }))
  })

  it('has no money tabs: those are in Finance Reports', () => {
    render(<OperationsReports />)
    expect(screen.queryByText('agencyReports.group.money')).toBeNull()
    expect(screen.queryByText('agencyReports.tab.cash')).toBeNull()
  })

  it('gives agency users no agency picker', async () => {
    auth.isSuperAdmin = false
    render(<OperationsReports />)
    await waitFor(() => expect(API.reports.agency.collectionSheet.load).toHaveBeenCalled())
    expect(screen.queryByLabelText('agencyReports.pickAgency')).toBeNull()
  })
})
