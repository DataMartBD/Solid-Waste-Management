import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FinanceReports from './FinanceReports.jsx'

// Finance Reports: billing runs, bills by collector, household collection,
// household dues (status / age) and cash & deposits. The components borrowed
// from the old Reports and Customer Reports pages are stubbed.

const auth = { isSuperAdmin: true }

const API = {
  reports: {
    agency: {
      cashInHand: { load: vi.fn(() => Promise.resolve({
        total: 150, overdue: 150, collectors: 1, lateDays: 3, overdueDays: 7,
        rows: [{ id: 'C-1', name: 'Rahim', phone: '017', amount: 150, payments: 2, oldest: '2026-11-01', days: 10, status: 'overdue', methods: 'Cash 150', lastDeposit: null }],
      })), export: vi.fn() },
      duesAgeing: { load: vi.fn((p) => Promise.resolve({
        by: p.by, asOf: '2026-11-24', buckets: [],
        totals: { notDue: 0, d0_30: 0, d31_60: 200, d61_90: 0, d90: 300, outstanding: 500 },
        rows: p.by === 'ward'
          ? [{ ward: 'W-1', wardName: 'Ward 1', holdings: 2, bills: 2, notDue: 0, d0_30: 0, d31_60: 200, d61_90: 0, d90: 300, outstanding: 500 }]
          : [{ holding: 'H-1', holdingNo: '12/B', owner: 'Karim Sheikh', phone: '018', road: 'KDA', wardName: 'Ward 1', oldestPeriod: '2026-06', bills: 2, notDue: 0, d0_30: 0, d31_60: 200, d61_90: 0, d90: 300, outstanding: 500 }],
      })), export: vi.fn() },
      billingRuns: { load: vi.fn((p) => Promise.resolve(p.period
        ? { period: p.period, totals: { bills: 2, amount: 400, collected: 200, outstanding: 200, paid: 1, partial: 0, unpaid: 1, collectionPct: 50 },
            rows: [{ ward: 'W-1', wardName: 'Ward 14', bills: 2, amount: 400, collected: 200, outstanding: 200, paid: 1, partial: 0, unpaid: 1, collectionPct: 50 }] }
        : { period: null, totals: { bills: 2, amount: 400, collected: 200, outstanding: 200, paid: 1, partial: 0, unpaid: 1, collectionPct: 50 },
            rows: [{ period: '2026-10', bills: 2, amount: 400, collected: 200, outstanding: 200, paid: 1, partial: 0, unpaid: 1, collectionPct: 50 }] })), export: vi.fn() },
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
  BillsByCollector: ({ extra }) => <div>bills-by-collector {JSON.stringify(extra)}</div>,
  Reconciliation: ({ extra }) => <div>reconciliation {JSON.stringify(extra)}</div>,
}))
vi.mock('./ReportsCustomer.jsx', () => ({
  CustomerCollection: ({ extra }) => <div>household-collection {JSON.stringify(extra)}</div>,
  CustomerBillStatus: ({ extra }) => <div>household-status {JSON.stringify(extra)}</div>,
}))

describe('FinanceReports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.isSuperAdmin = true
  })

  it('opens on billing runs and opens a month by ward', async () => {
    render(<FinanceReports />)
    fireEvent.click(await screen.findByText('2026-10'))
    expect(await screen.findByText('Ward 14')).toBeInTheDocument()
    expect(API.reports.agency.billingRuns.load).toHaveBeenLastCalledWith({ period: '2026-10' })
  })

  it('shows household dues by month status, or by age', async () => {
    render(<FinanceReports />)
    fireEvent.click(screen.getByText('finance.tab.dues'))
    expect(screen.getByText('household-status {}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('finance.dues.by.age'))
    expect(await screen.findByText('Karim Sheikh')).toBeInTheDocument()
    fireEvent.click(screen.getByText('agencyReports.dues.by.ward'))
    expect(await screen.findByText('Ward 1')).toBeInTheDocument()
  })

  it('puts cash in hand and the month reconciliation together', async () => {
    render(<FinanceReports />)
    fireEvent.click(screen.getByText('finance.tab.cash'))
    expect(await screen.findByText('Rahim')).toBeInTheDocument()
    expect(screen.getByText(/agencyReports\.cash\.status\.overdue/)).toBeInTheDocument()
    expect(screen.getByText('reconciliation {}')).toBeInTheDocument()
  })

  it('sends the super admin pick to every tab', async () => {
    render(<FinanceReports />)
    fireEvent.change(screen.getByLabelText('agencyReports.pickAgency'), { target: { value: 'AGN-1' } })
    await waitFor(() => expect(API.reports.agency.billingRuns.load).toHaveBeenLastCalledWith({ agency: 'AGN-1' }))
    fireEvent.click(screen.getByText('finance.tab.bills'))
    expect(screen.getByText('bills-by-collector {"agency":"AGN-1"}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('finance.tab.household'))
    expect(screen.getByText('household-collection {"agency":"AGN-1"}')).toBeInTheDocument()
  })

  it('gives agency users no agency picker', () => {
    auth.isSuperAdmin = false
    render(<FinanceReports />)
    expect(screen.queryByLabelText('agencyReports.pickAgency')).toBeNull()
  })
})
