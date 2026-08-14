import type {
  LiveMapGeometry,
  LiveMapPerson,
  LiveMapSnapshot,
  LiveMapUpdate,
} from "@/features/dashboard/api"

import type leaflet from "leaflet"
import {
  ACTIVE_CONCERN_STATUSES,
  isEmergencyActive,
} from "@/features/dashboard/components/record/status"
import { formatTime as formatDateTime } from "@/features/dashboard/components/emergencies/lib"
import { roleLabelOf } from "@/features/dashboard/lib/people"

export type LayerKey =
  | "boundary"
  | "streets"
  | "residents"
  | "officials"
  | "responders"
  | "concerns"
  | "emergencies"
  | "advisories"
  | "resolved"
  | "acceptance_zone"

export type Selection = { kind: "person" | "concern" | "emergency"; id: number } | null

export type StreetLine = { name: string; line: leaflet.LatLngTuple[] }

export const defaultLayers: Record<LayerKey, boolean> = {
  boundary: true,
  streets: false,
  residents: true,
  officials: true,
  responders: true,
  concerns: true,
  emergencies: true,
  advisories: true,
  resolved: false,
  acceptance_zone: false,
}

export const activeConcernStatuses = new Set<string>(ACTIVE_CONCERN_STATUSES)
export const activeEmergencyStatuses = {
  has: (status: string) => isEmergencyActive(status),
}

export function isActiveConcern(concern: { status: string }) {
  return activeConcernStatuses.has(concern.status)
}

export function isResolvedRecord(record: { status: string }) {
  return record.status === "resolved"
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

export function roleLabel(role: LiveMapPerson["role"]) {
  return roleLabelOf(role) || "Resident"
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

export const MAP_COLORS = {
  emergency: "#f23b35",
  concern: "#ff6a1a",
  structure: "#7f8db8",
  route: "#ff6a1a",
  advisory: "#f2a03d",
  responder: "#2563eb",
  responderAssigned: "#4dc4ff",
  responderOffDuty: "#5d6785",
  resolved: "#16a34a",
} as const

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
