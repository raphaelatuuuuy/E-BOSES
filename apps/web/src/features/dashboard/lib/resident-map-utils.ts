import type {
  Concern,
  ConcernCategory,
  ConcernStatus,
  ResidentMapConcern,
  ResidentMapEmergency,
} from "@/features/dashboard/api"

import type leaflet from "leaflet"

export const NETWORK_FALLBACK_CENTER = { lat: 14.5995, lng: 120.9842 }

export const categoryMeta: Record<
  ConcernCategory,
  { label: string; color: string; bg: string }
> = {
  infrastructure: { label: "Infrastructure", color: "#2447b3", bg: "#eef3ff" },
  environment: { label: "Environment", color: "#16a34a", bg: "#e9f9ef" },
  public_safety: { label: "Public Safety", color: "#ff5003", bg: "#ffeceb" },
  others: { label: "Others", color: "#ff6a1a", bg: "#fff1ea" },
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) {
  const r = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

export function formatDistance(meters: number | null) {
  if (meters == null || !Number.isFinite(meters)) return null

  if (meters > 80_000) return null
  if (meters < 1000) return `${Math.round(meters)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

export function validCoord(
  lat?: string | number | null,
  lng?: string | number | null
) {
  if (lat == null || lng == null || lat === "" || lng === "") return null
  let latitude = Number(lat)
  let longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

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
  return [latitude, longitude] as leaflet.LatLngTuple
}

export function hasMapCoords(post: Concern) {
  return Boolean(validCoord(post.latitude, post.longitude))
}

export function isLocalGps(
  pos: { lat: number; lng: number } | null,
  geometry?: { type?: string; coordinates?: unknown } | null
) {
  if (!pos || !validCoord(pos.lat, pos.lng)) return false
  const point = pos
  if (!geometry?.coordinates) return true
  const polygons =
    geometry.type === "MultiPolygon"
      ? (geometry.coordinates as number[][][][])
      : [geometry.coordinates as number[][][]]
  return polygons.some((polygon) => {
    function inRing(ring: number[][]) {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i] ?? []
        const [xj, yj] = ring[j] ?? []
        if ([xi, yi, xj, yj].some((value) => !Number.isFinite(value))) continue
        const cross =
          (point.lng - xi) * (yj - yi) - (point.lat - yi) * (xj - xi)
        if (
          Math.abs(cross) < 1e-10 &&
          point.lng >= Math.min(xi, xj) &&
          point.lng <= Math.max(xi, xj) &&
          point.lat >= Math.min(yi, yj) &&
          point.lat <= Math.max(yi, yj)
        )
          return true
        const crosses =
          yi > point.lat !== yj > point.lat &&
          point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
        if (crosses) inside = !inside
      }
      return inside
    }
    const outer = polygon[0] ?? []
    const holes = polygon.slice(1)
    return inRing(outer) && !holes.some(inRing)
  })
}

export function mergeFeedWithMapCoords(
  feed: Concern[],
  mapConcerns: ResidentMapConcern[] | undefined,
  homeCommunityId?: string | null
): Concern[] {
  const coordsById = new Map<
    number,
    {
      latitude: string
      longitude: string
      address?: string
      summary?: string
      notification_subject?: string
      severity?: Concern["severity"]
      severity_assessed?: boolean
    }
  >()
  for (const c of mapConcerns ?? []) {
    if (c.latitude == null || c.longitude == null) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    coordsById.set(c.id, {
      latitude: String(c.latitude),
      longitude: String(c.longitude),
      address: c.address,
      summary: c.summary,
      notification_subject: c.notification_subject,
      severity: c.severity,
      severity_assessed: c.severity_assessed,
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

      address: coords.address || post.address,
      summary: coords.summary || post.summary,
      notification_subject:
        coords.notification_subject || post.notification_subject,
      severity: coords.severity ?? post.severity,
      severity_assessed: coords.severity_assessed ?? post.severity_assessed,
    }
  })

  for (const c of mapConcerns ?? []) {
    if (feedById.has(c.id)) continue
    if (!validCoord(c.latitude, c.longitude)) continue
    merged.push(mapConcernToFeedPost(c, homeCommunityId))
  }

  return merged.filter(hasMapCoords)
}

export function mapConcernToFeedPost(
  c: ResidentMapConcern,
  homeCommunityId?: string | null
): Concern {
  const severityBand = {
    low: 0,
    moderate: 1000,
    high: 2000,
    critical: 3000,
  } as const
  const severity = c.severity ?? (c.priority === "normal" ? "low" : c.priority)
  return {
    id: c.id,
    community: c.community,
    reporter_community: null,
    is_cross_community: false,
    access_mode:
      c.community.id === homeCommunityId ? "local_public" : "foreign_read_only",
    // Public concerns remain part of the community conversation even when
    // their incident community differs from the viewer's home community.
    can_interact: true,
    public_id: String(c.id),
    tracking_id: c.tracking_id,
    validation_status: "accepted",
    validation_summary: "",
    summary: c.summary || "",
    rejection_code: "",
    status_version: 0,
    also_reported_count: 0,
    also_reported_by: null,
    recurrence_of: null,
    community_incident: null as never,
    reporter: {
      id: c.reporter.id,
      full_name: c.reporter.full_name,
      role: c.reporter.role,
      initials: (c.reporter.full_name?.[0] || "U").toUpperCase(),
      last_seen_at: null,
      barangay: c.reporter.barangay,
    },
    title: c.title,
    notification_subject: c.notification_subject,
    description: c.description || "",
    category: c.category,

    category_ref: c.category_ref
      ? {
          id: 0,
          code: c.category_ref.code,
          name: c.category_ref.name,
          description: "",
          icon_key: c.category_ref.icon_key,
          custom_icon_label: c.category_ref.custom_icon_label,
          icon_image_url: c.category_ref.icon_image_url,
        }
      : null,
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
    official_title: "",
    archived_at: null,
    reopened_at: null,
    reopen_count: 0,
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

            privacy_state: "protected" as const,
            public_visible: true,
            privacy_detected_classes: [],
            relevance_state: "unverified",
            relevance_reason: "",
            redactions: [],
            uploaded_at: c.created_at,
          },
        ]
      : [],
    status_events: [],
    comments: [],
    vote_count: 0,
    comment_count: 0,
    priority_score: severityBand[severity as keyof typeof severityBand] ?? 0,
    user_vote: 0,
    created_at: c.created_at,
    updated_at: c.updated_at,
    severity,
    severity_assessed: c.severity_assessed,
  }
}

export function emergencyStatusLabel(status: string): {
  label: string
  live: boolean
} {
  const s = status.toLowerCase()
  if (s === "submitted") return { label: "Alert sent", live: true }
  if (s === "routing") return { label: "Finding help", live: true }
  if (s === "routed") return { label: "Help on the way", live: true }
  if (s === "awaiting_acknowledgment" || s === "acknowledged")
    return { label: "Help on the way", live: true }
  if (s === "en_route") return { label: "On the way", live: true }
  if (s === "nearby") return { label: "Nearby", live: true }
  if (s === "arrived") return { label: "On scene", live: true }
  if (s === "resident_safe") return { label: "Resident safe", live: true }
  if (s === "backup_requested")
    return { label: "Extra help requested", live: true }
  if (s === "backup_assigned")
    return { label: "Extra help on the way", live: true }
  if (s === "in_progress") return { label: "In progress", live: true }
  if (s === "transfer_required") return { label: "Transferring", live: true }
  if (s === "escalation_required")
    return { label: "More help coming", live: true }
  if (s === "resolved") return { label: "Resolved", live: false }
  if (s === "cancelled") return { label: "Cancelled", live: false }
  if (s === "closed") return { label: "Closed", live: false }
  if (s === "false_alarm") return { label: "False alarm", live: false }
  if (s === "invalid") return { label: "Invalid", live: false }
  return { label: "Active", live: true }
}

/** Capitalize first letter only: "FLOOD" → "Flood", "fire_accident" → "Fire accident" */
function titleCase(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Extract a readable street from the address, skipping generic placeholders. */
function readableStreet(
  address: string | undefined,
  barangay: string | undefined
): string {
  const raw = (address || "").trim()
  if (!raw) return barangay || "this area"
  // Split by comma and take the first meaningful segment
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
  for (const part of parts) {
    const lower = part.toLowerCase()
    // Skip generic placeholders
    if (lower === "pinned location on map") continue
    if (
      lower === "marikina heights" ||
      lower === "marikina" ||
      lower === "marikina city"
    )
      continue
    if (lower === "pending") continue
    return part
  }
  return barangay || "this area"
}

export function emergencyBrief(em: ResidentMapEmergency) {
  const type = titleCase(
    (em.type_label || em.type || "Emergency").replace(/_/g, " ")
  )
  const st = emergencyStatusLabel(em.status)
  const street = readableStreet(em.address, em.barangay)
  const safetyNote = st.live
    ? `An ongoing ${type.toLowerCase()} emergency around ${street}. Stay away from the area and follow instructions from barangay officials.`
    : `A ${type.toLowerCase()} emergency was reported around ${street}.`
  return { title: type, status: st, street, safetyNote }
}
