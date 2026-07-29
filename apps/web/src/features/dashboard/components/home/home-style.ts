import type { PublicUser } from "@/features/dashboard/api"

/**
 * Shared style constants + tiny presentational helpers for the resident
 * Home feed (`pages/home.tsx`) and its extracted pieces
 * (`components/feed/post-comments.tsx`, `components/home/composer-card.tsx`,
 * `components/home/home-rail.tsx`). Kept in one file per the D1.1 extraction
 * brief instead of duplicating constants across the split files.
 *
 * NOTE: this is a plain `.ts` file (no JSX) — `UserAvatar` lives alongside in
 * `./user-avatar.tsx` for that reason.
 */

/** Type scale — bumped larger for readability (shared with sidebar nav sizing) */
export const FS = {
  logo: "text-[20px]",
  place: "text-[19px]",
  search: "text-[16px]",
  composer: "text-[16px]",
  chip: "text-[15px]",
  author: "text-[16px]",
  meta: "text-[14px]",
  body: "text-[16px]",
  railTitle: "text-[16px]",
  railBody: "text-[15px]",
  railLink: "text-[13px]",
  engage: "text-[15px]",
  label: "text-[12px]",
  footer: "text-[15px]",
  /** Sidebar / primary nav + Report CTA */
  sidebar: "text-[16px]",
  section: "text-[17px]",
} as const

export const IC = {
  /** 28px — primary interactive glyphs on Home */
  md: "size-7",
  /** 28px — engagement, search, chrome */
  sm: "size-7",
  /** 28px — secondary actions */
  xs: "size-7",
  /** 16px — tiny meta (globe) */
  xxs: "size-4",
} as const

export const STROKE = 1.5

/** Extra-large chevrons on rail action rows (Nextdoor-style) */
export const RAIL_CHEVRON = "size-7 shrink-0"

export const GET_STARTED_KEY = "eboses-home-get-started-dismissed"
export const BARANGAY = "Marikina Heights"

/** Web Mercator tile helpers for Carto light basemap (same as report location picker). */
function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}
function lat2tile(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
  )
}

/** Carto light tile — same basemap as create-report / location picker (no pin). */
export function railLiveMapSrc(lat: number, lng: number, zoom = 16) {
  const x = lon2tile(lng, zoom)
  const y = lat2tile(lat, zoom)
  return `https://a.basemaps.cartocdn.com/light_all/${zoom}/${x}/${y}@2x.png`
}

/**
 * Prefer the street line under Marikina Heights.
 * Address is typically: "123 Champaca Street, Marikina Heights, Marikina City"
 */
export function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}

export function commentPlaceLabel(author: PublicUser) {
  const street =
    streetLabelFromAddress(author.street) ||
    (author.street && author.street.toLowerCase() !== "pending" ? author.street : null)
  if (street && street.toLowerCase() !== "marikina heights") return street
  if (author.barangay && author.barangay.toLowerCase() !== "pending") return author.barangay
  return BARANGAY
}

export function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

export function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}
