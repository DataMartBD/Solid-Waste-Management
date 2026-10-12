import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Setup from './Setup.jsx'

// The Setup page writes master data every other form reads, so what these pin
// is what it sends: a new type's code normalised into a safe stored value with
// its i18n key, a city's times as entered, and a catalog re-read after a save
// so the dropdowns elsewhere see the change.

// Hoisted with the mocks below, which run before this file's other top level.
const { api, reloadCatalog } = vi.hoisted(() => {
  const crud = () => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() })
  return {
    api: { cities: crud(), zones: crud(), wards: crud(), dumpingPoints: crud(), cityTypes: crud(), agencyTypes: crud() },
    reloadCatalog: vi.fn(() => Promise.resolve()),
  }
})
vi.mock('../api/endpoints.js', () => ({ setup: api }))

vi.mock('../context/DataContext.jsx', () => ({ useData: () => ({ reloadCatalog }) }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  digits: (v) => String(v),
  optLabel: (list, id) => (list.find((o) => o.id === id) || {}).label || id,
  localName: (row) => row?.name || row?.id,
  n: (v) => String(v),
  wardName: (id) => ({ 'W-14': 'Ward 14', 'SCC-W22': 'Ward 22' }[id] || id),
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

const CITY_TYPES = [
  { id: 'city_corporation', key: 'opt.cityType.city_corporation', label: 'City Corporation', active: true },
  { id: 'pourashova', key: 'opt.cityType.pourashova', label: 'Pourashova', active: true },
]
const KCC = {
  id: 'KCC', name: 'Khulna City Corporation', nameBn: '', cityType: 'city_corporation',
  district: 'Khulna', collectionCutoff: '21:00:00', complaintDeadline: '12:00:00', active: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  api.cities.list.mockResolvedValue([KCC])
  api.cityTypes.list.mockResolvedValue(CITY_TYPES)
  api.agencyTypes.list.mockResolvedValue([])
  api.zones.list.mockResolvedValue(ZONES)
  api.wards.list.mockResolvedValue([])
  api.dumpingPoints.list.mockResolvedValue([])
})

const SCC = { ...KCC, id: 'SCC', name: 'Sylhet City Corporation', district: 'Sylhet' }
const ZONES = [
  { id: 'Z-03', name: 'Sonadanga', city: 'KCC' },
  { id: 'SCC-Z1', name: 'Zindabazar', city: 'SCC' },
]

describe('Setup — zones and wards', () => {
  beforeEach(() => { api.cities.list.mockResolvedValue([KCC, SCC]) })

  it('narrows the ward list to one city', async () => {
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.wards'))
    await screen.findByText('setup.empty')
    fireEvent.change(screen.getByLabelText('setup.filterCity'), { target: { value: 'SCC' } })
    await waitFor(() => expect(api.wards.list).toHaveBeenLastCalledWith({ zone__city: 'SCC' }))
  })

  it('adds a ward under a zone of the chosen city, with a clean code', async () => {
    api.wards.create.mockResolvedValue({ id: 'SCC-W22', name: 'Ward 22' })
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.wards'))
    await screen.findByText('setup.empty')
    fireEvent.click(screen.getByText('setup.add.wards'))

    fireEvent.change(screen.getByLabelText('setup.col.code'), { target: { value: 'scc w22' } })
    fireEvent.change(screen.getByLabelText('setup.col.name'), { target: { value: 'Ward 22' } })
    fireEvent.change(screen.getByLabelText('setup.col.nameBn'), { target: { value: 'ওয়ার্ড ২২' } })
    fireEvent.change(screen.getByLabelText('setup.col.city'), { target: { value: 'SCC' } })
    // Only Sylhet's zone is offered once Sylhet is chosen.
    const zone = screen.getByLabelText('setup.col.zone')
    expect([...zone.options].map((o) => o.value)).toEqual(['', 'SCC-Z1'])
    fireEvent.change(zone, { target: { value: 'SCC-Z1' } })
    fireEvent.change(screen.getByLabelText('setup.col.lat'), { target: { value: '24.8949' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(api.wards.create).toHaveBeenCalled())
    expect(api.wards.create).toHaveBeenCalledWith({
      id: 'SCC-W22', key: 'opt.ward.SCC-W22', name: 'Ward 22', nameBn: 'ওয়ার্ড ২২', zone: 'SCC-Z1',
      lat: 24.8949, lng: null, active: true,
    })
    await waitFor(() => expect(reloadCatalog).toHaveBeenCalled())
  })

  it('refuses a ward with no zone before calling the server', async () => {
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.wards'))
    await screen.findByText('setup.empty')
    fireEvent.click(screen.getByText('setup.add.wards'))
    fireEvent.change(screen.getByLabelText('setup.col.code'), { target: { value: 'X1' } })
    fireEvent.change(screen.getByLabelText('setup.col.name'), { target: { value: 'X' } })
    fireEvent.click(screen.getByText('common.save'))
    expect(await screen.findByText('setup.requiredZone')).toBeTruthy()
    expect(api.wards.create).not.toHaveBeenCalled()
  })

  it('adds a zone to a city', async () => {
    api.zones.create.mockResolvedValue({ id: 'SCC-Z2', name: 'Amberkhana' })
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.zones'))
    await screen.findByText('Zindabazar')
    fireEvent.click(screen.getByText('setup.add.zones'))
    fireEvent.change(screen.getByLabelText('setup.col.code'), { target: { value: 'scc-z2' } })
    fireEvent.change(screen.getByLabelText('setup.col.name'), { target: { value: 'Amberkhana' } })
    fireEvent.change(screen.getByLabelText('setup.col.nameBn'), { target: { value: 'আম্বরখানা' } })
    fireEvent.change(screen.getByLabelText('setup.col.city'), { target: { value: 'SCC' } })
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(api.zones.create).toHaveBeenCalledWith({
      id: 'SCC-Z2', key: 'opt.zone.SCC-Z2', name: 'Amberkhana', nameBn: 'আম্বরখানা', city: 'SCC',
    }))
  })
})

describe('Setup', () => {
  it('lists cities with their collection-day times', async () => {
    render(<Setup />)
    expect(await screen.findByText('Khulna City Corporation')).toBeTruthy()
    expect(screen.getByText('21:00')).toBeTruthy()
    expect(screen.getByText('12:00')).toBeTruthy()
  })

  it('adds an agency type with a normalised code and its i18n key', async () => {
    api.agencyTypes.create.mockResolvedValue({ id: 'union_parishad', label: 'Union Parishad' })
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.agencyTypes'))
    await screen.findByText('setup.empty')
    fireEvent.click(screen.getAllByText('setup.add.agencyTypes')[0])

    fireEvent.change(screen.getByLabelText('setup.col.code'), { target: { value: 'Union Parishad' } })
    fireEvent.change(screen.getByLabelText('setup.col.label'), { target: { value: 'Union Parishad' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(api.agencyTypes.create).toHaveBeenCalled())
    expect(api.agencyTypes.create).toHaveBeenCalledWith({
      id: 'union_parishad', key: 'opt.agencyType.union_parishad', label: 'Union Parishad', active: true,
    })
    await waitFor(() => expect(reloadCatalog).toHaveBeenCalled())
  })

  it('saves a city with the cut-off it was given', async () => {
    api.cities.update.mockResolvedValue({ ...KCC, collectionCutoff: '20:30:00' })
    render(<Setup />)
    fireEvent.click(await screen.findByText('common.edit'))
    fireEvent.change(screen.getByLabelText('setup.col.cutoff'), { target: { value: '20:30' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(api.cities.update).toHaveBeenCalled())
    const [id, body] = api.cities.update.mock.calls[0]
    expect(id).toBe('KCC')
    expect(body.collectionCutoff).toBe('20:30')
    expect(body.complaintDeadline).toBe('12:00')
    expect(body.cityType).toBe('city_corporation')
  })

  it('shows the server message when a save is refused', async () => {
    api.cities.update.mockRejectedValue({ fieldError: (f) => (f === 'cityType' ? 'Invalid type.' : null) })
    render(<Setup />)
    fireEvent.click(await screen.findByText('common.edit'))
    fireEvent.click(screen.getByText('common.save'))
    expect(await screen.findByText('Invalid type.')).toBeTruthy()
  })
})

describe('Setup — dumping points', () => {
  beforeEach(() => {
    api.cities.list.mockResolvedValue([KCC, SCC])
    api.wards.list.mockResolvedValue([
      { id: 'W-14', name: 'Ward 14', zone: 'Z-03', city: 'KCC' },
      { id: 'SCC-W22', name: 'Ward 22', zone: 'SCC-Z1', city: 'SCC' },
    ])
  })

  it('adds a point serving wards of its own city only', async () => {
    api.dumpingPoints.create.mockResolvedValue({ id: 1, name: 'Rajbandh' })
    render(<Setup />)
    fireEvent.click(await screen.findByText('setup.tab.dumpingPoints'))
    await screen.findByText('setup.empty')
    fireEvent.click(screen.getByText('setup.add.dumpingPoints'))

    fireEvent.change(screen.getByLabelText('setup.col.name'), { target: { value: 'Rajbandh' } })
    fireEvent.change(screen.getByLabelText('setup.col.kind'), { target: { value: 'disposal_site' } })
    // Only Khulna's ward is offered for the Khulna city chosen by default.
    expect(screen.queryByText('Ward 22')).toBeNull()
    fireEvent.click(screen.getByLabelText('Ward 14'))
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(api.dumpingPoints.create).toHaveBeenCalled())
    expect(api.dumpingPoints.create.mock.calls[0][0]).toMatchObject({
      name: 'Rajbandh', kind: 'disposal_site', city: 'KCC', wards: ['W-14'],
    })
  })
})
