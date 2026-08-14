import type {
  OcrDocumentType,
  OcrFieldDefinition,
  OcrFieldHints,
  OcrFieldRegion,
} from "@/features/ocr/api"
import { resolveFieldSide } from "@/features/ocr/api"

export type FieldRegion = OcrFieldRegion

// Categorical ramp for field boxes/chips. Every color passes 4.5:1 contrast
// with the white 10px label text; orange-700 (rust) is deliberately distinct
// from the brand orange, and red-600 stays brighter than the rose error pills.
export const FIELD_COLORS = [
  "#2563eb", // blue — 5.1:1
  "#15803d", // green-700 — 5.0:1 (was #16a34a, 3.3:1)
  "#a16207", // yellow-700 — 4.9:1 (was #ca8a04, 2.9:1)
  "#dc2626", // red-600 — 4.8:1
  "#9333ea", // purple-600 — 5.4:1
  "#0e7490", // cyan-700 — 5.4:1 (was #0891b2, 3.7:1)
  "#c2410c", // orange-700 — 5.2:1 (was #ea580c, 3.6:1)
  "#4f46e5", // indigo-600 — 6.3:1
]

/** True when key looks system-generated (not a human slug). */
export function isAutoFieldKey(key: string): boolean {
  const k = String(key || "")
  return (
    /^field_\d+/i.test(k) ||
    /^new_information(_\d+)?$/i.test(k) ||
    // full_name_1783913944508 / address_1783913944508 (ms timestamps)
    /_\d{10,}$/.test(k) ||
    // field_1783965850537_2
    /^field_\d+_\d+$/i.test(k)
  )
}

/**
 * Build a stable machine key from a display label: "Digital Number" → "digital_number".
 * Keeps keys unique against `existingKeys` (excluding the field being renamed).
 */
