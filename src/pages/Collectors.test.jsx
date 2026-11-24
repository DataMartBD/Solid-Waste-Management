import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import CollectorsPage from './Collectors.jsx'

const Collectors = () => <MemoryRouter><CollectorsPage /></MemoryRouter>
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div> }
const CollectorsWithRoutes = () => (
  <MemoryRouter initialEntries={['/app/collectors']}>
    <Routes>
      <Route path="/app/collectors" element={<CollectorsPage />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>
)

// The collector form's wards: chosen several at a time, only from one city,
// and sent as `wards` (the server works out the home ward from them).

const update = vi.fn()
const create = vi.fn()
const act = vi.fn()
const transfer = vi.fn()
const AGENCIES = [
  { id: 'AGN-1', name: 'Premier Clean', status: 'active', cities: ['KCC'] },
  { id: 'AGN-2', name: 'Green Co', status: 'active' },
  { id: 'AGN-9', name: 'Old Contractor', status: 'terminated' },
]

const COLLECTOR = {
  id: 'C-1', name: 'Rafiq Mia', dspId: 'DSP-0001', zone: 'K-2', wards: ['K-2'],
  phone: '', license: '', licenseExp: null, joined: null, status: 'idle', attendance: 'checked_in',
  coverage: 0, onTime: 0, complaints: 0, vanId: null,
}
const WARDS = [
  { id: 'K-10', name: '10', city: 'KCC' },
  { id: 'K-2', name: '2', city: 'KCC' },
  { id: 'J-1', name: '1', city: 'JPS' },
]

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    collectors: [COLLECTOR],
    agencies: AGENCIES,
    vans: [],
    wards: WARDS,
    catalog: {
      cities: [{ id: 'KCC', name: 'Khulna', district: 'Khulna' }, { id: 'JPS', name: 'Jashore', district: 'Jashore' }],
      districts: [{ name: 'Khulna' }, { name: 'Jashore' }],
    },
    create: (...a) => create(...a),
    update: (...a) => update(...a),
    remove: vi.fn(),
    act: (...a) => act(...a),
    api: { collectors: { transfer: (...a) => transfer(...a) } },
    vanById: () => null,
    routes: [{ id: 'RT-1', name: 'KDA Avenue', stops: ['H-1', 'H-2', 'H-3'] }],
    assignments: [{ id: 'A-1', collector: 'C-1', routes: ['RT-1'], active: true }],
  }),
}))
const AUTH = { isAdmin: true, user: { agency: null } }
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => AUTH }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  percent: (v) => `${v}%`,
  date: (v) => String(v),
  digits: (v) => String(v),
  lang: 'en',
  localName: (row) => row?.name || row?.id,
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

