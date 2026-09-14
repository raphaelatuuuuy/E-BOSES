import {
  DropletsIcon,
  HeartPulseIcon,
  MegaphoneIcon,
  ShieldAlertIcon,
  TrafficConeIcon,
  UsersIcon,
  WavesIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { glyphPinHtml, glyphPinSize, type MarkerTone } from "@/features/dashboard/components/map/markers"

/**
 * One colour per advisory tag. The map areas, markers and tooltips read the
 * tag's own colour, so a community event reads green and a flooding advisory
 * blue. ADVISORY_COLOR stays the colour of the generic fallback tag.
 */
export const ADVISORY_COLOR = "#f2a03d"
export const ADVISORY_SOFT = "#fdf3e3"

export const ANNOUNCEMENT_ACCENT = {
  color: "#1f6c98",
  soft: "#eaf2f8",
  ink: "#14455f",
}

export interface AdvisoryTagMeta {
  /** Stored value of Announcement.tag. */
  value: string
  label: string
  icon: LucideIcon
  /** Raw inline SVG paths (24×24, stroke-based) for Leaflet divIcon markers. */
  svgPaths: string[]
  svgStrokeWidth: number
  /** Map + marker colour for this tag. */
  color: string
  /** Tinted background paired with the tag colour. */
  soft: string
  /** Darker tag shade for text on the tinted background. */
  ink: string
}

export const ADVISORY_TAGS: AdvisoryTagMeta[] = [
  {
    value: "Water outage",
    label: "Water outage",
    icon: DropletsIcon,
    svgPaths: [
      "M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z",
      "M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97",
    ],
    svgStrokeWidth: 2,
    color: "#0ea5e9",
    soft: "#e8f6fd",
    ink: "#075985",
  },
  {
    value: "Electric outage",
    label: "Electric outage",
    icon: ZapIcon,
    svgPaths: [
      "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
    ],
    svgStrokeWidth: 2,
    color: "#d97706",
    soft: "#fdf1e2",
    ink: "#92400e",
  },
  {
    value: "Road closure",
    label: "Road closure",
    icon: TrafficConeIcon,
    svgPaths: [
      "M20 16H4a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2Z",
      "M12 3 5 16",
      "M19 16 12 3",
      "M13 7h-2",
    ],
    svgStrokeWidth: 2,
    color: "#ea580c",
    soft: "#fdeee4",
    ink: "#9a3412",
  },
  {
    value: "Flooding",
    label: "Flooding",
    icon: WavesIcon,
    svgPaths: [
      "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
      "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
      "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    ],
    svgStrokeWidth: 2,
    color: "#2563eb",
    soft: "#e9effd",
    ink: "#1e40af",
  },
  {
    value: "Health advisory",
    label: "Health advisory",
    icon: HeartPulseIcon,
    svgPaths: [
      "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-8.1 7.4l1.1 1.1L12 21l8-7.9 1.1-1.1a5.5 5.5 0 0 0-.3-7.4z",
      "M3.5 12h4L9 9l3 6 2-3h6.5",
    ],
    svgStrokeWidth: 2,
    color: "#10b981",
    soft: "#e6f7ef",
    ink: "#065f46",
  },
  {
    value: "Community event",
    label: "Community event",
    icon: UsersIcon,
    svgPaths: [
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
      "M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
      "M22 21v-2a4 4 0 0 0-3-3.87",
      "M16 3.13a4 4 0 0 1 0 7.75",
    ],
    svgStrokeWidth: 2,
    color: "#16a34a",
    soft: "#e9f7ee",
    ink: "#166534",
  },
  {
    value: "Safety notice",
    label: "Safety notice",
    icon: ShieldAlertIcon,
    svgPaths: [
      "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
      "M12 8v4",
      "M12 16h.01",
    ],
    svgStrokeWidth: 2,
    color: "#8b5cf6",
    soft: "#f0eafd",
    ink: "#5b21b6",
  },
  {
    value: "General advisory",
    label: "General advisory",
    icon: MegaphoneIcon,
    svgPaths: [
      "m3 11 18-5v12L3 14v-3z",
      "M11.6 16.8a3 3 0 1 1-5.8-1.6",
    ],
    svgStrokeWidth: 2,
    color: "#f2a03d",
    soft: "#fdf3e3",
    ink: "#92400e",
  },
]

export function advisoryMeta(tag: string | null | undefined): AdvisoryTagMeta {
  const normalized = (tag ?? "").trim().toLowerCase()
  return (
    ADVISORY_TAGS.find((meta) => meta.value.toLowerCase() === normalized) ??
    ADVISORY_TAGS[ADVISORY_TAGS.length - 1]!
  )
}

/**
 * What to print for a tag. Announcements predating this list carry their own
 * wording ("Public Works"), and calling those "General advisory" contradicts
 * what the editor shows — so an unknown tag prints itself.
 */
export function advisoryLabel(tag: string | null | undefined): string {
  const raw = (tag ?? "").trim()
  if (!raw) return ADVISORY_TAGS[ADVISORY_TAGS.length - 1]!.label
  const match = ADVISORY_TAGS.find((meta) => meta.value.toLowerCase() === raw.toLowerCase())
  return match?.label ?? raw
}

const ADVISORY_GLYPH_CACHE = new Map<string, string>()

/** Static SVG of the tag's own Lucide icon — the same component the detail sheet renders. */
export function advisoryGlyphHtml(
  tag: string | null | undefined,
  px = 24
): string {
  const meta = advisoryMeta(tag)
  const key = `${meta.value}|${px}`
  const cached = ADVISORY_GLYPH_CACHE.get(key)
  if (cached) return cached
  const html = renderToStaticMarkup(
    createElement(meta.icon, { size: px, strokeWidth: meta.svgStrokeWidth })
  )
  ADVISORY_GLYPH_CACHE.set(key, html)
  return html
}

/** Leaflet divIcon markup — the same circle-with-glyph every map record uses. */
export function advisoryMarkerHtml(
  tag: string | null | undefined,
  size = 26,
  tone: MarkerTone = "light",
  selected = false,
  colorOverride?: string | null,
): string {
  const meta = advisoryMeta(tag)
  return glyphPinHtml({
    paths: meta.svgPaths,
    content: advisoryGlyphHtml(tag),
    color: colorOverride ?? meta.color,
    size,
    selected,
    tone,
    strokeWidth: meta.svgStrokeWidth,
    tint: true,
    hoverGrow: true,
    flat: true,
  })
}

export function advisoryMarkerSize(size = 26, selected = false) {
  return glyphPinSize(size, selected)
}
