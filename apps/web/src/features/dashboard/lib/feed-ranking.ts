import type { Concern } from "@/features/dashboard/api"
import { BARANGAY_CENTER, haversineMeters } from "@/features/dashboard/lib/resident-map-utils"
import { isConcernActive } from "@/features/dashboard/lib/status-vocabulary"

export const NEARBY_RADIUS_METERS = 1500

export type FeedOrigin = { lat: number; lng: number }

export function concernDistanceMeters(concern: Concern, origin: FeedOrigin) {
  const lat = Number(concern.latitude)
  const lng = Number(concern.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return haversineMeters(origin.lat, origin.lng, lat, lng)
}

function hoursSince(value: string) {
  const created = new Date(value).getTime()
  if (!Number.isFinite(created)) return Number.POSITIVE_INFINITY
  return Math.max(0, (Date.now() - created) / 3_600_000)
}

function engagement(concern: Concern) {
  return concern.vote_count + concern.comment_count * 2
}

export function relevanceScore(concern: Concern, origin: FeedOrigin) {
  const age = hoursSince(concern.created_at)
  const freshness = 1 / (1 + age / 24)
  const distance = concernDistanceMeters(concern, origin)
  const proximity = distance == null ? 0.3 : 1 / (1 + distance / NEARBY_RADIUS_METERS)
  const attention = Math.log1p(engagement(concern)) / 4
  const live = isConcernActive(concern) ? 0.35 : 0
  return freshness * 1.2 + proximity * 1.1 + attention + live
}

export function rankFeed(concerns: Concern[], tab: string, origin: FeedOrigin | null) {
  const from = origin ?? BARANGAY_CENTER
  const list = [...concerns]

  if (tab === "trending") {
    return list.sort((a, b) => engagement(b) - engagement(a) || hoursSince(a.created_at) - hoursSince(b.created_at))
  }

  if (tab === "nearby") {
    return list
      .map((concern) => ({ concern, distance: concernDistanceMeters(concern, from) }))
      .filter((entry) => entry.distance != null && entry.distance <= NEARBY_RADIUS_METERS)
      .sort((a, b) => (a.distance as number) - (b.distance as number))
      .map((entry) => entry.concern)
  }

  if (tab === "recent") {
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  if (tab === "resolved") {
    return list
      .filter((concern) => concern.status === "resolved")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }

  return list.sort((a, b) => relevanceScore(b, from) - relevanceScore(a, from))
}
