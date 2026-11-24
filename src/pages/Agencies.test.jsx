import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AgenciesPage from './Agencies.jsx'

const Agencies = () => <MemoryRouter><AgenciesPage /></MemoryRouter>

// The agency form's geography: one district, several city corporations /
// pourashovas in it, and service wards only from the ticked ones.

const list = vi.fn()
const create = vi.fn()

vi.mock('../api/endpoints.js', () => ({
  agencies: {
    list: (...a) => list(...a),
    create: (...a) => create(...a),
    update: vi.fn(),
    collectors: vi.fn(),
  },
  remittances: {},
}))

const CITIES = [
  { id: 'KCC', name: 'Khulna City', district: 'Khulna' },
  { id: 'PHL', name: 'Phultala', district: 'Khulna' },
  { id: 'JPS', name: 'Jashore', district: 'Jashore' },
]
const WARDS = [
  { id: 'K-10', name: '10', city: 'KCC' },
  { id: 'K-2', name: '2', city: 'KCC' },
  { id: 'P-1', name: '1', city: 'PHL' },
  { id: 'J-1', name: '1', city: 'JPS' },
]

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    wards: WARDS,
    cities: CITIES,
    zones: [],
    districts: [{ name: 'Khulna' }, { name: 'Jashore' }],
    agencyTypes: [{ id: 'private' }],
    paymentModes: [],
    optLabel: (l, id) => id,
  }),
}))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ canWrite: true }) }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  taka: (v) => String(v),
  date: (v) => String(v),
  lang: 'en',
  localName: (row) => row?.name || row?.id,
  optLabel: (l, id) => id,
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))
vi.mock('../components/ExportMenu.jsx', () => ({ ExportMenu: () => null }))

describe('Agencies form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue([])
    create.mockResolvedValue({})
  })

  it('takes several cities of one district and only their wards', async () => {
    render(<Agencies />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    fireEvent.click(screen.getByText('agencies.register'))

    // No district yet: no city is listed.
    expect(screen.getByText('agencies.pickDistrictFirst')).toBeInTheDocument()
    expect(screen.queryByLabelText('Khulna City')).toBeNull()

    // Khulna district lists its own cities only.
    const district = screen.getByLabelText('holdings.district *')
    fireEvent.focus(district)
    fireEvent.change(district, { target: { value: 'Khul' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Khulna' }))
    expect(screen.queryByLabelText('Jashore')).toBeNull()
    fireEvent.click(screen.getByLabelText('Khulna City'))
    fireEvent.click(screen.getByLabelText('Phultala'))

    // Wards of the ticked cities only, each city's in number order.
    const wardButtons = [...document.querySelectorAll('.agency-ward-group button')].map((b) => b.textContent)
    expect(wardButtons).toEqual(['2', '10', '1'])
    fireEvent.click(screen.getByText('10'))
    fireEvent.click(screen.getAllByText('1')[0])

    // Unticking a city drops its wards.
    fireEvent.click(screen.getByLabelText('Phultala'))

    const inputs = document.querySelectorAll('form input:not([type=checkbox])')
    fireEvent.change(inputs[0], { target: { value: 'Green Co' } })
    fireEvent.change(screen.getByLabelText('agencies.shortCode'), { target: { value: 'GRN' } })
    fireEvent.click(screen.getAllByText('agencies.register').at(-1))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const body = create.mock.calls[0][0]
    expect(body.cities).toEqual(['KCC'])
    expect(body.serviceWards).toEqual(['K-10'])
    expect(body).not.toHaveProperty('city')
    // No status on the new-agency form: it starts active.
    expect(screen.queryByLabelText('agencies.col.status')).toBeNull()
    expect(body.status).toBe('active')
  })

  it('will not save without a district and a city', async () => {
    render(<Agencies />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    fireEvent.click(screen.getByText('agencies.register'))
    const inputs = document.querySelectorAll('form input:not([type=checkbox])')
    fireEvent.change(inputs[0], { target: { value: 'Green Co' } })
    fireEvent.change(screen.getByLabelText('agencies.shortCode'), { target: { value: 'GRN' } })
    const save = () => fireEvent.click(screen.getAllByText('agencies.register').at(-1))

    save()
    expect(screen.getByText('agencies.districtRequired')).toBeInTheDocument()

    const district = screen.getByLabelText('holdings.district *')
    fireEvent.focus(district)
    fireEvent.change(district, { target: { value: 'Khul' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Khulna' }))
    save()
    expect(screen.getByText('agencies.cityRequired')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()

    // A city but no ward: every ward of it, which the server fills in.
    fireEvent.click(screen.getByLabelText('Khulna City'))
    expect(screen.getByText('agencies.allWards')).toBeInTheDocument()
    save()
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].serviceWards).toEqual([])
  })
})
