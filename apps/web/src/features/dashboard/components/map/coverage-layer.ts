import type leaflet from "leaflet"

import type { GeoJsonPolygon, LiveMapGeometry } from "@/features/dashboard/api"
import { geoJsonToRing } from "@/features/dashboard/components/community-content/area-lib"
import type { MarkerTone } from "@/features/dashboard/components/map/markers"

export const COVERAGE_COLORS = {
  boundary: "#ffffff",
  zone: "#ff6a1a",
} as const

export interface CoveragePolicy {
  acceptance_center_latitude: number | string
  acceptance_center_longitude: number | string
  acceptance_radius_meters: number | string
  acceptance_geometry?: GeoJsonPolygon | null
}

export interface CoverageInput {
  boundary?: LiveMapGeometry | GeoJsonPolygon | null
  policy?: CoveragePolicy | null
}

export interface DrawCoverageOptions extends CoverageInput {
  tone?: MarkerTone
  showBoundary?: boolean
  showZone?: boolean
}

function number(value: number | string | null | undefined, fallback: number) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function rings(geometry: LiveMapGeometry | GeoJsonPolygon | null | undefined): [number, number][][] {
  if (!geometry) return []
  if (geometry.type === "Polygon") {
    const ring = geoJsonToRing(geometry as GeoJsonPolygon)
    return ring.length >= 3 ? [ring] : []
  }
  if (geometry.type === "MultiPolygon") {
    const parts = (geometry.coordinates as number[][][][]) ?? []
    return parts
      .map((part) => geoJsonToRing({ type: "Polygon", coordinates: part } as GeoJsonPolygon))
      .filter((ring) => ring.length >= 3)
  }
  return []
}

/**
 * The barangay edge and the acceptance zone, drawn the same way on every map an
 * official, a responder or a resident can open. One helper because a coverage
 * limit that looks different per screen is a coverage limit nobody trusts.
 */
export function drawCoverage(
  L: typeof leaflet,
  group: leaflet.LayerGroup,
  { boundary, policy, tone = "light", showBoundary = true, showZone = true }: DrawCoverageOptions,
) {
  const edge = tone === "dark" ? COVERAGE_COLORS.boundary : "#64748b"

  if (showBoundary) {
    for (const ring of rings(boundary)) {
      L.polygon(ring, {
        color: edge,
        weight: 1.5,
        opacity: tone === "dark" ? 0.5 : 0.7,
        fillColor: edge,
        fillOpacity: 0.06,
        dashArray: "4 5",
        interactive: false,
      }).addTo(group)
    }
  }

  if (!showZone || !policy) return

  const zoneRings = rings(policy.acceptance_geometry)
  if (zoneRings.length > 0) {
    for (const ring of zoneRings) {
      L.polygon(ring, {
        color: COVERAGE_COLORS.zone,
        weight: 1.5,
        opacity: 0.75,
        fillColor: COVERAGE_COLORS.zone,
        fillOpacity: 0.07,
        dashArray: "5 6",
        interactive: false,
      }).addTo(group)
    }
    return
  }

  const radius = number(policy.acceptance_radius_meters, 0)
  if (radius <= 0) return
  const lat = number(policy.acceptance_center_latitude, NaN)
  const lng = number(policy.acceptance_center_longitude, NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  L.circle([lat, lng], {
    radius,
    color: COVERAGE_COLORS.zone,
    weight: 1.5,
    opacity: 0.75,
    fillColor: COVERAGE_COLORS.zone,
    fillOpacity: 0.07,
    dashArray: "5 6",
    interactive: false,
  }).addTo(group)
}

function pointInRing(ring: [number, number][], lat: number, lng: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i]!
    const [latJ, lngJ] = ring[j]!
    if (lngI > lng !== lngJ > lng) {
      const crossing = ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI
      if (lat < crossing) inside = !inside
    }
  }
  return inside
}

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Same rule the server applies, run locally so a pin can refuse itself the
 * instant it is dragged out of scope instead of a third of a second later.
 * The server stays the authority; this only drives the cursor and the notice.
 */
export function insideCoverage(
  lat: number,
  lng: number,
  { boundary, policy }: CoverageInput,
): boolean {
  const zoneRings = rings(policy?.acceptance_geometry)
  if (zoneRings.length > 0) {
    return zoneRings.some((ring) => pointInRing(ring, lat, lng))
  }
  if (policy) {
    const radius = number(policy.acceptance_radius_meters, 0)
    const centerLat = number(policy.acceptance_center_latitude, NaN)
    const centerLng = number(policy.acceptance_center_longitude, NaN)
    if (radius > 0 && Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
      return metersBetween(centerLat, centerLng, lat, lng) <= radius
    }
  }
  const edges = rings(boundary)
  if (edges.length === 0) return true
  return edges.some((ring) => pointInRing(ring, lat, lng))
}

export const OUT_OF_SCOPE_MESSAGE = "This area is outside of our scope"
