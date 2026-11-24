import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddToRouteModal } from './RouteAssign.jsx'

// Adding holdings to a route from the holding side: only routes of the
// holdings' wards are offered, and a pick adds just the verified holdings of
// that route's ward, saying what it skipped.

const addStop = vi.fn()
const act = vi.fn()
const DATA = {
  routes: [
    { id: 'RT-1', name: 'KDA Avenue', ward: 'W-14', window: '06:00–09:30', stops: ['H-9'], active: true },
    { id: 'RT-2', name: 'Nirala Road', ward: 'W-15', window: '06:00–09:30', stops: [], active: true },
    { id: 'RT-3', name: 'Far Road', ward: 'W-99', window: '06:00–09:30', stops: [], active: true },
  ],
  assignments: [{ id: 'A-1', collector: 'C-1', routes: ['RT-1'], active: true }],
  collectors: [{ id: 'C-1', name: 'Rahim' }],
  act: (...a) => act(...a),
  api: { routes: { addStop: (...a) => addStop(...a) } },
}
vi.mock('../context/DataContext.jsx', () => ({ useData: () => DATA }))
const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v), digits: (v) => String(v), wardName: (v) => v,
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

const HOLDINGS = [
  { id: 'H-1', holdingNo: '1', ward: 'W-14', verified: true, routeId: null },
  { id: 'H-2', holdingNo: '2', ward: 'W-14', verified: false, routeId: null },
  { id: 'H-3', holdingNo: '3', ward: 'W-15', verified: true, routeId: null },
  { id: 'H-9', holdingNo: '9', ward: 'W-14', verified: true, routeId: 'RT-1' },
]

describe('AddToRouteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addStop.mockResolvedValue({})
    act.mockImplementation(async (p) => { await p; return { ok: true } })
  })

  it('offers only routes of the selected holdings’ wards, with their collector', () => {
    render(<AddToRouteModal holdings={HOLDINGS} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('KDA Avenue')).toBeInTheDocument()
    expect(screen.getByText('Nirala Road')).toBeInTheDocument()
    expect(screen.queryByText('Far Road')).toBeNull()
    expect(screen.getByText(/Rahim/)).toBeInTheDocument()
    expect(screen.getByText('routeAssign.unverified:{"count":"1"}')).toBeInTheDocument()
    expect(screen.getByText('routeAssign.manyWards:{"count":"2"}')).toBeInTheDocument()
  })

  it('adds only the verified holdings of the route’s ward, and says what it skipped', async () => {
    const onDone = vi.fn()
    render(<AddToRouteModal holdings={HOLDINGS} onClose={vi.fn()} onDone={onDone} />)
    fireEvent.click(screen.getAllByText('routeAssign.add')[0]) // KDA Avenue, W-14
    await waitFor(() => expect(addStop).toHaveBeenCalledTimes(1))
    expect(addStop).toHaveBeenCalledWith('RT-1', 'H-1')
    expect(await screen.findByText('routeAssign.added:{"count":"1","route":"KDA Avenue"}')).toBeInTheDocument()
    expect(screen.getByText('routeAssign.skipAlready:{"count":"1"}')).toBeInTheDocument()
    expect(screen.getByText('routeAssign.skipWard:{"count":"1"}')).toBeInTheDocument()
    expect(screen.getByText('routeAssign.skipUnverified:{"count":"1"}')).toBeInTheDocument()
    fireEvent.click(screen.getByText('common.close'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ added: 1 }))
  })

  it('marks the route a single holding is already on and does not re-add it', () => {
    render(<AddToRouteModal holdings={[HOLDINGS[3]]} onClose={vi.fn()} onDone={vi.fn()} />)
    expect(screen.getByText('routeAssign.current')).toBeInTheDocument()
    expect(screen.getByText('routeAssign.add').closest('button')).toBeDisabled()
  })

  it('reports a refusal from the server per holding', async () => {
    act.mockImplementation(async () => ({ ok: false, error: { detail: 'Holding is not verified.' } }))
    render(<AddToRouteModal holdings={[HOLDINGS[0]]} onClose={vi.fn()} onDone={vi.fn()} />)
    fireEvent.click(screen.getByText('routeAssign.add'))
    expect(await screen.findByText('1: Holding is not verified.')).toBeInTheDocument()
  })
})
