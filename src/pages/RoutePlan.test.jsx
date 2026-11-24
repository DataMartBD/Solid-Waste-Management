import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RoutePlan from './RoutePlan.jsx'

// Route Plan: a collector can be assigned from the route itself (the editor's
// "Walked by" and the route card's Unassigned badge), and a new route can be
// created with its collector in one go. Arriving from Collectors opens the
// Assignments tab on that collector.

const create = vi.fn()
const remove = vi.fn()
const setRoutes = vi.fn()

const COLLECTORS = [
  { id: 'C-1', name: 'Rahim', zone: 'W-14', wards: ['W-14'], status: 'idle', active: true },
  { id: 'C-2', name: 'Karim', zone: 'W-15', wards: ['W-15'], status: 'idle', active: true },
  { id: 'C-3', name: 'Away Jamal', zone: 'W-14', wards: ['W-14'], status: 'off_route', active: true },
]
const ROUTES = [
  { id: 'RT-1', name: 'KDA Avenue', ward: 'W-14', window: '06:00–09:30', windowStart: '06:00', windowEnd: '09:30', stops: [], active: true },
  { id: 'RT-2', name: 'Nirala Road', ward: 'W-15', window: '06:00–09:30', windowStart: '06:00', windowEnd: '09:30', stops: [], active: true },
]
const DATA = {
  collectors: COLLECTORS,
  holdings: [],
  routes: ROUTES,
  assignments: [{ id: 'A-2', collector: 'C-2', routes: ['RT-2'], active: true }],
  wards: [{ id: 'W-14', key: 'ward.14' }, { id: 'W-15', key: 'ward.15' }],
  api: {
    holdings: { unplanned: () => Promise.resolve({ routable: [], unverified: [], total: 0 }) },
    assignments: { setRoutes: (...a) => setRoutes(...a) },
    routes: {},
  },
  act: async (promise) => ({ ok: true, data: await promise }),
  create: (...a) => create(...a),
  update: vi.fn(),
  remove: (...a) => remove(...a),
  ready: true,
}
vi.mock('../context/DataContext.jsx', () => ({ useData: () => DATA }))

const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  digits: (v) => String(v),
  wardName: (v) => v,
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

const page = (url = '/app/route-plan') => render(<MemoryRouter initialEntries={[url]}><RoutePlan /></MemoryRouter>)

describe('RoutePlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    create.mockImplementation(async (kind) => ({ ok: true, data: { id: kind === 'routes' ? 'RT-NEW' : 'A-NEW' } }))
    remove.mockResolvedValue({ ok: true })
    setRoutes.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('assigns a collector from the route editor, ward collectors first, nobody off route', async () => {
    page()
    fireEvent.click(await screen.findByText('routePlan.editor.assign'))
    const dialog = screen.getByText('routePlan.assignC.title:{"route":"KDA Avenue"}').closest('.modal')
    // In-ward first; the off-route collector is listed but cannot be picked.
    const names = within(dialog).getAllByText(/^(Rahim|Karim|Away Jamal)$/).map((el) => el.textContent)
    expect(names.indexOf('Rahim')).toBeLessThan(names.indexOf('Karim'))
    const away = within(dialog).getByText('Away Jamal').closest('.row.gap-12')
    expect(within(away).getByText('routePlan.assignC.assign')).toBeDisabled()

    const rahim = within(dialog).getByText('Rahim').closest('.row.gap-12')
    fireEvent.click(within(rahim).getByText('routePlan.assignC.assign'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('assignments', { collector: 'C-1', routes: ['RT-1'], active: true }))
  })

  it('lets the collector of a held route be changed or removed from the editor', async () => {
    page()
    fireEvent.click(await screen.findByText('Nirala Road'))
    fireEvent.click(screen.getByText('routePlan.editor.change'))
    expect(screen.getByText('routePlan.assignC.remove:{"name":"Karim"}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('routePlan.assignC.remove:{"name":"Karim"}'))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(remove).toHaveBeenCalledWith('assignments', 'A-2'))
  })

  it('opens the same picker from an Unassigned route card', async () => {
    page()
    const badge = await screen.findByTitle('routePlan.routes.assignNow')
    fireEvent.click(badge)
    expect(screen.getByText('routePlan.assignC.title:{"route":"KDA Avenue"}')).toBeInTheDocument()
  })

  it('creates a route with its collector in one go', async () => {
    page()
    fireEvent.click(await screen.findByText('routePlan.routes.new'))
    fireEvent.change(screen.getByLabelText('routePlan.form.name'), { target: { value: 'Khan Jahan Ali Road' } })
    fireEvent.change(screen.getByLabelText('routePlan.form.collector'), { target: { value: 'C-1' } })
    fireEvent.click(screen.getByText('routePlan.form.create'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('routes', expect.objectContaining({ name: 'Khan Jahan Ali Road', ward: 'W-14' })))
    await waitFor(() => expect(create).toHaveBeenCalledWith('assignments', { collector: 'C-1', routes: ['RT-NEW'], active: true }))
  })

  it('creates a route without a collector when left for later', async () => {
    page()
    fireEvent.click(await screen.findByText('routePlan.routes.new'))
    fireEvent.change(screen.getByLabelText('routePlan.form.name'), { target: { value: 'Later Road' } })
    fireEvent.click(screen.getByText('routePlan.form.create'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('routes', expect.anything()))
    expect(create).not.toHaveBeenCalledWith('assignments', expect.anything())
  })

  it('arriving from Collectors opens Assignments with the route picker, and a way back', async () => {
    page('/app/route-plan?tab=crew&collector=C-1&from=collector-details')
    expect(await screen.findByText('routePlan.attach.title:{"name":"Rahim"}')).toBeInTheDocument()
    expect(screen.getAllByText('routePlan.backToCollectors').length).toBe(2) // header + picker
  })

  it('lists what is still to do and filters the route list by it', async () => {
    page()
    // RT-1 has no collector; both routes have no stops.
    fireEvent.click(await screen.findByText('routePlan.todo.unassigned:{"count":"1"}'))
    expect(screen.queryByText('Nirala Road')).toBeNull()
    expect(screen.getByText('KDA Avenue')).toBeInTheDocument()
    fireEvent.click(screen.getByText('routePlan.todo.empty:{"count":"2"}'))
    expect(screen.getByText('Nirala Road')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/routePlan\.todo\.showAll/))
    expect(screen.getByText('Nirala Road')).toBeInTheDocument()
  })
})
