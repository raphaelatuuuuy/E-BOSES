import type {
  LiveMapGeometry,
  LiveMapSnapshot,
  LiveMapUpdate,
} from "@/features/dashboard/api"

import type leaflet from "leaflet"
import {
  ACTIVE_CONCERN_STATUSES,
  isEmergencyActive,
} from "@/features/dashboard/components/record/status"
import { formatTime as formatDateTime } from "@/features/dashboard/components/emergencies/lib"
import {
  MAP_COLORS as BASE_MAP_COLORS,
  personDotHtml,
} from "@/features/dashboard/components/map/markers"
import type { MapLegendRow } from "@/features/dashboard/components/map/map-legend"

export type LayerKey =
  | "boundary"
  | "streets"
  | "concerns"
  | "advisories"
  | "acceptance_zone"

export type Selection = { kind: "concern" | "emergency"; id: number } | null

export type StreetLine = { name: string; line: leaflet.LatLngTuple[] }

export const defaultLayers: Record<LayerKey, boolean> = {
  boundary: true,
  streets: false,
  concerns: true,
  advisories: true,
  acceptance_zone: false,
}

export type AlertLayerCounts = {
  concerns: number
  advisories: number
}

export function alertLayerRows(
  counts: AlertLayerCounts
): MapLegendRow<LayerKey>[] {
  return [
    {
      key: "concerns",
      label: "Concerns",
      hint: "Community reports by residents",
      count: counts.concerns,
      tone: OFFICIAL_MAP_COLORS.concern,
    },
    {
      key: "advisories",
      label: "Advisory areas",
      hint: "Streets a barangay advisory covers",
      count: counts.advisories,
      tone: OFFICIAL_MAP_COLORS.advisory,
    },
  ]
}

/**
 * A map with nothing on it yet. The page mounts Leaflet against this the
 * moment it renders, so tiles, controls and the legend are on screen while the
 * first snapshot is still in flight instead of after it.
 */
export function emptyLiveMapSnapshot(): LiveMapSnapshot {
  return {
    home_community_id: null,
    communities: [],
    map: {
      provider: "OpenStreetMap",
      center: { latitude: 14.5995, longitude: 120.9842, zoom: 12 },
      boundary: { osm_relation_id: 0, name: "", geometry: null },
      streets: { streets: [], groups: {} },
      dispatch_policy: {
        id: null,
        barangay: "",
        acceptance_center_latitude: 14.5995,
        acceptance_center_longitude: 120.9842,
        acceptance_radius_meters: 800,
        acceptance_geometry: null,
        out_of_zone_action: "review",
        witness_radius_meters: 250,
        responder_nearby_radius_meters: 100,
        emergency_sms_number: "",
        updated_at: null,
      },
    },
    people: [],
    concerns: [],
    emergencies: [],
    public_concerns: [],
    public_emergencies: [],
    operational: {
      community_id: null,
      concerns: [],
      emergencies: [],
      routes: [],
    },
    routes: [],
    advisories: [],
    summary: {
      active_alerts: 0,
      concerns: 0,
      emergencies: 0,
      residents: 0,
      responders: 0,
      officials: 0,
    },
    generated_at: "",
  }
}

export const activeConcernStatuses = new Set<string>(ACTIVE_CONCERN_STATUSES)
export const activeEmergencyStatuses = {
  has: (status: string) => isEmergencyActive(status),
}

export function isActiveConcern(concern: { status: string }) {
  return activeConcernStatuses.has(concern.status)
}

/**
 * Statuses that get a pin on the alerts map. Wider than the operational
 * ACTIVE_CONCERN_STATUSES on purpose: the public/resident snapshot also
 * carries just-filed "submitted" reports, and the resident map pins them.
 * Filtering those out here is why other communities' concerns showed rows
 * in some views but never drew their pins on this map.
 */
export const mapDrawableConcernStatuses = new Set<string>([
  ...ACTIVE_CONCERN_STATUSES,
  "submitted",
  "resolved",
])

export function isMapDrawableConcern(concern: { status: string }) {
  return mapDrawableConcernStatuses.has(concern.status)
}

