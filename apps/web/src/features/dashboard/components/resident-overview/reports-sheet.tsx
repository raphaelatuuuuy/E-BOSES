import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheck,
  InboxIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import {
  listMyConcerns,
  type Concern,
} from "@/features/dashboard/api"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { filters } from "@/features/dashboard/components/concerns/concern-display"
import {
  filterResidentReports,
  searchResidentReports,
} from "@/features/dashboard/components/concerns/resident-reports-workspace"
import { OverviewReportRow } from "@/features/dashboard/components/resident-overview/report-rows"

const REPORTS_PER_PAGE = 4

export function OverviewReportsSheet({
  open,
  onClose,
  onSelectReport,
  loadReports = listMyConcerns,
  title = "My Reports",
  description = "Every concern you submitted.",
}: {
  open: boolean
  onClose: () => void
  onSelectReport?: (post: Concern) => void
  loadReports?: () => Promise<Concern[]>
  title?: string
  description?: string
}) {
  const navigate = useNavigate()
  const [reports, setReports] = useState<Concern[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [activeFilter, setActiveFilter] = useState<string>("All")
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState("1")
  const [filterOpen, setFilterOpen] = useState(false)
  const searchRowRef = useRef<HTMLDivElement>(null)
  const [panelBox, setPanelBox] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setSearch("")
    setActiveFilter("All")
    setPage(1)
    setPageInput("1")
    setFilterOpen(false)
    void loadReports()
      .then((next) => {
        if (!cancelled) setReports(next)
      })
      .catch(() => {
        if (!cancelled) setReports([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadReports, open])

  useEffect(() => {
    if (!filterOpen) {
      setPanelBox(null)
      return
    }
    function place() {
      const row = searchRowRef.current?.getBoundingClientRect()
      if (!row) return
      const top = row.bottom + 8
      setPanelBox({
        top,
        left: row.left,
        width: row.width,
        maxHeight: Math.max(Math.min(110, window.innerHeight - top - 16), 48),
      })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [filterOpen])

  const visible = useMemo(
    () =>
      searchResidentReports(
        filterResidentReports(reports, activeFilter),
        search
      ),
    [reports, activeFilter, search]
  )

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const filter of filters)
      map[filter] = filterResidentReports(reports, filter).length
    return map
  }, [reports])

  const pageCount = Math.max(1, Math.ceil(visible.length / REPORTS_PER_PAGE))
  const currentPage = Math.min(page, pageCount)
  const pageReports = visible.slice(
    (currentPage - 1) * REPORTS_PER_PAGE,
    currentPage * REPORTS_PER_PAGE
  )

  function goToPage(nextPage: number) {
    const next = Math.min(Math.max(nextPage, 1), pageCount)
    setPage(next)
    setPageInput(String(next))
  }

  function commitPageInput(value: string) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      goToPage(parsed)
    } else {
      setPageInput(String(currentPage))
    }
  }

  function openReport(post: Concern) {
    if (onSelectReport) {
      onSelectReport(post)
      return
    }
    onClose()
    navigate(`/dashboard/reports/${post.public_id ?? post.id}`)
  }

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="wide"
      draggable
    >
      <div className="sticky top-0 bg-white pt-1 pb-3">
        <div ref={searchRowRef} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFilterOpen((value) => !value)}
            aria-label={filterOpen ? "Hide filters" : "Show filters"}
            aria-expanded={filterOpen}
            aria-pressed={filterOpen}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200"
          >
            <SlidersHorizontalIcon className="size-5" aria-hidden="true" />
          </button>
          <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-neutral-100 pr-4 pl-4">
            <SearchIcon
              className="size-5 shrink-0 text-neutral-500"
              aria-hidden="true"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search my reports"
              aria-label="Search my reports"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </label>
        </div>
      </div>
      {filterOpen && panelBox
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setFilterOpen(false)}
                className="fixed inset-0 z-[500] cursor-default bg-transparent"
              />
              <div
                role="listbox"
                aria-label="Report status filters"
                style={{
                  top: panelBox.top,
                  left: panelBox.left,
                  width: panelBox.width,
                  maxHeight: panelBox.maxHeight,
                }}
                className="fixed z-[501] overflow-y-auto overscroll-contain rounded-[20px] bg-white p-1.5 pb-3 shadow-lg ring-1 ring-neutral-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {filters.map((filter) => {
                  const selected = activeFilter === filter
                  return (
                    <button
                      key={filter}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setActiveFilter(filter)
                        setFilterOpen(false)
                        goToPage(1)
                      }}
                      className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">
                        {filter}
                      </span>
                      {!selected && filter !== "All" ? (
                        <span className="text-[13px] tabular-nums text-neutral-500">
                          {counts[filter] ?? 0}
                        </span>
                      ) : null}
                      {selected ? (
                        <CircleCheck
                          className="size-4 shrink-0 text-green-600"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </>,
            document.body
          )
        : null}
      {loading ? (
        <div className="flex flex-col gap-2.5 py-2" aria-label="Loading reports">
          {Array.from({ length: 3 }).map((_, i) => (
            <span
              key={i}
              className="h-[76px] animate-pulse rounded-xl bg-neutral-100"
            />
          ))}
        </div>
      ) : visible.length > 0 ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            {pageReports.map((post) => (
              <div
                key={post.id}
                className="border-b border-neutral-100 px-4 last:border-b-0"
              >
                <OverviewReportRow
                  post={post}
                  onOpen={openReport}
                  showDivider={false}
                />
              </div>
            ))}
          </div>
          {pageCount > 1 ? (
            <nav
              aria-label="Report pages"
              className="mt-3 flex items-center justify-between gap-3"
            >
              <button
                type="button"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage === 1}
                className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:text-neutral-300"
              >
                <ChevronLeftIcon className="size-4" aria-hidden="true" />
                Prev
              </button>
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-500">
                <input
                  value={pageInput}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9]/g, "")
                    setPageInput(value)
                    const parsed = Number.parseInt(value, 10)
                    if (Number.isFinite(parsed)) goToPage(parsed)
                  }}
                  onBlur={() => commitPageInput(pageInput)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitPageInput(pageInput)
                  }}
                  inputMode="numeric"
                  aria-label="Current report page"
                  className="h-8 w-10 rounded-lg border border-neutral-200 bg-white text-center text-[13px] font-semibold tabular-nums text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                />
                <span>of {pageCount}</span>
              </label>
              <button
                type="button"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage === pageCount}
                className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:text-neutral-300"
              >
                Next
                <ChevronRightIcon className="size-4" aria-hidden="true" />
              </button>
            </nav>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col items-center py-10 text-center">
          {reports.length === 0 ? (
            <InboxIcon
              className="size-8 text-neutral-300"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          ) : (
            <SearchIcon
              className="size-8 text-neutral-300"
              strokeWidth={1.8}
              aria-hidden="true"
            />
          )}
          <p className="mt-3 text-[14px] text-neutral-500">
            {reports.length === 0
              ? "No reports yet. Concerns you submit appear here."
              : "No reports match this search."}
          </p>
        </div>
      )}
    </SheetDialog>
  )
}
