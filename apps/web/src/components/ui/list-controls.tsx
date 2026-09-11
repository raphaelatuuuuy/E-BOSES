import { useRef, useState, type ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"

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

/** Ten rows at a time, with a plain statement of where you are. */
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
  const maxOffset = Math.floor((total - 1) / pageSize) * pageSize
  const safeOffset = Math.min(Math.max(offset, 0), maxOffset)
  const first = safeOffset + 1
  const last = Math.min(safeOffset + pageSize, total)
  const atStart = safeOffset === 0
  const atEnd = safeOffset + pageSize >= total

  return (
    <div className={cn("mt-8 flex items-center justify-between gap-4 border-t border-neutral-200 pt-5", className)}>
      <p className="text-meta text-neutral-500 tabular-nums">
        {first}–{last} of {total.toLocaleString()} {noun}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, safeOffset - pageSize))}
          disabled={atStart}
          aria-label="Previous page"
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors",
            atStart
              ? "text-neutral-300"
              : "text-neutral-500 hover:bg-neutral-100 hover:text-brand-navy",
          )}
        >
          <ChevronLeftIcon className="size-5" strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(maxOffset, safeOffset + pageSize))}
          disabled={atEnd}
          aria-label="Next page"
          className={cn(
            "flex size-9 items-center justify-center rounded-lg transition-colors",
            atEnd ? "text-neutral-300" : "text-neutral-500 hover:bg-neutral-100 hover:text-brand-navy",
          )}
        >
          <ChevronRightIcon className="size-5" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  )
}
