import type leaflet from "leaflet"

/**
 * One definition of how a route is drawn, everywhere: a fat solid line with a
 * darker casing under it, rounded at every cap and join. Blue while a
 * responder is travelling to an open incident, grey once it is settled.
 * Nothing on a route moves.
 *
 * Where an endpoint sits off the road network the route is completed with a
 * grey `approach` walked on footways and a dashed `connector` for whatever is
 * left. Both ends get a connector, on every profile.
 */

const DEFAULT_WEIGHT = 7
const GAP_EPSILON_DEGREES = 1e-5

export interface RouteLineOptions {
  live: boolean
  weight?: number
  /** Held back because another route is focused. */
  dim?: boolean
}

const DIM_FACTOR = 0.35

export function routeCasingStyle({
  live,
  weight = DEFAULT_WEIGHT,
  dim = false,
}: RouteLineOptions): leaflet.PolylineOptions {
  return {
    color: "var(--color-map-route-casing)",
    weight: weight + 4,
    opacity: (live ? 0.45 : 0.25) * (dim ? DIM_FACTOR : 1),
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  }
}

export function routeLineStyle({
  live,
  weight = DEFAULT_WEIGHT,
  dim = false,
}: RouteLineOptions): leaflet.PolylineOptions {
  return {
    color: live ? "var(--color-map-responder)" : "var(--color-map-route-idle)",
    weight,
    opacity: (live ? 1 : 0.5) * (dim ? DIM_FACTOR : 1),
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  }
}

export function approachLineStyle(dim = false): leaflet.PolylineOptions {
  return {
    color: "var(--color-map-route-idle)",
    weight: 4,
    opacity: dim ? 0.85 * DIM_FACTOR : 0.85,
    lineCap: "round",
    lineJoin: "round",
    interactive: false,
  }
}

export function connectorLineStyle(dim = false): leaflet.PolylineOptions {
  return {
    color: "var(--color-map-route-idle)",
    weight: 3,
    opacity: dim ? 0.9 * DIM_FACTOR : 0.9,
    dashArray: "1 7",
    lineCap: "round",
    interactive: false,
  }
}

export function latLngsFromGeoJson(geometry: unknown): leaflet.LatLngTuple[] {
  if (!geometry || typeof geometry !== "object") return []
  const coordinates = (geometry as { coordinates?: unknown }).coordinates
  if (!Array.isArray(coordinates)) return []
  return coordinates.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const lng = Number(point[0])
    const lat = Number(point[1])
    return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng] as leaflet.LatLngTuple] : []
  })
}

export interface RouteGeometrySource {
  geometry?: unknown
  origin_snap?: { latitude: number; longitude: number; meters: number | null } | null
  destination_snap?: { latitude: number; longitude: number; meters: number | null } | null
  approach?: { geometry?: unknown } | null
}

export interface RouteRenderGeometry {
  road: leaflet.LatLngTuple[]
  approach: leaflet.LatLngTuple[]
  connectors: leaflet.LatLngTuple[][]
}

function apart(a: leaflet.LatLngTuple, b: leaflet.LatLngTuple) {
  return (
    Math.abs(a[0] - b[0]) > GAP_EPSILON_DEGREES || Math.abs(a[1] - b[1]) > GAP_EPSILON_DEGREES
  )
}

function snapPoint(
  snap: { latitude: number; longitude: number } | null | undefined,
): leaflet.LatLngTuple | null {
  if (!snap) return null
  const lat = Number(snap.latitude)
  const lng = Number(snap.longitude)
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null
}

interface PathAnchor {
  point: leaflet.LatLngTuple
  /** Index of the segment the point falls on. */
  index: number
}

/**
 * Closest point on the drawn line to a pin — projected onto the nearest
 * segment, not snapped to the nearest vertex. Vertices can be hundreds of
 * metres apart on a straight road, which is what made the dash run to a far
 * corner instead of straight out to the kerb.
 *
 * Longitude is scaled by cos(latitude) so the projection is done in roughly
 * equal units on both axes; without it the foot of the perpendicular skews.
 */
