import { LoaderCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * One joined stack of map controls, shared by every Leaflet surface.
 *
 * `MapControlButton` in map-weather.tsx carries its own rounded border and
 * glass background, so three of them stacked reads as three floating objects.
 * These are flat segments and the container owns the shape — one control, not
 * a cluster.
 */

export function MapStackButton({
  label,
  onClick,
  loading = false,
  active = false,
  className,
  children,
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  active?: boolean
  /** Override the default nav-glass colours (e.g. black-on-white on light maps). */
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex size-11 items-center justify-center transition-colors disabled:opacity-60",
        active
          ? "bg-ice text-ink"
          : "text-nav-text hover:bg-white/5 hover:text-nav-text-active",
        className,
      )}
    >
      {loading ? <LoaderCircleIcon className="size-5 animate-spin" /> : children}
    </button>
  )
}

export function MapStackDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn("h-px bg-rail-line", className)} />
}

export function MapControlStack({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-rail-line bg-nav-glass backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  )
}
