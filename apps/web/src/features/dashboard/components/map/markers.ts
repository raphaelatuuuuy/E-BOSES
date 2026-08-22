import { createElement, type ComponentType } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as lucideIcons from "lucide-react"

export const MAP_COLORS = {
  emergency: "#f23b35",
  concern: "#ff6a1a",
  structure: "#7f8db8",
  route: "#ff6a1a",
  advisory: "#f2a03d",
  responder: "#2563eb",
  responderAssigned: "#4dc4ff",
  responderOffDuty: "#5d6785",
  resident: "#64748b",
  official: "#7c3aed",
  resolved: "#16a34a",
  you: "#2b7fff",
} as const

export type MarkerTone = "light" | "dark"

export const GLYPHS = {
  emergency: [
    "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
    "M12 9v4",
    "M12 17h.01",
  ],
  resolved: ["M20 6 9 17l-5-5"],
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
  person: [
    "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",
    "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  ],
} as const

export function concernGlyph(category: string): readonly string[] {
  return GLYPHS[category as keyof typeof GLYPHS] ?? GLYPHS.other
}

/**
 * Render a Lucide icon's SVG inline as a string for use in Leaflet divIcon HTML.
 * This avoids React rendering — just raw SVG with the icon's path data.
 * Falls back to null if the icon can't be resolved.
 */
const LUCIDE_SVG_CACHE = new Map<string, string>()

export function lucideIconSvgHtml(iconKey: string | undefined | null): string | null {
  if (!iconKey) return null
  const cached = LUCIDE_SVG_CACHE.get(iconKey)
  if (cached !== undefined) return cached || null

  let html = ""
  try {
    const icon = (lucideIcons as unknown as Record<string, ComponentType<{ size?: number; strokeWidth?: number }>>)[
      iconKey
    ]
    if (icon) html = renderToStaticMarkup(createElement(icon, { size: 16, strokeWidth: 2.2 }))
  } catch {
    html = ""
  }
  LUCIDE_SVG_CACHE.set(iconKey, html)
  return html || null
}

/**
 * Explicit, pre-rounded pixel width/height (rather than a CSS percentage of
 * the disc) so the glyph stays perfectly square and centered at every disc
 * size — idle, selected (1.3x) or mid hover-grow transform.
 */
function svg(paths: readonly string[], strokeWidth = 2.2, box = 26) {
  const inner = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("")
  const iconPx = Math.round(box * 0.54)
  return `<svg viewBox="0 0 24 24" width="${iconPx}" height="${iconPx}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`
}

export interface GlyphPinOptions {
  paths: readonly string[]
  color: string
  size?: number
  selected?: boolean
  live?: boolean
  tone?: MarkerTone
  strokeWidth?: number
  /**
   * Renders muted grey until hovered, focused or selected — an opt-in used by
   * community-report pins so the map reads calm until something is actually
   * being looked at. Maps that don't style `.is-idle-neutral` are unaffected.
   */
  idleNeutral?: boolean
  /**
   * Grows slightly on hover/focus without changing colour — an opt-in used by
   * advisory pins. Maps that don't style `.is-hover-grow` are unaffected.
   */
  hoverGrow?: boolean
}

/**
 * Circle with the record's own glyph inside it — one shape for concerns,
 * emergencies and advisories, on every role's map. Only the colour changes.
 */
export function glyphPinHtml({
  paths,
  color,
  size = 26,
  selected = false,
  live = false,
  tone = "light",
  strokeWidth = 2.2,
  idleNeutral = false,
  hoverGrow = false,
}: GlyphPinOptions) {
  const box = selected ? Math.round(size * 1.3) : size
  const ring = selected ? 3 : 2
  const neutralClass = idleNeutral && !selected ? " is-idle-neutral" : ""
  const hoverGrowClass = hoverGrow ? " is-hover-grow" : ""
  return `<span class="eboses-pin eboses-pin--glyph${live ? " is-live" : ""}${
    tone === "dark" ? " is-dark" : ""
  }${neutralClass}${hoverGrowClass}" style="--pin:${color};--size:${box}px;--ring:${ring}px">${
    live ? '<span class="eboses-pin__halo"></span>' : ""
  }<span class="eboses-pin__disc">${svg(paths, strokeWidth, box)}</span></span>`
}

export function glyphPinSize(size = 26, selected = false) {
  return selected ? Math.round(size * 1.3) : size
}

export interface DotPinOptions {
  color?: string
  size?: number
  live?: boolean
  tone?: MarkerTone
}

/**
 * Solid dot with a soft blink — the pin used where a map is showing one exact
 * place rather than a set of records: report dialogs, the SOS confirm step and
 * the emergency tracking sheet.
 */
export function dotPinHtml({
  color = MAP_COLORS.you,
  size = 14,
  live = true,
  tone = "light",
}: DotPinOptions = {}) {
  return `<span class="eboses-pin eboses-pin--dot${live ? " is-live" : ""}${
    tone === "dark" ? " is-dark" : ""
  }" style="--pin:${color};--size:${size}px">${
    live ? '<span class="eboses-pin__halo"></span>' : ""
  }<span class="eboses-pin__core"></span></span>`
}

/**
 * People are context, not records: they stay plain dots so a glyph pin always
 * means "something was reported here".
 */
export function personDotHtml(color: string, focused = false, tone: MarkerTone = "light") {
  return dotPinHtml({ color, size: focused ? 13 : 10, live: focused, tone })
}
