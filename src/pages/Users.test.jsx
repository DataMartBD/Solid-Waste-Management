import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import Users from './Users.jsx'

// The account register, which is the one page that can lock its own operator
// out of the application. So what these pin is mostly the refusals: the fields
// that must be disabled on your own row, the password box that must not be sent
// empty on an edit, and the buttons that must not be offered for yourself.
//
// They also exist because this page builds fine while being broken — a page
// renders or it does not, and a passing `vite build` says nothing either way.

const list = vi.fn()
const create = vi.fn()
const update = vi.fn()
const deactivate = vi.fn()
const activate = vi.fn()

vi.mock('../api/endpoints.js', () => ({
  users: {
    list: (...a) => list(...a),
    create: (...a) => create(...a),
    update: (...a) => update(...a),
    deactivate: (...a) => deactivate(...a),
    activate: (...a) => activate(...a),
  },
}))

const ME = { id: 1, roleKey: 'agency_admin' }

vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => ({ user: ME }) }))

vi.mock('../context/DataContext.jsx', () => ({
  useData: () => ({
    catalog: {
      wards: [{ id: 'W-14', name: 'Ward 14' }, { id: 'W-21', name: 'Ward 21' }],
      zones: [{ id: 'Z-03', name: 'Sonadanga' }],
      bloodGroups: ['A+', 'O−'],
    },
    agencies: [{ id: 'AGN-1', name: 'Premier Clean' }],
  }),
}))

// One frozen object, not a fresh one per call. `useLang` is memoised in the real
// app, and a mock that hands back a new `t` on every render makes the page's
// `load` callback new on every render too — which turns one fetch into a loop
// and would have these tests failing for a reason the app does not have.
const LANG = {
  t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  n: (v) => String(v),
  date: (v) => String(v),
}
vi.mock('../i18n/index.jsx', () => ({ useLang: () => LANG }))

vi.mock('../components/ExportMenu.jsx', () => ({ ExportMenu: () => null }))

const ROWS = [
  {
    id: 1, name: 'Farhana Haque', phone: '01900445566', role: 'agency_admin',
    roleLabel: 'Agency Admin', scope: 'All zones', scopeKind: 'agency',
    scopeZone: '', scopeWards: [], agency: null, email: '', altPhone: '',
    nid: '', bloodGroup: '', emergencyContact: '', isActive: true,
    lastLogin: '2026-09-14',
  },
  {
    id: 2, name: 'Rafiq Mia', phone: '01711000042', role: 'collector',
    roleLabel: 'Collector', scope: 'Ward 14', scopeKind: 'ward',
    scopeZone: '', scopeWards: ['W-14'], agency: 'AGN-1', email: '',
    altPhone: '', nid: '', bloodGroup: '', emergencyContact: '',
    isActive: true, lastLogin: null,
  },
]

function rowFor(name) {
  return screen.getByText(name).closest('tr')
}

