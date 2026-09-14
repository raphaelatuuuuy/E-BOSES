import {
  concernGlyph,
  glyphPinHtml,
  glyphPinSize,
  MAP_COLORS,
  type MarkerTone,
} from "@/features/dashboard/components/map/markers"
import { lucideIconPaths } from "@/features/dashboard/components/map/lucide-glyphs"

import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"

const BASE_SIZE = 26

export function isResolvedStatus(status: string) {
  return isResolvedRecord({ status })
}

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Same priority a report's icon uses elsewhere in the app (report-icon.tsx):
 * the official's uploaded image, then their short custom label, then the
 * picked Lucide icon, then the fixed per-category glyph as a last resort.
 */
export function concernMarkerHtml({
  category,
  iconKey,
  imageUrl,
  customLabel,
  status,
  severity,
  selected,
  tone = "light",
  hoverGrow = false,
  tint,
}: {
  category: string
  iconKey?: string
  imageUrl?: string
  customLabel?: string
  status: string
  severity?: string | null
  selected: boolean
  tone?: MarkerTone
  hoverGrow?: boolean
  tint?: boolean
}) {
  const resolved = isResolvedStatus(status)
  const critical = (severity ?? "").toLowerCase() === "critical"
  const box = selected ? Math.round(BASE_SIZE * 1.3) : BASE_SIZE
  let content: string | undefined
  // A critical report has one unambiguous visual language on every map:
  // red pin plus the triangle alert glyph. Category artwork must not replace it.
  if (!critical && !resolved && imageUrl) {
    content = `<img src="${escapeHtml(imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px" />`
  } else if (!critical && !resolved && customLabel?.trim()) {
    const short = escapeHtml(customLabel.trim().slice(0, 2).toUpperCase())
    content = `<span style="font-size:${Math.round(box * 0.42)}px;font-weight:700;line-height:1">${short}</span>`
  }
  const paths = critical
    ? concernGlyph("emergency")
    : resolved
      ? (lucideIconPaths("check") ?? concernGlyph(category))
      : ((iconKey ? lucideIconPaths(iconKey) : null) ?? concernGlyph(category))
  return glyphPinHtml({
    paths,
    content,
    color: critical
      ? MAP_COLORS.emergency
      : resolved
        ? MAP_COLORS.resolved
        : MAP_COLORS.concern,
    size: BASE_SIZE,
    selected,
    tone,
    tint: tint ?? (critical || resolved),
    idleNeutral: false,
    hoverGrow,
  })
}

export function concernMarkerSize(selected: boolean) {
  return glyphPinSize(BASE_SIZE, selected)
}
