import type {
  Concern,
  ConcernCategory,
  ConcernStatus,
  ResidentMapConcern,
  ResidentMapEmergency,
} from "@/features/dashboard/api"

import type leaflet from "leaflet"

/**
 * Coordinate, feed-merge, and emergency-brief utilities shared by
 * `pages/resident-alerts-map.tsx` and `components/resident-map/*`.
 * Pulled out per the D1.2 extraction brief so the leaflet map component and
 * the page don't duplicate this logic.
 */

/** Default pin for Marikina Heights (used until map meta loads). */
export const BARANGAY_CENTER = { lat: 14.6507, lng: 121.1133 }
/** Loose Marikina City bbox — pins outside this are treated as invalid. */
export const MAP_BOUNDS = {
  minLat: 14.58,
  maxLat: 14.72,
  minLng: 121.05,
  maxLng: 121.18,
}
/** Max distance from barangay center to treat device GPS as local. */
export const LOCAL_GPS_MAX_M = 25_000

export const categoryMeta: Record<ConcernCategory, { label: string; color: string; bg: string }> = {
  infrastructure: { label: "Infrastructure", color: "#2447b3", bg: "#eef3ff" },
  environment: { label: "Environment", color: "#16a34a", bg: "#e9f9ef" },
  public_safety: { label: "Public Safety", color: "#ff5003", bg: "#ffeceb" },
  others: { label: "Others", color: "#ff6a1a", bg: "#fff1ea" },
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

export function timeAgo(value?: string | null) {
  if (!value) return ""
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function formatDistance(meters: number | null) {
  if (meters == null || !Number.isFinite(meters)) return null
  // Absurd distances (wrong GPS origin) — hide rather than show 13000 km
  if (meters > 80_000) return null
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

export function inMapBounds(lat: number, lng: number) {
  return (
    lat >= MAP_BOUNDS.minLat &&
    lat <= MAP_BOUNDS.maxLat &&
    lng >= MAP_BOUNDS.minLng &&
    lng <= MAP_BOUNDS.maxLng
  )
}

/**
 * Normalize report coordinates for Leaflet [lat, lng].
 * - Rejects NaN / out-of-range
 * - Auto-swaps if values were stored as [lng, lat] (common PH bug: 121 / 14)
 * - Rejects pins far outside Marikina so markers don't "teleport" across the world
 */
export function validCoord(lat?: string | number | null, lng?: string | number | null) {
  let latitude = Number(lat)
  let longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  // Classic swap: longitude-looking value in latitude field
  if (
    Math.abs(latitude) > 90 &&
    Math.abs(longitude) <= 90 &&
    Math.abs(latitude) <= 180
  ) {
    const t = latitude
    latitude = longitude
    longitude = t
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null
  }
  if (!inMapBounds(latitude, longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

export function hasMapCoords(post: Concern) {
  return Boolean(validCoord(post.latitude, post.longitude))
}

/** Prefer device GPS only when it is near Marikina Heights. */
export function isLocalGps(pos: { lat: number; lng: number } | null) {
  if (!pos) return false
  if (inMapBounds(pos.lat, pos.lng)) return true
  const d = haversineMeters(BARANGAY_CENTER.lat, BARANGAY_CENTER.lng, pos.lat, pos.lng)
  return d <= LOCAL_GPS_MAX_M
}

/**
 * Community feed intentionally masks lat/lng (privacy_safe).
 * Resident alerts-map snapshot still exposes public pin coords — merge them back.
 */
export function mergeFeedWithMapCoords(
  feed: Concern[],
  mapConcerns: ResidentMapConcern[] | undefined,
): Concern[] {
  const coordsById = new Map<number, { latitude: string; longitude: string; address?: string }>()
  for (const c of mapConcerns ?? []) {
    if (c.latitude == null || c.longitude == null) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    coordsById.set(c.id, {
      latitude: String(c.latitude),
      longitude: String(c.longitude),
      address: c.address,
    })
  }

  const feedById = new Map(feed.map((p) => [p.id, p]))
  const merged: Concern[] = feed.map((post) => {
    const coords = coordsById.get(post.id)
    if (!coords) return post
    return {
      ...post,
      latitude: coords.latitude,
      longitude: coords.longitude,
      // Keep barangay-level address from feed privacy, but prefer map street if present
      address: coords.address || post.address,
    }
  })

  // Map-only pins (not in feed payload) still show as lightweight list/map items
  for (const c of mapConcerns ?? []) {
    if (feedById.has(c.id)) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    merged.push(mapConcernToFeedPost(c))
  }

  return merged.filter(hasMapCoords)
}

export function mapConcernToFeedPost(c: ResidentMapConcern): Concern {
  return {
    id: c.id,
    public_id: String(c.id),
    tracking_id: c.tracking_id,
    validation_status: "accepted",
    validation_summary: "",
    rejection_code: "",
    status_version: 0,
    reporter: {
      id: c.reporter.id,
      full_name: c.reporter.full_name,
      role: c.reporter.role,
      initials: (c.reporter.full_name?.[0] || "?").toUpperCase(),
      last_seen_at: null,
      barangay: c.reporter.barangay,
    },
    title: c.title,
    description: c.description || "",
    category: c.category,
    // The live-map payload is deliberately slim and carries neither the
    // category row nor the routed unit. Both are nullable on Concern, so null
    // is the accurate value here rather than a fabricated placeholder — a
    // map-only pin genuinely has not been routed to a department.
    category_ref: null,
    assigned_department: null,
    status: c.status as ConcernStatus,
    address: c.address || c.barangay,
    latitude: c.latitude,
    longitude: c.longitude,
    location_source: "map",
    location_accuracy: null,
    barangay: c.barangay,
    update_text: "",
    visibility: "community",
    media: c.preview_url
      ? [
          {
            id: 0,
            original_filename: "preview.jpg",
            mime_type: "image/jpeg",
            file_size: 0,
            preview_url: c.preview_url,
            raw_url: c.preview_url,
            validation_status: "accepted" as const,
            validation_detail: "",
            uploaded_at: c.created_at,
          },
        ]
      : [],
    status_events: [],
    comments: [],
    vote_count: 0,
    comment_count: 0,
    priority_score: c.priority === "high" ? 10 : 0,
    user_vote: 0,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

/** Human-readable SOS / emergency pipeline status */
export function emergencyStatusLabel(status: string): { label: string; live: boolean } {
  const s = status.toLowerCase()
  if (s === "submitted") return { label: "Submitted", live: true }
  if (s === "routed") return { label: "Routed", live: true }
  if (s === "acknowledged") return { label: "Responder routed", live: true }
  if (s === "en_route") return { label: "En route", live: true }
  if (s === "nearby") return { label: "Nearby", live: true }
  if (s === "arrived") return { label: "Arrived", live: true }
  if (s === "resolved") return { label: "Resolved", live: false }
  if (s === "cancelled") return { label: "Cancelled", live: false }
  return {
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Active",
    live: true,
  }
}

export function emergencyBrief(em: ResidentMapEmergency) {
  const type = (em.type_label || em.type || "Emergency").replace(/_/g, " ")
  const note = (em.note || "").trim()
  const street = (em.address || em.barangay || "").trim()
  const detail = note || street || "Ongoing emergency"
  const short = detail.length > 48 ? `${detail.slice(0, 46)}…` : detail
  const st = emergencyStatusLabel(em.status)
  return { title: type, line: short, status: st }
}
