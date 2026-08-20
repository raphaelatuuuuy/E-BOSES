import {
  concernGlyph,
  glyphPinHtml,
  glyphPinSize,
  GLYPHS,
  MAP_COLORS,
  type MarkerTone,
} from "@/features/dashboard/components/map/markers"

const RESOLVED_STATUSES = new Set(["resolved", "partially_resolved"])

const BASE_SIZE = 26

export function isResolvedStatus(status: string) {
  return RESOLVED_STATUSES.has(status)
}

export function concernMarkerHtml({
  category,
  status,
  selected,
  tone = "light",
}: {
  category: string
  status: string
  selected: boolean
  tone?: MarkerTone
}) {
  const resolved = isResolvedStatus(status)
  return glyphPinHtml({
    paths: resolved ? GLYPHS.resolved : concernGlyph(category),
    color: resolved ? MAP_COLORS.resolved : MAP_COLORS.concern,
    size: BASE_SIZE,
    selected,
    tone,
    // A resolved report always reads green — only open (non-resolved)
    // reports go neutral-grey until hovered or opened.
    idleNeutral: !resolved,
  })
}

export function concernMarkerSize(selected: boolean) {
  return glyphPinSize(BASE_SIZE, selected)
}
