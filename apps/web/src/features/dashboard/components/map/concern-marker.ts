import { MAP_COLORS } from "@/features/dashboard/components/alerts-map/lib"

/**
 * Concern pins carry their category as a glyph, the same way advisory pins
 * carry their tag. A plain dot said only "something is here"; the glyph says
 * what, and a resolved report swaps to a check so a cleared street reads as
 * cleared without opening it.
 *
 * Leaflet markers are raw HTML, so these are inline SVG paths rather than the
 * lucide components used everywhere else.
 */

const CATEGORY_PATHS: Record<string, string[]> = {
  infrastructure: [
    "M20 16H4a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2Z",
    "M12 3 5 16",
    "M19 16 12 3",
    "M13 7h-2",
  ],
  environment: [
    "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z",
    "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12",
  ],
  public_safety: [
    "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
    "m9 12 2 2 4-4",
  ],
  other: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "m21 21-4.35-4.35"],
}

const RESOLVED_PATHS = ["M20 6 9 17l-5-5"]

const RESOLVED_STATUSES = new Set(["resolved", "partially_resolved"])

export function isResolvedStatus(status: string) {
  return RESOLVED_STATUSES.has(status)
}

function glyph(paths: string[], size: number) {
  const inner = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("")
  const glyphSize = Math.round(size * 0.52)
  return `<svg viewBox="0 0 24 24" style="position:absolute;left:50%;top:50%;width:${glyphSize}px;height:${glyphSize}px;transform:translate(-50%,-50%)">${inner}</svg>`
}

export function concernMarkerHtml({
  category,
  status,
  selected,
}: {
  category: string
  status: string
  selected: boolean
}) {
  const resolved = isResolvedStatus(status)
  const size = selected ? 34 : 26
  const border = selected ? 3 : 2
  const color = resolved
    ? MAP_COLORS.resolved
    : selected
      ? MAP_COLORS.concern
      : MAP_COLORS.structure
  const paths = resolved ? RESOLVED_PATHS : (CATEGORY_PATHS[category] ?? CATEGORY_PATHS.other!)

  return `<div style="position:relative;width:${size}px;height:${size}px">
    <div style="position:absolute;inset:0;border-radius:999px;background:${color};border:${border}px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.28)"></div>
    ${glyph(paths, size)}
  </div>`
}

export function concernMarkerSize(selected: boolean) {
  return selected ? 34 : 26
}
