import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"

export function FeedFilterBar({
  filters,
  activeFilter,
  visibleFilterStart,
  filterPageSize,
  onSelect,
  onMove,
}: {
  filters: readonly string[]
  activeFilter: string
  visibleFilterStart: number
  filterPageSize: number
  onSelect: (f: string) => void
  onMove: (dir: -1 | 1) => void
}) {
  const maxStart = Math.max(0, filters.length - filterPageSize)
  const actualStart = Math.min(visibleFilterStart, maxStart)
  const visible = filters.slice(actualStart, actualStart + filterPageSize)

  return (
    <div className="mt-7">
      <div className="flex w-full min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={actualStart === 0}
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white text-[#07145f] transition-colors hover:text-[#ff6a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a1a]/30 disabled:cursor-default disabled:opacity-35 lg:hidden"
          aria-label="Show previous filters"
        >
          <CaretLeft className="size-5" />
        </button>
        <div
          className="grid min-w-0 flex-1 gap-3"
          style={{ gridTemplateColumns: `repeat(${filterPageSize}, minmax(0, 1fr))` }}
        >
          {visible.map((f) => (
            <button
              key={f}
              data-filter-option
              type="button"
              aria-pressed={activeFilter === f}
              onClick={() => onSelect(f)}
              className={cn(
                "h-10 min-w-0 rounded-full border px-3 text-sm font-bold transition-colors whitespace-nowrap sm:px-6",
                activeFilter === f
                  ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                  : "border-[#cbd8ee] bg-white text-[#07145f] hover:border-[#ff6a1a] hover:text-[#ff6a1a]",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={actualStart + filterPageSize >= filters.length}
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-white text-[#07145f] transition-colors hover:text-[#ff6a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6a1a]/30 disabled:cursor-default disabled:opacity-35 lg:hidden"
          aria-label="Show next filters"
        >
          <CaretRight className="size-5" />
        </button>
      </div>
    </div>
  )
}
