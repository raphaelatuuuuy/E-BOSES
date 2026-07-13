import type {
  OcrDocumentType,
  OcrFieldDefinition,
  OcrFieldHints,
  OcrFieldRegion,
} from "@/features/ocr/api"

export type FieldRegion = OcrFieldRegion

export const FIELD_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
]

export function createField(order: number): OcrFieldDefinition {
  return {
    key: `field_${Date.now()}_${order}`,
    label: "New information",
    data_type: "text",
    enabled: true,
    required: true,
    aliases: [],
    order,
    min_confidence: 0.9,
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
    },
  }
}

export function createDocumentType(order: number, existingKeys: string[] = []): OcrDocumentType {
  let key = `custom_document_${Date.now()}`
  while (existingKeys.includes(key)) {
    key = `custom_document_${Date.now()}_${Math.floor(Math.random() * 1000)}`
  }
  const name = "New proof type"
  const fields = [
    createField(0),
    { ...createField(1), key: `address_${Date.now()}`, label: "Address" },
  ]
  fields[0] = { ...fields[0], label: "Full name", key: `full_name_${Date.now()}` }
  fields.forEach((field, index) => {
    field.extraction_hints = {
      ...hintsOf(field),
      region: defaultRegionForIndex(index, fields.length),
    }
    field.order = index
  })
  return {
    key,
    name,
    description: "Short note shown under the name on resident sign-up.",
    enabled: false,
    order,
    required_sides: ["single"],
    min_files: 1,
    max_files: 1,
    max_file_size_bytes: 10 * 1024 * 1024,
    accepted_mime_types: ["image/jpeg", "image/png"],
    accepted_extensions: ["jpg", "jpeg", "png"],
    keywords: [],
    provider_keywords: [],
    fields,
    rules: [],
    template_name: name,
    template_version: "v1.0",
    expected_title: "",
    min_ocr_confidence: 0.9,
    accept_rotated: true,
    accept_scanned_pdf: true,
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
  // Stack fields on the left content area of a typical barangay ID (photo on right).
  const col = index % 2
  const row = Math.floor(index / 2)
  const rows = Math.max(1, Math.ceil(total / 2))
  const h = Math.min(0.1, 0.72 / rows)
  return {
    x: col === 0 ? 0.04 : 0.38,
    y: 0.18 + row * (h + 0.02),
    w: 0.32,
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

export function ensureDocumentFieldRegions(doc: OcrDocumentType): OcrDocumentType {
  const sorted = [...doc.fields].sort((a, b) => a.order - b.order)
  let changed = false
  const withRegions = sorted.map((field, index) => {
    const region = hintsOf(field).region
    if (isValidRegion(region)) {
      return field
    }
    changed = true
    return {
      ...field,
      extraction_hints: {
        ...hintsOf(field),
        region: defaultRegionForIndex(index, sorted.length),
      },
    }
  })
  if (!changed) return doc
  return {
    ...doc,
    fields: doc.fields.map((field) => withRegions.find((item) => item.key === field.key) ?? field),
  }
}
