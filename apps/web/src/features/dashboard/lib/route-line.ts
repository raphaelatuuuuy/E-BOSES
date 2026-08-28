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
    dashArray: "1 8",
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

/**
 * Split a route payload into the pieces the map draws.
 *
 * Provider waypoints own the road endpoints. This preserves loops and uses
 * dashed connectors for the exact responder and incident points.
 */
export function routeRenderGeometry(
  route: RouteGeometrySource | null | undefined,
  endpoints: {
    origin?: leaflet.LatLngTuple | null
    destination?: leaflet.LatLngTuple | null
  } = {},
): RouteRenderGeometry {
  const road = latLngsFromGeoJson(route?.geometry)
  const rawApproach = latLngsFromGeoJson(route?.approach?.geometry)
  const approach = rawApproach.length > 1 ? rawApproach : []
  const connectors: leaflet.LatLngTuple[][] = []

  const { origin = null, destination = null } = endpoints

  if (origin) {
    const join = snapPoint(route?.origin_snap) ?? road[0]
    if (join && apart(origin, join)) connectors.push([origin, join])
  }

  if (destination) {
    if (approach.length) {
      const tail = approach.at(-1)
      if (tail && apart(tail, destination)) connectors.push([tail, destination])
    } else {
      const join = snapPoint(route?.destination_snap) ?? road.at(-1)
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
