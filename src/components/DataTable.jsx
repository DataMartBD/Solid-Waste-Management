import { useMemo, useState } from 'react'
import {
  useTable,
  tableFeatures,
  flexRender,
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  createSortedRowModel,
  createFilteredRowModel,
  createPaginatedRowModel,
  sortFns,
  filterFns,
} from '@tanstack/react-table'
import { IconSearch } from './Icons.jsx'
import { useLang } from '../i18n/index.jsx'

// One table for the register screens.
//
// The pages used to hand-roll `<table class="data">` with their own sorting and
// filtering, which meant every list sorted slightly differently and none of them
// paged. TanStack owns that behaviour now; this component owns the markup, so
// the tables still look like the rest of the product.
//
// Only what the screens actually use is switched on — sorting, a global search,
// per-column filters and pagination. TanStack v9 makes features opt-in, so an
// unused one costs nothing.

// v9 stitches the row models and the sort/filter registries into the feature
// object itself, rather than passing them per table.
const FEATURES = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns,
  filterFns,
})

const PAGE_SIZES = [10, 25, 50, 100]

export default function DataTable({
  columns,
  data,
  // Rows the caller supplies before the server has answered.
  loading = false,
  empty = null,
  // A whole-table search box. Passing `false` hides it, for a page that already
  // has its own toolbar.
  search = true,
  searchPlaceholder,
  pageSize = 25,
  // Called with the row's original object. Makes the whole row a target, which
  // is how the registers are actually used — click the building, see inside it.
  onRowClick = null,
  rowKey = (row) => row.id,
  // Extra controls rendered beside the search box.
  toolbar = null,
}) {
  const { t, n } = useLang()
  const [globalFilter, setGlobalFilter] = useState('')
  const [sorting, setSorting] = useState([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize })

  const table = useTable({
    features: FEATURES,
    columns,
    data,
    state: { globalFilter, sorting, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  })

  const rows = table.getRowModel().rows
  const total = table.getFilteredRowModel().rows.length
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize))
  const first = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const last = Math.min(total, (pagination.pageIndex + 1) * pagination.pageSize)

  return (
    <div className="card">
      {(search || toolbar) && (
        <div className="row gap-8 wrap dt-toolbar">
          {search && (
            <div className="chip-input">
              <IconSearch size={16} />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder || t('table.search')}
                aria-label={searchPlaceholder || t('table.search')}
              />
            </div>
          )}
          {toolbar}
          <div className="grow" />
          <span className="tiny muted">{t('common.shown', { count: n(total) })}</span>
        </div>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort()
                  const direction = header.column.getIsSorted()
                  return (
                    <th key={header.id} style={{ width: header.column.columnDef.meta?.width }}>
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          className="dt-sort"
                          onClick={header.column.getToggleSortingHandler()}
                          // The header says what a click will do, which a bare
                          // arrow does not — this is the only cue a screen
                          // reader gets.
                          aria-label={t(
                            direction === 'asc' ? 'table.sortedAsc'
                              : direction === 'desc' ? 'table.sortedDesc'
                                : 'table.sortBy',
                            { column: String(header.column.columnDef.header ?? header.id) },
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span className={`dt-arrow${direction ? ' on' : ''}`}>
                            {direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row.original)}
                className={onRowClick ? 'dt-row-link' : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <td
                    key={cell.id}
                    // A cell that holds its own buttons must not also fire the
                    // row's click, or opening a menu would navigate away.
                    onClick={cell.column.columnDef.meta?.stopClick
                      ? (e) => e.stopPropagation()
                      : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <div className="muted small" style={{ padding: 16 }}>{t('common.loading')}</div>}
      {!loading && total === 0 && empty}

      {total > pagination.pageSize && (
        <div className="row gap-8 wrap dt-pager">
          <span className="tiny muted">
            {t('table.range', { first: n(first), last: n(last), total: n(total) })}
          </span>
          <div className="grow" />
          <select
            className="select"
            style={{ width: 'auto' }}
            value={pagination.pageSize}
            onChange={(e) => setPagination((p) => ({ ...p, pageIndex: 0, pageSize: Number(e.target.value) }))}
            aria-label={t('table.perPage')}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{t('table.perPageN', { count: n(size) })}</option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            {t('table.prev')}
          </button>
          <span className="tiny muted">
            {t('table.page', { page: n(pagination.pageIndex + 1), pages: n(pageCount) })}
          </span>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            {t('table.next')}
          </button>
        </div>
      )}
    </div>
  )
}

// A convenience for the common "sortable text column" case, so pages declare
// columns as data rather than as objects with the same three keys each time.
export function useColumns(build, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(build, deps)
}
