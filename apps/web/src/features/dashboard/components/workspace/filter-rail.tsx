import { useCallback, useEffect, useRef, useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { FilterChip } from "@/features/dashboard/components/record/filter-chip"

/**
 * The queue filter rail, shared by Emergencies and Concerns.
 *
 * Both consoles had their own chip row and both were only scrollable by touch.
 * On a desktop with a wheel mouse and no horizontal trackpad gesture, any chip
 * past the pane's width was unreachable — which is how the Concerns rail could
 * hide "Appealed" and "All" behind a 340px pane with no affordance saying so.
 *
 * Three things this fixes and the page-level markup did not:
 *
 * 1. **A vertical wheel scrolls it horizontally.** `preventDefault` is called
 *    only when the rail can actually move that direction, so at either end the
 *    wheel falls through to the pane and the page still scrolls.
 * 2. **Edge fades show where content is hidden**, and only on the side that has
 *    any, so a rail that fits shows no decoration at all.
 * 3. **Arrow keys move between chips**, since a `tablist` that can only be
 *    reached by pointer is not reachable by everyone.
 */

export interface FilterRailOption {
  /** Stable key and the chip's visible text. */
  label: string
  count?: number
}

export function FilterRail({
  options,
  active,
  onSelect,
  ariaLabel,
  className,
}: {
  options: readonly FilterRailOption[]
  active: string
  onSelect: (label: string) => void
  ariaLabel: string
  className?: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const node = scrollerRef.current
    if (!node) return
    // 1px of slack: sub-pixel layout means scrollLeft rarely lands exactly on
    // the maximum, and a permanently-lit fade is worse than none.
    const maxScroll = node.scrollWidth - node.clientWidth
    setOverflow({
      start: node.scrollLeft > 1,
      end: maxScroll > 1 && node.scrollLeft < maxScroll - 1,
    })
  }, [])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [measure, options])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node) return

    function onWheel(event: WheelEvent) {
      const el = scrollerRef.current
      if (!el) return
      // A trackpad's horizontal gesture already works; only translate a wheel
      // that is predominantly vertical.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 1) return
      const next = el.scrollLeft + event.deltaY
      // At either end, let the event through so the pane keeps scrolling.
      if ((event.deltaY < 0 && el.scrollLeft <= 0) || (event.deltaY > 0 && el.scrollLeft >= maxScroll)) {
        return
      }
      event.preventDefault()
      el.scrollLeft = Math.max(0, Math.min(maxScroll, next))
    }

    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  function focusChip(index: number) {
    const node = scrollerRef.current
    if (!node) return
    const chips = node.querySelectorAll<HTMLButtonElement>("[data-filter-chip]")
    const target = chips[Math.max(0, Math.min(chips.length - 1, index))]
    target?.focus()
    target?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusChip(index + 1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusChip(index - 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusChip(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusChip(options.length - 1)
    }
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      {overflow.start ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-canvas to-transparent"
        />
      ) : null}
      {overflow.end ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-canvas to-transparent"
        />
      ) : null}

      <div
        ref={scrollerRef}
        onScroll={measure}
        role="tablist"
        aria-label={ariaLabel}
        className="scrollbar-hide -mx-1 flex min-w-0 overflow-x-auto overscroll-x-contain border-b border-card-line px-1 touch-pan-x [-webkit-overflow-scrolling:touch]"
      >
        {options.map((option, index) => (
          <FilterChip
            key={option.label}
            label={option.label}
            active={active === option.label}
            count={option.count}
            data-filter-chip=""
            role="tab"
            tabIndex={active === option.label ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onSelect(option.label)}
          />
        ))}
      </div>
    </div>
  )
}
