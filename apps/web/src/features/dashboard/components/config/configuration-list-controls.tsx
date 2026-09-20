import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  SlidersHorizontalIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useSheetDialogFooter } from "@/features/dashboard/components/sheet-dialog"

export interface ConfigurationFilter {
  key: string
  label: string
  count?: number
}

export const CONFIGURATION_PAGE_SIZE = 4

/** The same filter/search row used by the overview's View all report sheet. */
export function ConfigurationListToolbar({
  search,
  onSearch,
  placeholder,
  filters,
  activeFilter,
  onFilter,
  trailing,
}: {
  search: string
  onSearch: (value: string) => void
  placeholder: string
  filters: ConfigurationFilter[]
  activeFilter: string
  onFilter: (value: string) => void
  trailing?: ReactNode
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const searchRowRef = useRef<HTMLDivElement>(null)
  const [panelBox, setPanelBox] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!filterOpen) {
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
        maxHeight: Math.max(Math.min(240, window.innerHeight - top - 16), 96),
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

  const selected = filters.find((filter) => filter.key === activeFilter)

  return (
    <div className="sticky top-0 z-20 bg-white pb-3 pt-1">
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
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-neutral-100 px-4">
          <SearchIcon className="size-5 shrink-0 text-neutral-500" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
          />
        </label>
        {trailing}
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
                aria-label="Configuration filters"
                style={{ top: panelBox.top, left: panelBox.left, width: panelBox.width, maxHeight: panelBox.maxHeight }}
                className="fixed z-[501] overflow-y-auto overscroll-contain rounded-[20px] bg-white p-1.5 shadow-lg ring-1 ring-neutral-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {filters.map((filter) => {
                  const isSelected = filter.key === activeFilter
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onFilter(filter.key)
                        setFilterOpen(false)
                      }}
                      className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition hover:bg-neutral-50"
                    >
                      <span className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900">{filter.label}</span>
                      {!isSelected && filter.count !== undefined ? <span className="text-[13px] tabular-nums text-neutral-500">{filter.count}</span> : null}
                      {isSelected ? <CheckIcon className="size-4 shrink-0 text-green-600" strokeWidth={2} aria-hidden="true" /> : null}
                    </button>
                  )
                })}
              </div>
            </>,
            document.body,
          )
        : null}

      <span className="sr-only">Showing {selected?.label ?? "all"}</span>
    </div>
  )
}

/** Compact editable pager for sheet lists: ‹ 1 of 3 ›. */
export function ConfigurationPager({
  offset,
  total,
  pageSize = CONFIGURATION_PAGE_SIZE,
  onChange,
  noun = "items",
  className,
  inline = false,
}: {
  offset: number
  total: number
  pageSize?: number
  onChange: (nextOffset: number) => void
  noun?: string
  className?: string
  inline?: boolean
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(Math.floor(Math.max(offset, 0) / pageSize) + 1, pageCount)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const goToPage = useCallback((value: number) => {
    const next = Math.min(Math.max(value, 1), pageCount)
    setPageInput(String(next))
    onChangeRef.current((next - 1) * pageSize)
  }, [pageCount, pageSize])

  const commitPageInput = useCallback((value: string) => {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) goToPage(parsed)
    else setPageInput(String(currentPage))
  }, [currentPage, goToPage])

  const pager = useMemo(() => total > 0 ? (
    <nav
      aria-label={`${noun} pages`}
      className={cn(
        "flex items-center justify-between gap-3 bg-white py-3",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        aria-label="Previous page"
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
          aria-label={`Current ${noun} page`}
          className="h-8 w-10 rounded-lg border border-neutral-200 bg-white text-center text-[13px] font-semibold tabular-nums text-neutral-900 outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
        />
        <span>of {pageCount}</span>
      </label>
      <button
        type="button"
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === pageCount}
        aria-label="Next page"
        className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 disabled:pointer-events-none disabled:text-neutral-300"
      >
        Next
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </button>
    </nav>
  ) : null, [className, commitPageInput, currentPage, goToPage, noun, pageCount, pageInput, total])

  const registered = useSheetDialogFooter(pager, total > 0 && !inline)

  if (total === 0 || registered) return null

  if (inline) return pager

  return (
    <div className="sticky bottom-0 z-20 -mx-1 bg-white/95 backdrop-blur-sm">
      {pager}
    </div>
  )
}
