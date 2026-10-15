import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Citizen from './Citizen.jsx'

// The citizen portal: PIN sign-in, the default-PIN reminder (dismissible), a
// holding's collection and complaints — and only the three sections.

const { api, store } = vi.hoisted(() => ({
  api: {
    login: vi.fn(), me: vi.fn(), changePin: vi.fn(), holding: vi.fn(),
    complaints: vi.fn(), complain: vi.fn(), reopen: vi.fn(), photos: vi.fn(),
  },
  store: { token: null },
}))
vi.mock('../citizen/api.js', () => ({
  citizenApi: api,
  readCitizenToken: () => store.token,
  writeCitizenToken: (token) => { store.token = token },
}))

const LANG = {
  // A real dictionary returns the key itself when it has no entry; error keys
  // get a marker so the page can tell "translated" from "missing".
  t: (key, vars) => (key.startsWith('citizen.err.') ? `ERR ${key}`
    : vars ? `${key}:${JSON.stringify(vars)}` : key),
  lang: 'en', setLang: vi.fn(),
  digits: (v) => String(v), digitsOnly: (v) => String(v).replace(/\D/g, ''),
  date: (v) => String(v), taka: (v) => `Tk ${v}`, period: (v) => String(v),
}
vi.mock('../i18n/index.jsx', () => ({
  useLang: () => LANG,
  LANGUAGES: [{ id: 'bn', short: 'বাং' }, { id: 'en', short: 'EN' }],
}))

const day = (d, status) => ({ day: `2026-10-${String(d).padStart(2, '0')}`, status })
const DAYS = Array.from({ length: 30 }, (_, i) => day(i + 1, i === 29 ? 'pending' : 'collected'))
const OWNER_ACCOUNT = {
  phone: '01812990011', name: 'Ruksana', usingDefaultPin: true,
  holdings: [{ id: 'HLD-1', holdingNo: '15/B', road: 'Mohsin Road', address: '', ward: 'W-09', wardName: 'Ward 09', role: 'owner', household: null, unit: '' }],
}

const page = () => render(<MemoryRouter><Citizen /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  store.token = null
  api.holding.mockResolvedValue({ collection: { today: DAYS[29], cutoff: '21:00', complaintDeadline: '12:00', days: DAYS } })
  api.complaints.mockResolvedValue([])
})

describe('Citizen portal', () => {
  it('signs in with mobile and PIN and shows the holding', async () => {
    api.login.mockResolvedValue({ token: 'T', account: OWNER_ACCOUNT })
    page()
    fireEvent.change(screen.getByLabelText('citizen.phone'), { target: { value: '01812990011' } })
    fireEvent.change(screen.getByLabelText('citizen.pin'), { target: { value: '0011' } })
    fireEvent.click(screen.getByRole('button', { name: 'citizen.signIn' }))

    await waitFor(() => expect(api.login).toHaveBeenCalledWith('01812990011', '0011'))
    expect(await screen.findByText('15/B')).toBeTruthy()
    expect(store.token).toBe('T')
    expect((await screen.findAllByText('citizen.status.pending')).length).toBeGreaterThan(0)
  })

  it('shows the server error when the number is not registered', async () => {
    api.login.mockRejectedValue({ code: 'citizen_not_registered' })
    page()
    fireEvent.change(screen.getByLabelText('citizen.phone'), { target: { value: '01999000111' } })
    fireEvent.change(screen.getByLabelText('citizen.pin'), { target: { value: '0111' } })
    fireEvent.click(screen.getByRole('button', { name: 'citizen.signIn' }))
    expect(await screen.findByText('ERR citizen.err.citizen_not_registered')).toBeTruthy()
  })

  it('reminds about the default PIN, and the reminder can be dismissed', async () => {
    store.token = 'T'
    api.me.mockResolvedValue(OWNER_ACCOUNT)
    page()
    expect(await screen.findByText('citizen.defaultPin.title')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'citizen.defaultPin.later' }))
    expect(screen.queryByText('citizen.defaultPin.title')).toBeNull()
  })

  it('has only Daily Collection, Complaints and My Profile', async () => {
    store.token = 'T'
    api.me.mockResolvedValue(OWNER_ACCOUNT)
    page()
    await screen.findByText('15/B')
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs).toEqual(['citizen.tab.collection', 'citizen.tab.complaints', 'citizen.tab.profile'])
    fireEvent.click(screen.getByRole('tab', { name: 'citizen.tab.profile' }))
    expect(await screen.findByText('01812990011')).toBeTruthy()
  })

  it('sends a missed-collection complaint for the holding', async () => {
    store.token = 'T'
    api.me.mockResolvedValue(OWNER_ACCOUNT)
    api.complain.mockResolvedValue({ id: 'CMP-1' })
    page()
    fireEvent.click(await screen.findByRole('tab', { name: 'citizen.tab.complaints' }))
    fireEvent.click(await screen.findByRole('button', { name: 'citizen.newComplaint' }))
    fireEvent.click(screen.getByRole('button', { name: 'citizen.form.submit' }))
    await waitFor(() => expect(api.complain).toHaveBeenCalled())
    const body = api.complain.mock.calls[0][0]
    expect(body.holding).toBe('HLD-1')
    expect(body.type).toBe('missed_collection')
    expect(body.missedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(await screen.findByText(/citizen.form.sent/)).toBeTruthy()
  })
})
