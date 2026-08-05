import { ClockIcon, RouteIcon, TimerIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import {
  measureEta,
  measureKm,
  measureSince,
} from "@/features/dashboard/lib/responder-format"
import { MetricTile } from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * Distance · ETA · Elapsed.
 *
 * Three, deliberately, and laid out exactly as the reference's driver row: a
 * glyph in a rounded square, the magnitude large, the unit small beside it.
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
  className,
}: {
  alert: EmergencyAlert
  /** Live straight-line distance from the responder's GPS, in km. */
  distance: number | null
  /** Shared clock tick so Elapsed advances with the rest of the screen. */
  now: number
  className?: string
}) {
  const route = alert.route ?? alert.current_assignment?.route ?? null
  // Prefer the routing service's road distance; fall back to the straight line
  // we can always compute from the responder's own GPS.
  const roadKm =
    route?.status === "ok" && route.distance_meters != null
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

  return (
    <div className={cn("grid grid-cols-3 gap-3", className)}>
      <MetricTile icon={RouteIcon} value={km.value} unit={km.unit} label="Distance" />
      <MetricTile icon={ClockIcon} value={eta.value} unit={eta.unit} label="ETA" />
      <MetricTile
        icon={TimerIcon}
        value={elapsed.value}
        unit={elapsed.unit}
        label="Elapsed"
        tone={overdue ? "alarm" : "ice"}
      />
    </div>
  )
}
