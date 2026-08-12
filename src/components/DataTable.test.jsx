import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import DataTable from './DataTable.jsx'

// The registers all render through this one component, so a mistake here is a
// mistake on every list at once. These pin the behaviour the pages rely on —
// and they are the reason the TanStack v9 wiring is known to work rather than
// assumed to: v9 moved the row models and sort/filter registries inside
// `tableFeatures`, and a wrong shape there fails at render, not at build.

vi.mock('../i18n/index.jsx', () => ({
  useLang: () => ({
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    n: (v) => String(v),
  }),
}))

const ROWS = [
  { id: 'HLD-3', holdingNo: '102/A', owner: 'Shahida Khatun', families: 3 },
  { id: 'HLD-1', holdingNo: '14/58', owner: 'Abdul Karim', families: 1 },
  { id: 'HLD-2', holdingNo: '77', owner: 'Bilkis Ara', families: 12 },
]

const COLUMNS = [
  { accessorKey: 'holdingNo', header: 'Holding no.' },
  { accessorKey: 'owner', header: 'Owner' },
  { accessorKey: 'families', header: 'Families' },
]

function bodyRows() {
  const table = screen.getByRole('table')
  const body = table.querySelectorAll('tbody tr')
  return [...body].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
}

describe('DataTable', () => {
  it('renders every row and column it is given', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} />)
    expect(bodyRows()).toEqual([
      ['102/A', 'Shahida Khatun', '3'],
      ['14/58', 'Abdul Karim', '1'],
      ['77', 'Bilkis Ara', '12'],
    ])
  })

  it('sorts holding numbers the way a person reads them', () => {
    // Numeric-aware, not plain string order: 14/58 before 77 before 102/A.
    // A byte-wise sort would put 102/A first, which is wrong for a street.
    render(<DataTable columns={COLUMNS} data={ROWS} />)
    // Every header is sortable, so pick the first rather than assuming one.
    fireEvent.click(screen.getAllByRole('button', { name: /table.sortBy/ })[0])
    expect(bodyRows().map((r) => r[0])).toEqual(['14/58', '77', '102/A'])
  })

  it('reverses the order on a second click', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} />)
    const owner = screen.getAllByRole('button', { name: /table.sortBy/ })[1]
    fireEvent.click(owner)
    expect(bodyRows().map((r) => r[1])).toEqual(['Abdul Karim', 'Bilkis Ara', 'Shahida Khatun'])
    fireEvent.click(screen.getByRole('button', { name: /table.sortedAsc/ }))
    expect(bodyRows().map((r) => r[1])).toEqual(['Shahida Khatun', 'Bilkis Ara', 'Abdul Karim'])
  })

  it('filters every column from the one search box', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Bilkis' } })
    expect(bodyRows()).toEqual([['77', 'Bilkis Ara', '12']])
  })

  it('finds a row by any column, not just the first', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '14/58' } })
    expect(bodyRows()).toEqual([['14/58', 'Abdul Karim', '1']])
  })

  it('shows the empty state when a search matches nothing', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} empty={<div>nothing here</div>} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzz' } })
    expect(bodyRows()).toEqual([])
    expect(screen.getByText('nothing here')).toBeInTheDocument()
  })

  it('pages once there are more rows than fit', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `H-${i}`, holdingNo: String(i), owner: `Owner ${i}`, families: 1,
    }))
    render(<DataTable columns={COLUMNS} data={many} pageSize={5} />)
    expect(bodyRows()).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: 'table.next' }))
    expect(bodyRows()[0][1]).toBe('Owner 5')
  })

  it('does not page when everything fits', () => {
    render(<DataTable columns={COLUMNS} data={ROWS} pageSize={25} />)
    expect(screen.queryByRole('button', { name: 'table.next' })).not.toBeInTheDocument()
  })

  it('opens a row when the row is clicked', () => {
    const onRowClick = vi.fn()
    render(<DataTable columns={COLUMNS} data={ROWS} onRowClick={onRowClick} />)
    fireEvent.click(screen.getByText('Bilkis Ara'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[2])
  })

  it('lets a cell keep its own clicks to itself', () => {
    // Without this, opening a row menu would also navigate away from the row.
    const onRowClick = vi.fn()
    const withAction = [
      ...COLUMNS,
      {
        id: 'actions',
        header: '',
        meta: { stopClick: true },
        cell: () => <button type="button">Edit</button>,
      },
    ]
    render(<DataTable columns={withAction} data={ROWS} onRowClick={onRowClick} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('renders a custom cell', () => {
    const columns = [
      { accessorKey: 'holdingNo', header: 'Holding no.' },
      {
        id: 'badge',
        header: 'Service',
        cell: ({ row }) => <span className="badge">{row.original.families} families</span>,
      },
    ]
    render(<DataTable columns={columns} data={ROWS} />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('12 families')).toBeInTheDocument()
  })
})
