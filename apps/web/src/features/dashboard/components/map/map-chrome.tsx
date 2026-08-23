import { LoaderCircleIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { MAP_HOVER, MAP_INK, MAP_LINE, MAP_SURFACE, type MapTone } from "./map-tone"

export function MapControlStack({
  tone,
  children,
  className,
}: {
  tone: MapTone
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border shadow-md",
        MAP_SURFACE[tone],
        className,
      )}
    >
      {children}
    </div>
  )
}

export function MapControlButton({
  tone,
  label,
  onClick,
  loading = false,
  active = false,
  divider = false,
  children,
  className,
  draggable = false,
  onDragStart,
}: {
  tone: MapTone
  label: string
  onClick?: () => void
  loading?: boolean
  active?: boolean
  /** Hairline above this segment. Omit on the first item in a stack. */
  divider?: boolean
  children: ReactNode
  className?: string
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      draggable={draggable}
      onDragStart={onDragStart}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-10 items-center justify-center transition-colors disabled:opacity-60",
        MAP_INK[tone],
        MAP_HOVER[tone],
        divider && cn("border-t", MAP_LINE[tone]),
        active && (tone === "dark" ? "bg-white/12" : "bg-neutral-100"),
        className,
      )}
    >
      {loading ? <LoaderCircleIcon className="size-5 animate-spin" /> : children}
    </button>
  )
}

export function MapChip({
  tone,
  label,
  onClick,
  expanded,
  children,
  className,
}: {
  tone: MapTone
  label: string
  onClick: () => void
  expanded?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[13px] font-semibold shadow-md transition-colors",
        MAP_SURFACE[tone],
        MAP_INK[tone],
        MAP_HOVER[tone],
        className,
      )}
    >
      {children}
    </button>
  )
}