export function slugifyFieldKey(
  label: string,
  existingKeys: string[] = [],
  opts?: { excludeKey?: string },
): string {
  const base =
    String(label || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_")
      .slice(0, 48) || "field"

  const reserved = new Set(
    existingKeys.filter((key) => key && key !== opts?.excludeKey).map((key) => key.toLowerCase()),
  )
  if (!reserved.has(base)) return base
  for (let n = 2; n < 200; n += 1) {
    const candidate = `${base}_${n}`
    if (!reserved.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

export function createField(
  order: number,
  side: "front" | "back" | "single" = "front",
  existingKeys: string[] = [],
  label = "New information",
): OcrFieldDefinition {
  const canvasSide = side === "single" ? "front" : side
  const key = slugifyFieldKey(label, existingKeys)
  return {
    key,
    label,
    data_type: "text",
    enabled: true,
    required: true,
    aliases: [],
    sides: [canvasSide],
    order,
    normalization: "none",
    extraction_hints: {
      multi_line: false,
      auto_correct: true,
      remove_special_chars: false,
      case_normalization: "none",
      expected_keywords: [],
      labels: [],
      regex_pattern: "",
      region: null,
      side: canvasSide,
    },
  }
}

/** Side this field is marked on (defaults to front for older templates). */
export function fieldCanvasSide(
  field: OcrFieldDefinition,
): "front" | "back" {
  return resolveFieldSide(field)
}

/**
 * Stable display order: Front fields first (by order), then Back fields.
 * Numbers and colors stay consistent across Mark areas, canvas, Rules, and Try sample.
 */
export function sortedFieldsForDisplay(fields: OcrFieldDefinition[]): OcrFieldDefinition[] {
  return [...fields].sort((a, b) => {
    const sideA = fieldCanvasSide(a) === "back" ? 1 : 0
    const sideB = fieldCanvasSide(b) === "back" ? 1 : 0
    if (sideA !== sideB) return sideA - sideB
    return (a.order ?? 0) - (b.order ?? 0)
  })
}

/** 1-based display number for a field (same everywhere in the builder). */
export function fieldDisplayNumber(
  field: OcrFieldDefinition,
  allFields: OcrFieldDefinition[],
): number {
  const sorted = sortedFieldsForDisplay(allFields)
  const index = sorted.findIndex((item) => item.key === field.key)
  return index >= 0 ? index + 1 : 0
}

/** Color for a field based on its stable display number. */
export function fieldDisplayColor(
  field: OcrFieldDefinition,
  allFields: OcrFieldDefinition[],
): string {
  const n = fieldDisplayNumber(field, allFields)
  return FIELD_COLORS[Math.max(0, n - 1) % FIELD_COLORS.length]
}

/** Assign a field to front or back and keep model.sides in sync. */
export function withFieldSide(
  field: OcrFieldDefinition,
  side: "front" | "back",
): OcrFieldDefinition {
  return {
    ...field,
    sides: [side],
    extraction_hints: {
      ...hintsOf(field),
      side,
    },
  }
}

export function createDocumentType(order: number, existingKeys: string[] = []): OcrDocumentType {
  let key = `custom_document_${Date.now()}`
  while (existingKeys.includes(key)) {
    key = `custom_document_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  }
  const name = "New proof type"
  const fullName = createField(0, "front", [], "Full name")
  const address = createField(1, "front", [fullName.key], "Address")
  const fields = [fullName, address]
  fields.forEach((field, index) => {
    field.sides = ["front"]
    field.extraction_hints = {
      ...hintsOf(field),
      region: defaultRegionForIndex(index, fields.length),
      side: "front",
    }
    field.order = index
  })
  return {
    key,
    name,
    description: "",
    enabled: false,
    order,
    required_sides: ["single"],
    min_files: 1,
    max_files: 1,
    max_file_size_bytes: 10 * 1024 * 1024,
    accepted_mime_types: ["image/jpeg", "image/png", "image/webp"],
    accepted_extensions: ["jpg", "jpeg", "png", "webp"],
    keywords: [],
    provider_keywords: [],
    fields,
    rules: [],
    template_name: name,
    template_version: "v1.0",
    expected_title: "",
    accept_rotated: true,
    sample_url: null,
    sample_original_filename: "",
    samples: [],
    template_settings: {},
  }
}

export function hintsOf(field: OcrFieldDefinition): OcrFieldHints {
  return field.extraction_hints ?? {}
}

export function defaultRegionForIndex(index: number, total: number): FieldRegion {
  // Stack fields vertically on the left content area — no overlap between boxes.
  const n = Math.max(1, total)
  const h = Math.min(0.09, 0.55 / n)
  const gap = 0.018
  const y = Math.min(0.88 - h, 0.12 + index * (h + gap))
  return {
    x: 0.06,
    y,
    w: 0.48,
    h,
  }
}

export function clampRegion(region: FieldRegion): FieldRegion {
  const w = Math.min(0.95, Math.max(0.04, region.w))
  const h = Math.min(0.95, Math.max(0.03, region.h))
  const x = Math.min(1 - w, Math.max(0, region.x))
  const y = Math.min(1 - h, Math.max(0, region.y))
  return { x, y, w, h }
}

export function isValidRegion(region: unknown): region is FieldRegion {
  if (!region || typeof region !== "object") return false
  const value = region as Record<string, unknown>
  return (
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.w === "number" &&
    typeof value.h === "number" &&
    value.w > 0 &&
    value.h > 0
  )
}

/**
 * Rewrite ugly auto keys (field_178… / full_name_178…) to clean slugs from labels.
 * Keeps rules linked via key map. Safe to run on every draft load.
 */
export function ensureReadableFieldKeys(doc: OcrDocumentType): OcrDocumentType {
  const used: string[] = []
  const keyMap = new Map<string, string>()
  let changed = false

  const fields = doc.fields.map((field) => {
    if (!isAutoFieldKey(field.key)) {
      used.push(field.key)
      return field
    }
    const nextKey = slugifyFieldKey(field.label || field.key, used, {
      excludeKey: field.key,
    })
    used.push(nextKey)
    if (nextKey !== field.key) {
      changed = true
      keyMap.set(field.key, nextKey)
      return { ...field, key: nextKey }
    }
    return field
  })

  if (!changed) return doc

  const rules = (doc.rules ?? []).map((rule) => {
    const mapped = keyMap.get(rule.field_key)
    return mapped ? { ...rule, field_key: mapped } : rule
  })

  return { ...doc, fields, rules }
}

export function ensureDocumentFieldRegions(doc: OcrDocumentType): OcrDocumentType {
  // Clean machine keys first so renames stick for the rest of the session / save.
  const withKeys = ensureReadableFieldKeys(doc)
  const sorted = [...withKeys.fields].sort((a, b) => a.order - b.order)
  let changed = withKeys !== doc
  const sideCounts: Record<"front" | "back", number> = { front: 0, back: 0 }
  const withRegions = sorted.map((field) => {
    const hints = hintsOf(field)
    const side = fieldCanvasSide(field)
    const sideIndex = sideCounts[side]
    sideCounts[side] += 1
    let next = field
    // Normalize side onto both extraction_hints and sides[] so reloads stay correct.
    if (hints.side !== side || !(field.sides ?? []).includes(side)) {
      changed = true
      next = withFieldSide(next, side)
    }
    const region = hintsOf(next).region
    if (isValidRegion(region)) {
      return next
    }
    changed = true
    // Count how many will exist on this side for spacing
    const sideTotal = sorted.filter((f) => fieldCanvasSide(f) === side).length
    return {
      ...withFieldSide(next, side),
      extraction_hints: {
        ...hintsOf(next),
        side,
        region: defaultRegionForIndex(sideIndex, sideTotal),
      },
    }
  })
  if (!changed) return withKeys
  return {
    ...withKeys,
    fields: withKeys.fields.map(
      (field) => withRegions.find((item) => item.key === field.key) ?? field,
    ),
  }
}
