import { cn } from "@workspace/ui/lib/utils"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"
import type { MapTone } from "./map-tone"

export type MapFilterChip = { key: string; label: string }

const CHIP_ON: Record<MapTone, string> = {
  light: "border-brand-orange bg-brand-orange text-white shadow-sm",
  dark: "border-brand-orange bg-brand-orange text-white",
}

const CHIP_OFF: Record<MapTone, string> = {
  light: "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50",
  dark: "border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:bg-white/10 hover:text-white",
}

export function MapFilterChips({
  tone,
  chips,
  chip,
  loading = false,
  onSelect,
  className,
  label = "Categories",
}: {
  tone: MapTone
  chips: MapFilterChip[]
  chip: string
  loading?: boolean
  onSelect: (key: string) => void
  className?: string
  label?: string
}) {
  const scrollerRef = useWheelScroll<HTMLDivElement>()
  return (
    <div
      ref={scrollerRef}
      className={cn(
        "scrollbar-hide flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]",
        className,
      )}
      style={{ touchAction: "pan-x" }}
      role="tablist"
      aria-label={label}
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          role="tab"
          aria-selected={chip === c.key}
          disabled={loading}
          onClick={() => onSelect(c.key)}
          className={cn(
            "shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors sm:text-[13px]",
            chip === c.key ? CHIP_ON[tone] : CHIP_OFF[tone],
            loading && "opacity-70",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
