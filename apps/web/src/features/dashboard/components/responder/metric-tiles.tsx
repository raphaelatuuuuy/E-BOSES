import { ClockIcon, RouteIcon, TimerIcon, WifiOffIcon } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import {
  measureEta,
  measureKm,
  measureSince,
} from "@/features/dashboard/lib/responder-format"

/**
 * Distance · ETA · Elapsed.
 *
 * One readout, not three: a single bordered cell split by hairline dividers,
 * so the three figures read as a row of the same strip instead of three
 * separate cards competing with each other (and with the reporter row above
 * them). `bare` drops the outer box — for when the strip already lives inside
 * one of those cells (the dispatch card's resident block) — and keeps just the
 * cells and the hairline that separates them from the content above.
 *
 * A glyph, the magnitude large, the unit small beside it.
 *
 * Icons are ice, not orange: these are things being measured, not things to
 * press (see the warm/cold rule in globals.css). The one exception is an
 * incident that has been open past the hour, which switches Elapsed to the
 * alarm glyph — a figure that has gone wrong, not a control.
 */
export function MetricTiles({
  alert,
  distance,
  now,
  bare = false,
  className,
}: {
  alert: EmergencyAlert
  /** Live straight-line distance from the responder's GPS, in km. */
  distance: number | null
  /** Shared clock tick so Elapsed advances with the rest of the screen. */
  now: number
  /** True when the host surface already provides the box (resident card). */
  bare?: boolean
  className?: string
}) {
  const route = alert.route ?? alert.current_assignment?.route ?? null
  // Prefer the routing service's road distance; fall back to the straight line
  // we can always compute from the responder's own GPS. `stale` is the last
  // good route — the router is down but the planned leg is still real.
  const roadKm =
    (route?.status === "ok" || route?.status === "stale") && route.distance_meters != null
      ? route.distance_meters / 1000
      : null

  // An emergency that has been open for over an hour without resolution is
  // worth flagging in the readout rather than leaving it to arithmetic.
  const openSeconds = Math.max(
    0,
    Math.floor((now - new Date(alert.created_at).getTime()) / 1000),
  )
  const overdue = alert.resolved_at == null && openSeconds > 3600

  const km = measureKm(roadKm ?? distance)
  const eta = measureEta(route?.eta_seconds)
  const elapsed = measureSince(alert.created_at, now)

  const cells: Array<{
    key: string
    icon: LucideIcon
    value: string
    unit?: string
    label: string
    alarm?: boolean
  }> = [
    { key: "distance", icon: RouteIcon, value: km.value, unit: km.unit, label: "Distance" },
    { key: "eta", icon: ClockIcon, value: eta.value, unit: eta.unit, label: "ETA" },
    {
      key: "elapsed",
      icon: TimerIcon,
      value: elapsed.value,
      unit: elapsed.unit,
      label: "Elapsed",
      alarm: overdue,
    },
  ]

  return (
    <>
      <div
        className={cn(
          bare
            ? "grid grid-cols-3 border-t border-card-line"
            : "grid grid-cols-3 overflow-hidden rounded-2xl border border-card-line bg-card-raised",
          className,
        )}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.key}
            className={cn("min-w-0 px-3.5 py-3", index > 0 && "border-l border-card-line")}
          >
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-lg",
                cell.alarm ? "bg-sos/15 text-sos" : "bg-ice/10 text-ice",
              )}
            >
              <cell.icon className="size-3.5" />
            </span>
            <p className="mt-2 flex min-w-0 items-baseline gap-1">
              <span
                className={cn(
                  "truncate text-[20px] font-bold leading-none tabular-nums",
                  cell.alarm ? "text-sos" : "text-foreground",
                )}
              >
                {cell.value}
              </span>
              {cell.unit ? (
                <span className="shrink-0 text-[12px] font-semibold leading-none text-subtle-foreground">
                  {cell.unit}
                </span>
              ) : null}
            </p>
            <p className="mt-1.5 truncate text-micro text-subtle-foreground">
              {cell.label}
            </p>
          </div>
        ))}
      </div>
      {/* `stale` is the last route the router computed before it went quiet —
          the numbers above are still real, so say so instead of pretending the
          router is answering. */}
      {route?.status === "stale" ? (
        <p className="flex items-center gap-1.5 border-t border-card-line px-3.5 py-2 text-micro text-subtle-foreground">
          <WifiOffIcon className="size-3 shrink-0" />
          Router offline — this is the route computed before it went quiet.
        </p>
      ) : null}
    </>
  )
}