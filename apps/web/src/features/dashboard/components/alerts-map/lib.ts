import type {
  LiveMapGeometry,
  LiveMapPerson,
  LiveMapSnapshot,
  LiveMapUpdate,
} from "@/features/dashboard/api"

import type leaflet from "leaflet"
import { isEmergencyActive } from "@/features/dashboard/components/emergencies/lib"

export type LayerKey =
  | "boundary"
  | "streets"
  | "residents"
  | "officials"
  | "responders"
  | "concerns"
  | "emergencies"
  | "routes"
  | "acceptance_zone"

export type Selection = { kind: "person" | "concern" | "emergency"; id: number } | null

export type StreetLine = { name: string; line: leaflet.LatLngTuple[] }

export const defaultLayers: Record<LayerKey, boolean> = {
  boundary: true,
  // Off by default. Drawing every street polyline on top of a basemap that
  // already renders streets doubled the linework for no added information,
  // and it was the single biggest source of visual noise on the map.
  streets: false,
  residents: true,
  officials: true,
  responders: true,
  concerns: true,
  emergencies: true,
  routes: true,
  acceptance_zone: true,
}

/**
 * What "open" means on the live map — the single definition.
 *
 * `appealed` was removed: an appealed concern is one that was *rejected* and is
 * being contested, so it is a closed record under review, not open work. It was
 * the reason resolved-looking concerns kept surfacing in Open Concerns. Appeals
 * are worked from the Concerns queue's own appeals panel, which has the review
 * controls; the map is for things happening in the barangay right now.
 *
 * Use the predicates below rather than reading the sets directly. Both the map
 * markers and the side list must run the same rule — they previously did not,
 * which meant one screen could show a pin with no matching row.
 */
export const activeConcernStatuses = new Set(["submitted", "under_review", "assigned", "in_progress"])
// Derived from the shared list so new statuses do not silently drop pins.
export const activeEmergencyStatuses = {
  has: (status: string) => isEmergencyActive(status),
}

export function isActiveConcern(concern: { status: string }) {
  return activeConcernStatuses.has(concern.status)
}

export function isActiveEmergency(emergency: { status: string }) {
  return activeEmergencyStatuses.has(emergency.status)
}

export function validCoord(lat?: string | null, lng?: string | null) {
  if (lat == null || lng == null || lat === "" || lng === "") return null
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

export function formatTime(value?: string | null) {
  if (!value) return "No update"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "No update"
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function formatDistance(meters: number | null) {
  if (meters == null) return "Route unavailable"
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

export function formatEta(seconds: number | null) {
  if (seconds == null) return "ETA unavailable"
  return `ETA ${Math.max(1, Math.round(seconds / 60))} min`
}

export function policyNumber(value: number | string, fallback: number) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export function roleLabel(role: LiveMapPerson["role"]) {
  if (role === "barangay_official") return "Official"
  if (role === "first_responder") return "Responder"
  return "Resident"
}

export function lineCoordinates(coordinates: unknown): leaflet.LatLngTuple[] {
  if (!Array.isArray(coordinates)) return []
  return coordinates.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const longitude = Number(point[0])
    const latitude = Number(point[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    return [[latitude, longitude] as leaflet.LatLngTuple]
  })
}

export function geoJsonToLines(geometry?: LiveMapGeometry | null): leaflet.LatLngTuple[][] {
  if (!geometry) return []
  if (geometry.type === "LineString") {
    const line = lineCoordinates(geometry.coordinates)
    return line.length > 1 ? [line] : []
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(lineCoordinates).filter((line) => line.length > 1)
  }
  return []
}

/**
 * Map palette — three hues, and that is the whole set.
 *
 * The previous map used seven (red boundary, blue streets, blue dashed routes,
 * grey zone, green residents, purple officials, orange concerns). At that count
 * colour stops encoding anything: nothing stands out because everything does.
 * Here orange means "a resident is waiting", red means "someone needs help
 * now", and every reference layer is a shade of the navy the map sits on.
 */
export const MAP_COLORS = {
  emergency: "#f23b35",
  concern: "#ff6a1a",
  /** People, boundary, streets, zone — structure, not alerts. */
  structure: "#7f8db8",
  route: "#ff6a1a",
  /**
   * Responders are not "structure". They were previously drawn in the
   * structure hue alongside residents and officials, which made the one
   * category of person a dispatcher actually tracks indistinguishable from
   * the two they do not — the reason responders looked absent from the map.
   *
   * `responder` is on duty and available; `responderAssigned` is committed to
   * the incident currently selected, so an operator can see at a glance who is
   * already moving and who can still be sent.
   */
  responder: "#1f8f6f",
  responderAssigned: "#4dc4ff",
  responderOffDuty: "#5d6785",
} as const

/**
 * Marker as a glowing point of light rather than a filled pin.
 *
 * On a dark basemap a solid dot with a white ring reads as a sticker sitting on
 * top of the map. A core plus a soft radial bloom reads as something emitting
 * from the map, which is what the reference boards do and what makes a cluster
 * of incidents legible as intensity rather than as a pile of icons.
 */
export function markerDotHtml(color: string, pulse = false) {
  const core = pulse ? 11 : 8
  return `<span class="eboses-map-pin${pulse ? " is-live" : ""}" style="--pin:${color};--core:${core}px">
    <span class="eboses-map-pin__glow"></span>
    ${pulse ? '<span class="eboses-map-pin__ring"></span>' : ""}
    <span class="eboses-map-pin__core"></span>
  </span>`
}

export function mergeUpdate(snapshot: LiveMapSnapshot, message: LiveMapUpdate): LiveMapSnapshot {
  if (message.type === "location.updated") {
    const person = message.payload.person
    const people = snapshot.people.some((item) => item.id === person.id)
      ? snapshot.people.map((item) => item.id === person.id ? person : item)
      : [...snapshot.people, person]
    return { ...snapshot, people }
  }
  if (message.type === "concern.created" || message.type === "concern.updated") {
    const concern = message.payload.concern
    const concerns = snapshot.concerns.some((item) => item.id === concern.id)
      ? snapshot.concerns.map((item) => item.id === concern.id ? concern : item)
      : [concern, ...snapshot.concerns]
    return { ...snapshot, concerns }
  }
  if (message.type === "emergency.created" || message.type === "emergency.updated") {
    const emergency = message.payload.emergency
    // Keep the record even once it closes, matching how concerns are merged
    // above. Dropping it here used to blank the detail panel out from under an
    // official the moment the incident they were reading resolved. Visibility
    // is decided at render by isActiveEmergency(), in one place, for both the
    // map markers and the side list.
    const emergencies = snapshot.emergencies.some((item) => item.id === emergency.id)
      ? snapshot.emergencies.map((item) => item.id === emergency.id ? emergency : item)
      : [emergency, ...snapshot.emergencies]
    const route = message.payload.route
    const routes = route
      ? snapshot.routes.some((item) => item.assignment_id === route.assignment_id)
        ? snapshot.routes.map((item) => item.assignment_id === route.assignment_id ? route : item)
        : [...snapshot.routes, route]
      : snapshot.routes
    return { ...snapshot, emergencies, routes }
  }
  if (message.type === "route.updated") {
    const route = message.payload.route
    const routes = snapshot.routes.some((item) => item.assignment_id === route.assignment_id)
      ? snapshot.routes.map((item) => item.assignment_id === route.assignment_id ? route : item)
      : [...snapshot.routes, route]
    return { ...snapshot, routes }
  }
  return snapshot
}
