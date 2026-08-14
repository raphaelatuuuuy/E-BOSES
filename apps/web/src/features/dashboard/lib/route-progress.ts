import type leaflet from "leaflet"

import type { EmergencyRouteStep } from "@/features/dashboard/emergency-api"

/**
 * Where the responder is along the planned leg.
 *
 * Everything here works in metres along the line rather than in straight-line
 * distance to a point, because "which turn am I approaching" and "have I left
 * the route" are both questions about progress, not proximity. A responder can
 * be 30 m from a turn they passed five minutes ago.
 */

const EARTH_RADIUS_METERS = 6371000

export function metersBetween(a: leaflet.LatLngTuple, b: leaflet.LatLngTuple) {
  const toRad = Math.PI / 180
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const lat1 = a[0] * toRad
  const lat2 = b[0] * toRad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_METERS * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Distance from the start of the line to each of its vertices. */
export function pathCumulative(points: leaflet.LatLngTuple[]) {
  const cumulative = new Array<number>(points.length)
  cumulative[0] = 0
  for (let index = 1; index < points.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + metersBetween(points[index - 1], points[index])
  }
  return cumulative
}

export interface PathPosition {
  /** Foot of the perpendicular, on the line. */
  point: leaflet.LatLngTuple
  /** Metres from the start of the line to that foot. */
  travelled: number
  /** Perpendicular distance from the line — how far off route. */
  offRoute: number
}

/**
 * Project a position onto the line, in metres.
 *
 * Longitude is scaled by cos(latitude) for the projection so the perpendicular
 * is not skewed; the distances themselves are then measured properly.
 */
export function positionOnPath(
  points: leaflet.LatLngTuple[],
  target: leaflet.LatLngTuple,
  cumulative = pathCumulative(points),
): PathPosition | null {
  if (points.length < 2) return null

  const scale = Math.cos((target[0] * Math.PI) / 180) || 1
  const px = target[1] * scale
  const py = target[0]

  let best: PathPosition | null = null
  let bestPlanar = Infinity

  for (let index = 0; index < points.length - 1; index += 1) {
    const ax = points[index][1] * scale
    const ay = points[index][0]
    const dx = points[index + 1][1] * scale - ax
    const dy = points[index + 1][0] - ay
    const lengthSquared = dx * dx + dy * dy
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
    const cx = ax + t * dx
    const cy = ay + t * dy
    const planar = (px - cx) ** 2 + (py - cy) ** 2
    if (planar >= bestPlanar) continue

    bestPlanar = planar
    const point: leaflet.LatLngTuple = [cy, cx / scale]
    const segment = cumulative[index + 1] - cumulative[index]
    best = {
      point,
      travelled: cumulative[index] + segment * t,
      offRoute: metersBetween(target, point),
    }
  }
  return best
}

export interface StepProgress {
  /** Index into `steps` of the maneuver being approached. */
  activeIndex: number
  /** Metres from the responder to that maneuver, along the road. */
  metersToNext: number | null
  /** Metres of the whole leg still ahead. */
  metersRemaining: number | null
}

function stepPoint(step: EmergencyRouteStep): leaflet.LatLngTuple | null {
  if (step.latitude == null || step.longitude == null) return null
  return [step.latitude, step.longitude]
}

/**
 * Which maneuver the responder is approaching, and how far away it is.
 *
 * Each maneuver is placed on the line by its own distance-along, so a route
 * that doubles back on itself still advances in the right order — which
 * picking the nearest maneuver by straight-line distance would not.
 */
export function stepProgress(
  road: leaflet.LatLngTuple[],
  steps: EmergencyRouteStep[],
  position: leaflet.LatLngTuple | null,
): StepProgress | null {
  if (!position || road.length < 2 || steps.length === 0) return null

  const cumulative = pathCumulative(road)
  const here = positionOnPath(road, position, cumulative)
  if (!here) return null

  const total = cumulative[cumulative.length - 1]
  const marks = steps.map((step) => {
    const point = stepPoint(step)
    if (!point) return null
    return positionOnPath(road, point, cumulative)?.travelled ?? null
  })

  // First maneuver still ahead of us. The small slack stops a turn flipping to
  // "next" while the responder is still sitting on the junction.
  const slack = 5
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]
    if (mark == null) continue
    if (mark > here.travelled + slack) {
      return {
        activeIndex: index,
        metersToNext: Math.max(0, mark - here.travelled),
        metersRemaining: Math.max(0, total - here.travelled),
      }
    }
  }

  return {
    activeIndex: steps.length - 1,
    metersToNext: Math.max(0, total - here.travelled),
    metersRemaining: Math.max(0, total - here.travelled),
  }
}

/** Perpendicular distance from the drawn line, in metres. */
export function offRouteMeters(
  road: leaflet.LatLngTuple[],
  position: leaflet.LatLngTuple | null,
) {
  if (!position || road.length < 2) return null
  return positionOnPath(road, position)?.offRoute ?? null
}
