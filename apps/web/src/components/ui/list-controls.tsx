import { useEffect, useRef, useState, type ReactNode } from "react"
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The controls every configuration list shares: a search box, a row of filters
 * and a pager.
 *
 * They live here rather than in each screen because they were drifting — one
 * page tinted its focus ring, another boxed its filters into pills, a third
 * showed every row it had. A list of two hundred things is not more useful than
 * a list of ten; it is just longer.
 */

export const PAGE_SIZE = 10

/** Search with a clear button, matching the Help Center. */
export function ListSearch({
  value,
  onChange,
  placeholder = "Search",
  label = "Search this list",
  className,
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  label?: string
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn("flex min-w-[220px] items-center gap-3 border-b border-neutral-200", className)}>
      <SearchIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={1.8} aria-hidden />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full bg-transparent py-2 text-read text-brand-navy outline-none placeholder:text-neutral-400"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("")
            inputRef.current?.focus()
          }}
          aria-label="Clear the search"
          className="flex shrink-0 items-center justify-center text-neutral-400 transition-colors hover:text-brand-navy"
        >
          <XIcon className="size-5" strokeWidth={1.8} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/**
 * One line of filters that scrolls sideways when it runs out of room, instead
 * of wrapping into a second and third line that push the list down the page.
 */
export function FilterRow({
  options,
  value,
  onChange,
  className,
  counts,
  details,
  children,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
  className?: string
  counts?: Record<string, number>
  /** Full names that morph in over the short label on hover or when active. */
  details?: Record<string, string>
  children?: ReactNode
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  return (
    <div className={cn("flex flex-wrap items-center gap-x-7 gap-y-3", className)}>
      {options.map((option) => {
        const full = details?.[option.key]
        const showFull = !!full && (hoverKey === option.key || value === option.key)
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            onMouseEnter={() => setHoverKey(option.key)}
            onMouseLeave={() => setHoverKey((k) => (k === option.key ? null : k))}
            className={cn(
              "flex shrink-0 items-center whitespace-nowrap text-read transition-colors",
              value === option.key
                ? "font-medium text-brand-navy"
                : "text-neutral-400 hover:text-brand-navy",
            )}
          >
            {full ? (
              <>
                <span
                  className={cn(
                    "grid transition-[grid-template-columns] duration-300 ease-out",
                    showFull ? "grid-cols-[0fr]" : "grid-cols-[1fr]",
                  )}
                >
                  <span
                    className={cn(
                      "overflow-hidden transition-all duration-300 ease-out",
                      showFull ? "-translate-x-1 opacity-0" : "translate-x-0 opacity-100",
                    )}
                  >
                    {option.label}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid transition-[grid-template-columns] duration-300 ease-out",
                    showFull ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
                  )}
                >
                  <span
                    className={cn(
                      "overflow-hidden transition-all duration-300 ease-out",
                      showFull ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0",
                    )}
                  >
                    {full}
                  </span>
                </span>
              </>
            ) : (
              option.label
            )}
            {counts && option.key in counts && (
              <span className="ml-1.5 tabular-nums text-neutral-400">{counts[option.key]}</span>
            )}
          </button>
        )
      })}
      {children}
    </div>
  )
}

/** Checkmarked dropdown used when a configuration filter has too many values for a FilterRow. */
export function ListDropdown({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string; description?: string }>
  onChange: (value: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <span className="mb-1.5 block text-meta font-medium text-neutral-500">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-left text-read text-neutral-900 transition-colors hover:border-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/20"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "Choose"}</span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} strokeWidth={1.8} aria-hidden />
      </button>
      {open ? (
        <div role="listbox" aria-label={label} className="absolute z-40 mt-2 max-h-64 w-full min-w-56 overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-[0_18px_45px_rgba(15,23,42,0.12)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => { onChange(option.value); setOpen(false) }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-neutral-50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-read font-medium text-neutral-900">{option.label}</span>
                {option.description ? <span className="mt-0.5 block text-meta text-neutral-500">{option.description}</span> : null}
              </span>
              {option.value === value ? <CheckIcon className="size-4 shrink-0 text-accent" strokeWidth={2.2} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Pager({
  offset,
  total,
  pageSize = PAGE_SIZE,
  onChange,
  noun = "entries",
  className,
}: {
  offset: number
  total: number
  pageSize?: number
  onChange: (next: number) => void
  noun?: string
  className?: string
}) {
  if (total === 0) return null
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const maxOffset = (pageCount - 1) * pageSize
  const safeOffset = Math.min(Math.max(offset, 0), maxOffset)
  const currentPage = Math.floor(safeOffset / pageSize) + 1
  const [pageInput, setPageInput] = useState(String(currentPage))
  const [prevPage, setPrevPage] = useState(currentPage)
  if (prevPage !== currentPage) {
    setPrevPage(currentPage)
    setPageInput(String(currentPage))
  }

  function goToPage(value: number) {
    const next = Math.min(Math.max(value, 1), pageCount)
    setPageInput(String(next))
    onChange((next - 1) * pageSize)
  }

  return (
    <div className={cn("mt-8 flex items-center justify-between gap-3 border-t border-neutral-200 pt-5", className)}>
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
          onBlur={() => {
            const parsed = Number.parseInt(pageInput, 10)
            setPageInput(Number.isFinite(parsed) ? String(Math.min(Math.max(parsed, 1), pageCount)) : String(currentPage))
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              const parsed = Number.parseInt(pageInput, 10)
              if (Number.isFinite(parsed)) goToPage(parsed)
              else setPageInput(String(currentPage))
            }
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
    </div>
  )
}
