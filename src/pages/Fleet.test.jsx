import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FleetPage from './Fleet.jsx'

// The registry's search box: van ID, plate (spaces and dashes ignored) or driver.

const VANS = [
  { id: 'V-7', plate: 'KHULNA-METRO-7', type: 'compactor', status: 'active', driver: 'C-1', odometer: 0 },
  { id: 'V-8', plate: 'JASHORE-TA-8', type: 'pickup', status: 'active', driver: null, odometer: 0 },
]

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    vans: VANS, collectors: [], maintenance: [], fuelLogs: [],
    create: vi.fn(), update: vi.fn(), remove: vi.fn(), act: vi.fn(), reload: vi.fn(),
    api: { vans: { kpis: vi.fn(), alerts: vi.fn() } },
    ready: false,
    collectorName: (id) => (id === 'C-1' ? 'Rafiq Mia' : id),
  }),
}))
vi.mock('../i18n/index.jsx', () => ({
  useLang: () => ({
    t: (k) => k, n: (v) => String(v), taka: (v) => String(v), percent: (v) => `${v}%`,
    date: (v) => String(v), lang: 'en',
  }),
}))

const Fleet = () => <MemoryRouter><FleetPage /></MemoryRouter>

describe('Fleet registry search', () => {
  it('finds a van by plate, typed with spaces, and by driver', () => {
    render(<Fleet />)
    const box = screen.getByPlaceholderText('fleet.searchPlaceholder')

    fireEvent.change(box, { target: { value: 'khulna metro 7' } })
    expect(screen.getByText('KHULNA-METRO-7')).toBeInTheDocument()
    expect(screen.queryByText('JASHORE-TA-8')).toBeNull()

    fireEvent.change(box, { target: { value: 'rafiq' } })
    expect(screen.getByText('KHULNA-METRO-7')).toBeInTheDocument()
    expect(screen.queryByText('JASHORE-TA-8')).toBeNull()

    fireEvent.change(box, { target: { value: '' } })
    expect(screen.getByText('JASHORE-TA-8')).toBeInTheDocument()
  })
})
