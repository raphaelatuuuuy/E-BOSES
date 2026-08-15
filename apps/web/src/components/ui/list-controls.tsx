import { useRef, type ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"

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
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
        >
          <XIcon className="size-4" strokeWidth={2} aria-hidden />
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
  children,
}: {
  options: { key: string; label: string }[]
  value: string
  onChange: (key: string) => void
  className?: string
  children?: ReactNode
}) {
  const scrollRef = useWheelScroll<HTMLDivElement>()

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex items-center gap-7 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          className={cn(
            "shrink-0 text-read transition-colors",
            value === option.key
              ? "font-medium text-brand-navy"
              : "text-neutral-400 hover:text-brand-navy",
          )}
        >
          {option.label}
        </button>
      ))}
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
}: {
  offset: number
  total: number
  pageSize?: number
  onChange: (next: number) => void
  noun?: string
}) {
  if (total === 0) return null
  const first = offset + 1
  const last = Math.min(offset + pageSize, total)
  const atStart = offset === 0
  const atEnd = offset + pageSize >= total

  return (
    <div className="mt-8 flex items-center justify-between gap-4 border-t border-neutral-200 pt-5">
      <p className="text-meta text-neutral-500 tabular-nums">
        {first}–{last} of {total.toLocaleString()} {noun}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, offset - pageSize))}
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
          onClick={() => onChange(offset + pageSize)}
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
