import { useMemo, useState, type ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"

/**
 * Table primitive for the configuration screens.
 *
 * Officials asked for tables with search, filtering and inline actions where
 * previously there were card lists that could not be edited. Sorting and
 * filtering happen client-side: barangay-scale collections are hundreds of rows,
 * so paginating server-side would add latency and complexity for no gain.
 */

export interface Column<Row> {
  key: string
  header: string
  /** Cell contents. Keep it presentational — sorting uses `sortValue`. */
  render: (row: Row) => ReactNode
  /** Provide to make the column sortable. */
  sortValue?: (row: Row) => string | number
  /** Right-aligned action columns and the like. */
  align?: "left" | "right"
  /** Hidden below `md`, for columns that do not survive a narrow viewport. */
  hideOnMobile?: boolean
}

export interface FilterChip {
  key: string
  label: string
  /** Count shown on the chip; omit when it would be misleading. */
  count?: number
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = "Search",
  searchValue,
  onSearchChange,
  searchMatches,
  filters,
  activeFilter,
  onFilterChange,
  emptyTitle = "Nothing here yet",
  emptyHint,
  loading = false,
  onRowSelect,
}: {
  rows: readonly Row[]
  columns: readonly Column<Row>[]
  rowKey: (row: Row) => string
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  /** Which fields search should look at. Omit to disable search. */
  searchMatches?: (row: Row, query: string) => boolean
  filters?: readonly FilterChip[]
  activeFilter?: string
  onFilterChange?: (key: string) => void
  emptyTitle?: string
  emptyHint?: string
  loading?: boolean
  onRowSelect?: (row: Row) => void
}) {
  const [internalQuery, setInternalQuery] = useState("")
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null)

  const query = searchValue ?? internalQuery
  const setQuery = onSearchChange ?? setInternalQuery

  const visible = useMemo(() => {
    let result = [...rows]

    const trimmed = query.trim().toLowerCase()
    if (trimmed && searchMatches) {
      result = result.filter((row) => searchMatches(row, trimmed))
    }

    if (sort) {
      const column = columns.find((item) => item.key === sort.key)
      if (column?.sortValue) {
        const direction = sort.direction === "asc" ? 1 : -1
        result.sort((a, b) => {
          const left = column.sortValue!(a)
          const right = column.sortValue!(b)
          if (left === right) return 0
          return (left > right ? 1 : -1) * direction
        })
      }
    }

    return result
  }, [rows, query, searchMatches, sort, columns])

  const toggleSort = (key: string) => {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    )
  }

  return (
    <div className="space-y-3">
      {(searchMatches || filters) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchMatches ? (
            <label className="relative min-w-56 flex-1">
              <span className="sr-only">{searchPlaceholder}</span>
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-panel border border-card-line bg-card py-2.5 pl-9 pr-3 text-sm font-medium text-foreground outline-none transition placeholder:text-muted-foreground focus:border-brand-orange"
              />
            </label>
          ) : null}

          {filters?.map((chip) => {
            const active = activeFilter === chip.key
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => onFilterChange?.(chip.key)}
                aria-pressed={active}
                className={
                  active
                    ? "inline-flex items-center gap-1.5 rounded-full bg-brand-navy px-3 py-1.5 text-xs font-bold text-white"
                    : "inline-flex items-center gap-1.5 rounded-full border border-card-line bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-tint"
                }
              >
                {chip.label}
                {typeof chip.count === "number" ? (
                  <span className={active ? "opacity-80" : "text-muted-foreground"}>{chip.count}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-panel border border-card-line bg-card">
        <table className="w-full min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-card-line">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort?.key === column.key
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  className={`px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground ${
                    column.align === "right" ? "text-right" : ""
                  } ${column.hideOnMobile ? "hidden md:table-cell" : ""}`}
                >
                  {column.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 transition hover:text-foreground"
                    >
                      {column.header}
                      {sort?.key === column.key ? (
                        sort.direction === "asc" ? (
                          <ArrowUpIcon className="size-3" aria-hidden />
                        ) : (
                          <ArrowDownIcon className="size-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              // Skeleton rows rather than a spinner: the table does not jump
              // when the data lands.
              Array.from({ length: 4 }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="border-b border-card-line last:border-0">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-4 ${column.hideOnMobile ? "hidden md:table-cell" : ""}`}
                    >
                      <span className="block h-3 w-24 animate-pulse rounded-full bg-chart-track" />
                    </td>
                  ))}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <p className="text-sm font-bold text-foreground">{emptyTitle}</p>
                  {emptyHint ? (
                    <p className="mt-1 text-sm font-medium text-muted-foreground">{emptyHint}</p>
                  ) : null}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowSelect ? () => onRowSelect(row) : undefined}
                  className={`border-b border-card-line last:border-0 ${
                    onRowSelect ? "cursor-pointer transition hover:bg-tint" : ""
                  }`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 text-sm text-foreground ${
                        column.align === "right" ? "text-right" : ""
                      } ${column.hideOnMobile ? "hidden md:table-cell" : ""}`}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && visible.length > 0 ? (
        <p className="text-xs font-medium text-muted-foreground">
          {visible.length === rows.length
            ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}`
            : `${visible.length} of ${rows.length} shown`}
        </p>
      ) : null}
    </div>
  )
}