function projectOnPath(
  points: leaflet.LatLngTuple[],
  target: leaflet.LatLngTuple,
): PathAnchor | null {
  if (points.length < 2) return null

  const scale = Math.cos((target[0] * Math.PI) / 180) || 1
  const px = target[1] * scale
  const py = target[0]

  let best: PathAnchor | null = null
  let bestDistance = Infinity

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
    const distance = (px - cx) ** 2 + (py - cy) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = { point: [cy, cx / scale], index }
    }
  }
  return best
}

/** Everything from the anchor onward, starting exactly on it. */
function trimFrom(points: leaflet.LatLngTuple[], anchor: PathAnchor) {
  const next = [anchor.point, ...points.slice(anchor.index + 1)]
  return next.length > 1 ? next : points
}

/** Everything up to the anchor, ending exactly on it. */
function trimTo(points: leaflet.LatLngTuple[], anchor: PathAnchor) {
  const next = [...points.slice(0, anchor.index + 1), anchor.point]
  return next.length > 1 ? next : points
}

/**
 * Split a route payload into the pieces the map draws.
 *
 * The road is trimmed to the stretch that is actually still ahead: it starts
 * exactly where the responder joins it and ends exactly where the incident
 * leaves it. That is what makes the dashes meet the line's ends instead of
 * touching its side, and stops the leg trailing behind a responder who has
 * moved on since the last ping.
 */
export function routeRenderGeometry(
  route: RouteGeometrySource | null | undefined,
  endpoints: {
    origin?: leaflet.LatLngTuple | null
    destination?: leaflet.LatLngTuple | null
  } = {},
): RouteRenderGeometry {
  let road = latLngsFromGeoJson(route?.geometry)
  const rawApproach = latLngsFromGeoJson(route?.approach?.geometry)
  const approach = rawApproach.length > 1 ? rawApproach : []
  const connectors: leaflet.LatLngTuple[][] = []

  const { origin = null, destination = null } = endpoints

  if (origin) {
    const anchor = projectOnPath(road, origin)
    if (anchor) road = trimFrom(road, anchor)
    const join = anchor?.point ?? snapPoint(route?.origin_snap)
    if (join && apart(origin, join)) connectors.push([origin, join])
  }

  if (destination) {
    if (approach.length) {
      const tail = approach.at(-1)
      if (tail && apart(tail, destination)) connectors.push([tail, destination])
    } else {
      const anchor = projectOnPath(road, destination)
      if (anchor) road = trimTo(road, anchor)
      const join = anchor?.point ?? snapPoint(route?.destination_snap)
      if (join && apart(join, destination)) connectors.push([join, destination])
    }
  }

  return { road, approach, connectors }
}

export interface DrawRouteOptions extends RouteLineOptions {
  road: leaflet.LatLngTuple[]
  approach?: leaflet.LatLngTuple[]
  connectors?: leaflet.LatLngTuple[][]
}

export interface RouteLayers {
  points: leaflet.LatLngTuple[]
  remove: () => void
}

export function drawRoute(
  L: typeof leaflet,
  target: leaflet.Map | leaflet.LayerGroup,
  { road, approach, connectors, live, weight, dim }: DrawRouteOptions,
): RouteLayers | null {
  const layers: leaflet.Polyline[] = []
  const points: leaflet.LatLngTuple[] = []

  if (road.length > 1) {
    layers.push(L.polyline(road, routeCasingStyle({ live, weight, dim })))
    layers.push(L.polyline(road, routeLineStyle({ live, weight, dim })))
    points.push(...road)
  }
  if (approach && approach.length > 1) {
    layers.push(L.polyline(approach, approachLineStyle(dim)))
    points.push(...approach)
  }
  for (const connector of connectors ?? []) {
    if (connector.length < 2) continue
    layers.push(L.polyline(connector, connectorLineStyle(dim)))
    points.push(...connector)
  }
  if (!layers.length) return null

  layers.forEach((layer) => layer.addTo(target))
  return {
    points,
    remove: () => layers.forEach((layer) => layer.remove()),
  }
}
