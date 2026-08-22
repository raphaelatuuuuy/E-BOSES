import {
  concernGlyph,
  glyphPinHtml,
  glyphPinSize,
  MAP_COLORS,
  type MarkerTone,
} from "@/features/dashboard/components/map/markers"
import { lucideIconPaths } from "@/features/dashboard/components/map/lucide-glyphs"

const RESOLVED_STATUSES = new Set(["resolved", "partially_resolved"])

const BASE_SIZE = 26

export function isResolvedStatus(status: string) {
  return RESOLVED_STATUSES.has(status)
}

export function concernMarkerHtml({
  category,
  iconKey,
  status,
  selected,
  tone = "light",
}: {
  category: string
  iconKey?: string
  status: string
  selected: boolean
  tone?: MarkerTone
}) {
  const resolved = isResolvedStatus(status)
  const paths = (iconKey ? lucideIconPaths(iconKey) : null) ?? concernGlyph(category)
  return glyphPinHtml({
    paths,
    color: resolved ? MAP_COLORS.resident : MAP_COLORS.concern,
    size: BASE_SIZE,
    selected,
    tone,
    idleNeutral: false,
  })
}

export function concernMarkerSize(selected: boolean) {
  return glyphPinSize(BASE_SIZE, selected)
}
