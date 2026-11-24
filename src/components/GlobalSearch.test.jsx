import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import GlobalSearch from './GlobalSearch.jsx'

// The top-bar search: finds what the app holds, grouped, and opens its page.

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    holdings: [{ id: 'H-1', holdingNo: '12/A', ownerName: 'Karim', ownerPhone: '01811000001', road: 'KDA Ave' }],
    households: [{ id: 'HH-1', head: 'Salma', phone: '01911000002', holding: 'H-1', holdingNo: '12/A' }],
    collectors: [{ id: 'C-1', name: 'Rafiq Mia', dspId: 'DSP-0001', phone: '01711000042' }],
    vans: [{ id: 'V-7', plate: 'KHULNA-METRO-7' }],
    complaints: [{ id: 'CMP-9', head: 'Salma', holdingNo: '12/A', description: 'Missed pickup' }],
    agencies: [{ id: 'AG-1', name: 'Green Co', shortCode: 'GRN', phone: '01511000003' }],
  }),
}))
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: { role: 'super_admin' } }) }))
const usersList = vi.fn()
vi.mock('../api/endpoints.js', () => ({ users: { list: (...a) => usersList(...a) } }))
vi.mock('../access.js', () => ({ canAccess: () => true }))
vi.mock('../i18n/index.jsx', () => ({ useLang: () => ({ t: (k) => k }) }))

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/app/dashboard']}>
      <GlobalSearch />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
  return screen.getByPlaceholderText('nav.searchPlaceholder')
}

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usersList.mockResolvedValue([])
  })

  it('finds a collector by mobile and opens the Collectors list on them', () => {
    const box = setup()
    fireEvent.change(box, { target: { value: '০১৭১১' } })
    expect(screen.getByText('nav.search.collectors')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('Rafiq Mia'))
    expect(screen.getByTestId('where').textContent).toBe('/app/collectors?q=01711000042')
  })

  it('groups hits by kind and opens the first with Enter', () => {
    const box = setup()
    fireEvent.change(box, { target: { value: 'salma' } })
    expect(screen.getByText('nav.search.households')).toBeInTheDocument()
    expect(screen.getByText('nav.search.complaints')).toBeInTheDocument()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/app/holdings/H-1/households')
  })

  it('finds an agency and a user, fetching users only once', async () => {
    usersList.mockResolvedValue([{ id: 5, name: 'Nasrin Akter', phone: '01611000004', email: 'n@x.bd' }])
    const box = setup()
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'GRN' } })
    expect(screen.getByText('nav.search.agencies')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('Green Co'))
    expect(screen.getByTestId('where').textContent).toBe('/app/agencies?q=GRN')

    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: '01611' } })
    fireEvent.mouseDown(await screen.findByText('Nasrin Akter'))
    expect(screen.getByTestId('where').textContent).toBe('/app/users?q=01611000004')
    expect(usersList).toHaveBeenCalledTimes(1)
  })

  it('says so when nothing matches, and waits for two characters', () => {
    const box = setup()
    fireEvent.change(box, { target: { value: 'z' } })
    expect(screen.queryByText('common.noMatch')).toBeNull()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('common.noMatch')).toBeInTheDocument()
  })
})