export function isResolvedRecord(record: { status: string }) {
  return record.status === "resolved" || record.status === "partially_resolved"
}

export function isAdvisoryExpired(
  advisory: {
    expires_at?: string | null
    status_label?: string
  },
  nowMs?: number | null
) {
  if (advisory.status_label === "expired") return true
  if (!advisory.expires_at) return false
  const ts = Date.parse(advisory.expires_at)
  const now = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now()
  return Number.isFinite(ts) && ts < now
}

export function advisoryDoneColor(
  advisory: { expires_at?: string | null; status_label?: string },
  tagColor: string,
  nowMs?: number | null
) {
  return isAdvisoryExpired(advisory, nowMs) ? BASE_MAP_COLORS.resolved : tagColor
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
  return formatDateTime(value, "No update")
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

export function geoJsonToLines(
  geometry?: LiveMapGeometry | null
): leaflet.LatLngTuple[][] {
  if (!geometry) return []
  if (geometry.type === "LineString") {
    const line = lineCoordinates(geometry.coordinates)
    return line.length > 1 ? [line] : []
  }
  if (
    geometry.type === "MultiLineString" &&
    Array.isArray(geometry.coordinates)
  ) {
    return geometry.coordinates
      .map(lineCoordinates)
      .filter((line) => line.length > 1)
  }
  return []
}

export { MAP_COLORS } from "@/features/dashboard/components/map/markers"

export const OFFICIAL_MAP_COLORS = {
  ...BASE_MAP_COLORS,
  you: "#0a0a0a",
  emergency: "#f23b35",
  responder: "#2563eb",
  responderAssigned: "#4dc4ff",
  official: "#334155",
  resolved: "#6b7280",
} as const

export function markerDotHtml(color: string, pulse = false) {
  return personDotHtml(color, pulse, "light")
}

export function mergeUpdate(
  snapshot: LiveMapSnapshot,
  message: LiveMapUpdate
): LiveMapSnapshot {
  if (message.type === "location.updated") {
    const person = message.payload.person
    const people = snapshot.people.some((item) => item.id === person.id)
      ? snapshot.people.map((item) => (item.id === person.id ? person : item))
      : [...snapshot.people, person]
    return { ...snapshot, people }
  }
  if (
    message.type === "concern.created" ||
    message.type === "concern.updated"
  ) {
    const concern = message.payload.concern
    const concerns = snapshot.concerns.some((item) => item.id === concern.id)
      ? snapshot.concerns.map((item) =>
          item.id === concern.id ? concern : item
        )
      : [concern, ...snapshot.concerns]
    return { ...snapshot, concerns }
  }
  if (
    message.type === "emergency.created" ||
    message.type === "emergency.updated"
  ) {
    const emergency = message.payload.emergency
    const emergencies = snapshot.emergencies.some(
      (item) => item.id === emergency.id
    )
      ? snapshot.emergencies.map((item) =>
          item.id === emergency.id ? emergency : item
        )
      : [emergency, ...snapshot.emergencies]
    const incoming =
      message.payload.routes ??
      (message.payload.route ? [message.payload.route] : [])
    const routes =
      !isActiveEmergency(emergency) && incoming.length === 0
        ? snapshot.routes
        : [
            ...snapshot.routes.filter((item) => item.alert_id !== emergency.id),
            ...incoming,
          ]
    return { ...snapshot, emergencies, routes }
  }
  if (message.type === "route.updated") {
    const route = message.payload.route
    const routes = snapshot.routes.some(
      (item) => item.assignment_id === route.assignment_id
    )
      ? snapshot.routes.map((item) =>
          item.assignment_id === route.assignment_id ? route : item
        )
      : [...snapshot.routes, route]
    return { ...snapshot, routes }
  }
  if (message.type === "route.removed") {
    const { alert_id, assignment_id } = message.payload
    return {
      ...snapshot,
      routes: snapshot.routes.filter((route) =>
        assignment_id
          ? route.assignment_id !== assignment_id
          : route.alert_id !== alert_id
      ),
    }
  }
  return snapshot
}
