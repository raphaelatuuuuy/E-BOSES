import type { PublicUser } from "@/features/dashboard/api"
import { streetLabelFromAddress } from "@/features/dashboard/components/feed-post-text"

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
  sidebar: "text-[16px]",
} as const

export const IC = {
  xxs: "size-4",
} as const

export const STROKE = 1.5

export const RAIL_CHEVRON = "size-7 shrink-0"

export const BARANGAY = "Marikina Heights"

function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}
function lat2tile(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
  )
}

export function railLiveMapSrc(lat: number, lng: number, zoom = 16) {
  const x = lon2tile(lng, zoom)
  const y = lat2tile(lat, zoom)
  return `https://a.basemaps.cartocdn.com/light_all/${zoom}/${x}/${y}@2x.png`
}

export function commentPlaceLabel(author: PublicUser) {
  const street =
    streetLabelFromAddress(author.street) ||
    (author.street && author.street.toLowerCase() !== "pending" ? author.street : null)
  if (street && street.toLowerCase() !== "marikina heights") return street
  if (author.barangay && author.barangay.toLowerCase() !== "pending") return author.barangay
  return BARANGAY
}