describe('Collectors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({ ok: true, data: COLLECTOR })
    create.mockResolvedValue({ ok: true, data: { id: 'C-2' } })
    act.mockResolvedValue({ ok: true })
    AUTH.user = { agency: null }
    COLLECTOR.agency = 'AGN-1'
  })

  function fillNew() {
    fireEvent.click(screen.getByText('collectors.addCollector'))
    fireEvent.change(screen.getByLabelText('collectors.field.fullName'), { target: { value: 'New One' } })
    const city = screen.getByLabelText('holdings.city')
    fireEvent.focus(city)
    fireEvent.change(city, { target: { value: 'Khul' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Khulna' }))
    fireEvent.click(screen.getByLabelText('2'))
  }

  it('lets corporation staff pick an active agency for a new collector', async () => {
    render(<Collectors />)
    fillNew()
    const agency = screen.getByLabelText('collectors.field.agency')
    const names = [...agency.querySelectorAll('option')].map((o) => o.textContent)
    expect(names).toEqual(['collectors.noAgency', 'Premier Clean', 'Green Co'])
    fireEvent.change(agency, { target: { value: 'AGN-2' } })
    fireEvent.click(screen.getAllByText('collectors.addCollector').at(-1))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][1].agency).toBe('AGN-2')
  })

  it('fills in an agency user’s own agency without asking', async () => {
    AUTH.user = { agency: 'AGN-1' }
    render(<Collectors />)
    fillNew()
    expect(screen.getByDisplayValue('Premier Clean')).toBeDisabled()
    fireEvent.click(screen.getAllByText('collectors.addCollector').at(-1))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][1]).not.toHaveProperty('agency')
  })

  it('transfers a collector to another active agency', async () => {
    render(<Collectors />)
    fireEvent.click(screen.getByTitle('common.details'))
    fireEvent.click(screen.getByText('collectors.transfer'))
    const to = screen.getByLabelText('collectors.transferTo')
    // Not the one they are with, and not an inactive one.
    expect([...to.querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['collectors.chooseAgency', 'Green Co'])
    fireEvent.change(to, { target: { value: 'AGN-2' } })
    fireEvent.click(screen.getAllByText('collectors.transfer').at(-1))
    await waitFor(() => expect(transfer).toHaveBeenCalled())
    expect(transfer.mock.calls[0][0]).toBe('C-1')
    expect(transfer.mock.calls[0][1].agency).toBe('AGN-2')
  })

  it('offers an agency user only their agency’s district and city', () => {
    AUTH.user = { agency: 'AGN-1' }
    render(<Collectors />)
    fireEvent.click(screen.getByText('collectors.addCollector'))
    // The one city is filled in, its wards listed.
    expect([...document.querySelectorAll('.ward-list label')].map((l) => l.textContent)).toEqual(['2', '10'])
    const district = screen.getByLabelText('holdings.district')
    fireEvent.focus(district)
    fireEvent.change(district, { target: { value: '' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent).filter((x) => !x.startsWith('collectors.'))).toEqual(['Khulna'])
  })

  it('offers no transfer to an agency user', () => {
    AUTH.user = { agency: 'AGN-1' }
    render(<Collectors />)
    fireEvent.click(screen.getByTitle('common.details'))
    expect(screen.queryByText('collectors.transfer')).toBeNull()
  })

  it('lists the wards of the collector’s own city, in number order, and sends the ticked ones', async () => {
    render(<Collectors />)
    fireEvent.click(screen.getByTitle('common.edit'))

    const labels = [...document.querySelectorAll('.ward-list label')].map((l) => l.textContent)
    expect(labels).toEqual(['2', '10'])

    fireEvent.click(screen.getByLabelText('10'))
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(update).toHaveBeenCalled())
    const payload = update.mock.calls[0][2]
    expect(payload.wards).toEqual(['K-2', 'K-10'])
    expect(payload).not.toHaveProperty('zone')
  })

  it('finds a collector by mobile number in the search box', () => {
    COLLECTOR.phone = '01711000042'
    render(<Collectors />)
    const box = screen.getByPlaceholderText('collectors.searchPlaceholder')
    fireEvent.change(box, { target: { value: '০১৭১১' } })
    expect(screen.getByText('Rafiq Mia')).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '01999' } })
    expect(screen.queryByText('Rafiq Mia')).toBeNull()
    COLLECTOR.phone = ''
  })

  it('refuses to save without a ward', async () => {
    render(<Collectors />)
    fireEvent.click(screen.getByText('collectors.addCollector'))
    fireEvent.change(screen.getByLabelText('collectors.field.fullName'), { target: { value: 'New' } })
    fireEvent.click(screen.getAllByText('collectors.addCollector').at(-1))
    expect(await screen.findByText('collectors.wardRequired')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('opens Route Plan assignments on the collector from the row and the drawer', () => {
    AUTH.user = { agency: null, roleKey: 'super_admin' }
    render(<CollectorsWithRoutes />)
    fireEvent.click(screen.getByLabelText('collectors.assignRoute'))
    expect(screen.getByTestId('where')).toHaveTextContent('/app/route-plan?tab=crew&collector=C-1&from=collectors')
  })

  it('shows the assign-route shortcut in the drawer too', () => {
    AUTH.user = { agency: null, roleKey: 'agency_admin' }
    render(<CollectorsWithRoutes />)
    fireEvent.click(screen.getByTitle('common.details'))
    fireEvent.click(screen.getByText('collectors.assignRoute'))
    expect(screen.getByTestId('where')).toHaveTextContent('/app/route-plan?tab=crew&collector=C-1&from=collector-details')
  })

  it('hides the shortcut from a role that cannot open Route Plan', () => {
    AUTH.user = { agency: null, roleKey: 'collector' }
    render(<Collectors />)
    expect(screen.queryByLabelText('collectors.assignRoute')).toBeNull()
  })

  it('reopens a collector details panel from ?open= (the Route Plan back button)', () => {
    render(
      <MemoryRouter initialEntries={['/app/collectors?open=C-1']}>
        <Routes><Route path="/app/collectors" element={<><CollectorsPage /><Where /></>} /></Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('collectors.performance')).toBeInTheDocument()
    // …and the parameter is dropped, so a refresh of the list will not reopen it.
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/collectors$/)
  })

  it('goes back to Route Plan, onto Assignments when it came from there', () => {
    AUTH.user = { agency: null, roleKey: 'super_admin' }
    render(
      <MemoryRouter initialEntries={['/app/collectors?from=route-plan']}>
        <Routes>
          <Route path="/app/collectors" element={<CollectorsPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('collectors.backToRoutePlan'))
    expect(screen.getByTestId('where')).toHaveTextContent('/app/route-plan?tab=crew')
  })

  it('shows how many routes and stops each collector walks', () => {
    render(<Collectors />)
    expect(screen.getByText('collectors.routesLoad:{"routes":"1","stops":"3"}')).toBeInTheDocument()
  })
})