describe('Users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue(ROWS)
    create.mockResolvedValue({ name: 'New Operator' })
    update.mockResolvedValue({ name: 'Rafiq Mia' })
    deactivate.mockResolvedValue({})
    activate.mockResolvedValue({})
  })

  it('lists the accounts', async () => {
    render(<Users />)
    expect(await screen.findByText('Farhana Haque')).toBeInTheDocument()
    expect(screen.getByText('Rafiq Mia')).toBeInTheDocument()
  })

  it('marks an account nobody has ever used', async () => {
    // A wrong number or somebody never told their password — worth seeing.
    render(<Users />)
    await screen.findByText('Rafiq Mia')
    expect(within(rowFor('Rafiq Mia')).getByText('users.neverSignedIn')).toBeInTheDocument()
  })

  it('does not offer to deactivate your own account', async () => {
    // The server refuses it; a button that always errors is worse than none.
    render(<Users />)
    await screen.findByText('Farhana Haque')
    expect(within(rowFor('Farhana Haque')).queryByText('users.deactivate')).toBeNull()
    expect(within(rowFor('Rafiq Mia')).getByText('users.deactivate')).toBeInTheDocument()
  })

  it('creates a user with the password the form was given', async () => {
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))

    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'New Operator' } })
    fireEvent.change(screen.getByLabelText('users.col.phone'), { target: { value: '01911000111' } })
    fireEvent.change(screen.getByLabelText('users.field.password'), { target: { value: 'Kh2-street-sweep' } })
    fireEvent.change(screen.getByLabelText('users.field.scopeKind'), { target: { value: 'city' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const body = create.mock.calls[0][0]
    expect(body.phone).toBe('01911000111')
    expect(body.password).toBe('Kh2-street-sweep')
    expect(body.scopeKind).toBe('city')
  })

  it('sends the ticked wards only while the scope is ward', async () => {
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'Warden' } })
    fireEvent.change(screen.getByLabelText('users.col.phone'), { target: { value: '01911000112' } })
    fireEvent.change(screen.getByLabelText('users.field.password'), { target: { value: 'Kh2-street-sweep' } })
    fireEvent.click(screen.getByLabelText('Ward 14'))
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].scopeWards).toEqual(['W-14'])
  })

  it('drops the ward list when a wider scope is chosen', async () => {
    // Leaving them on would file a city-wide user with a ward list that the
    // server stores and nothing ever reads — a lie in the record.
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'Wide' } })
    fireEvent.change(screen.getByLabelText('users.col.phone'), { target: { value: '01911000113' } })
    fireEvent.change(screen.getByLabelText('users.field.password'), { target: { value: 'Kh2-street-sweep' } })
    fireEvent.click(screen.getByLabelText('Ward 14'))
    fireEvent.change(screen.getByLabelText('users.field.scopeKind'), { target: { value: 'city' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].scopeWards).toEqual([])
  })

  it('omits the password on an edit that left the box empty', async () => {
    // Sending a blank would be a silent lockout.
    render(<Users />)
    await screen.findByText('Rafiq Mia')
    fireEvent.click(within(rowFor('Rafiq Mia')).getByText('common.edit'))
    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'Rafiqul Mia' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(update.mock.calls[0][1]).not.toHaveProperty('password')
    expect(update.mock.calls[0][1].name).toBe('Rafiqul Mia')
  })

  it('locks role and scope when you open your own row', async () => {
    render(<Users />)
    await screen.findByText('Farhana Haque')
    fireEvent.click(within(rowFor('Farhana Haque')).getByText('common.edit'))

    expect(screen.getByLabelText('users.col.role')).toBeDisabled()
    expect(screen.getByLabelText('users.field.scopeKind')).toBeDisabled()
    expect(screen.getByText('users.ownAccessLocked')).toBeInTheDocument()
    // Contact details are still yours to fix.
    expect(screen.getByLabelText('users.col.email')).not.toBeDisabled()
  })

  it('does not send your own role back at all', async () => {
    render(<Users />)
    await screen.findByText('Farhana Haque')
    fireEvent.click(within(rowFor('Farhana Haque')).getByText('common.edit'))
    fireEvent.change(screen.getByLabelText('users.col.email'), { target: { value: 'f@kcc.gov.bd' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(update).toHaveBeenCalled())
    const body = update.mock.calls[0][1]
    expect(body).not.toHaveProperty('role')
    expect(body).not.toHaveProperty('scopeKind')
    expect(body.email).toBe('f@kcc.gov.bd')
  })

  it('locks the phone number on an edit, because it is the sign-in name', async () => {
    render(<Users />)
    await screen.findByText('Rafiq Mia')
    fireEvent.click(within(rowFor('Rafiq Mia')).getByText('common.edit'))
    expect(screen.getByLabelText('users.col.phone')).toBeDisabled()
  })

  it('shows a field error against the field the server named', async () => {
    create.mockRejectedValue({ fields: { phone: ['This field must be unique.'] },
      fieldError: (n) => ({ phone: 'This field must be unique.' }[n]) })
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'Clash' } })
    fireEvent.change(screen.getByLabelText('users.col.phone'), { target: { value: '01911000111' } })
    fireEvent.change(screen.getByLabelText('users.field.password'), { target: { value: 'Kh2-street-sweep' } })
    fireEvent.change(screen.getByLabelText('users.field.scopeKind'), { target: { value: 'city' } })
    fireEvent.click(screen.getByText('common.save'))

    expect(await screen.findByText('This field must be unique.')).toBeInTheDocument()
  })

  it('does not offer the super-admin role to an agency admin', async () => {
    // The escalation this form could otherwise hand out: make an unconfined
    // account, sign in as it, and the agency boundary is gone. The server
    // refuses it either way — the option is simply not there.
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    const roles = within(screen.getByLabelText('users.col.role'))
    expect(roles.queryByText('users.role.super_admin')).toBeNull()
    expect(roles.getByText('users.role.agency_admin')).toBeInTheDocument()
  })

  it('offers it to a super admin', async () => {
    ME.roleKey = 'super_admin'
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    expect(
      within(screen.getByLabelText('users.col.role')).getByText('users.role.super_admin'),
    ).toBeInTheDocument()
    ME.roleKey = 'agency_admin'
  })

  it('locks the agency box once the role is super admin', async () => {
    // A super admin with an agency would be confined by a contractor they do
    // not answer to, so the field is not merely ignored — it is closed.
    ME.roleKey = 'super_admin'
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    expect(screen.getByLabelText('users.field.agency')).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('users.col.role'), { target: { value: 'super_admin' } })
    expect(screen.getByLabelText('users.field.agency')).toBeDisabled()
    ME.roleKey = 'agency_admin'
  })

  it('clears a previously chosen agency when the role becomes super admin', async () => {
    // Otherwise promoting an agency admin would carry their old agency along
    // and the save would be refused for a field nobody could see.
    ME.roleKey = 'super_admin'
    render(<Users />)
    fireEvent.click(await screen.findByText('users.add'))
    fireEvent.change(screen.getByLabelText('users.col.name'), { target: { value: 'City Admin' } })
    fireEvent.change(screen.getByLabelText('users.col.phone'), { target: { value: '01911000114' } })
    fireEvent.change(screen.getByLabelText('users.field.password'), { target: { value: 'Kh2-street-sweep' } })
    fireEvent.change(screen.getByLabelText('users.field.scopeKind'), { target: { value: 'city' } })
    fireEvent.change(screen.getByLabelText('users.field.agency'), { target: { value: 'AGN-1' } })
    fireEvent.change(screen.getByLabelText('users.col.role'), { target: { value: 'super_admin' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].agency).toBeNull()
    expect(create.mock.calls[0][0].role).toBe('super_admin')
    ME.roleKey = 'agency_admin'
  })

  it('deactivates from the row and reloads', async () => {
    render(<Users />)
    await screen.findByText('Rafiq Mia')
    fireEvent.click(within(rowFor('Rafiq Mia')).getByText('users.deactivate'))
    await waitFor(() => expect(deactivate).toHaveBeenCalledWith(2))
    expect(list).toHaveBeenCalledTimes(2)
  })
})
