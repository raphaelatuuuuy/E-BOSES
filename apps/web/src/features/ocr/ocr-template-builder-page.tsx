import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import {
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  FileCheck2,
  FileText,
  GripVertical,
  IdCard,
  ImageIcon,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Play,
  XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import { Topbar } from "@/features/dashboard/components/topbar"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  deleteTemplateSample,
  fetchTemplateSampleBlob,
  getOcrDraft,
  listOcrTests,
  listResidenceProofOptions,
  normalizeExtractedFields,
  publishOcrDraft,
  runOcrTest,
  saveOcrDraft,
  uploadTemplateSample,
  type OcrConfiguration,
  type OcrDocumentType,
  type OcrFieldDefinition,
  type OcrFieldHints,
  type OcrRuleDefinition,
  type OcrTestField,
  type OcrTestResult,
  type ProofSide,
} from "@/features/ocr/api"
import { ProofTypeList } from "@/features/ocr/components/proof-type-list"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

/** System design tokens — aligned with Concern Classification / Admin. */
const T = {
  bg: "bg-[#f7f8fc]",
  card: "rounded-2xl border border-[#dfe7f5] bg-white shadow-sm",
  title: "text-[#07145f]",
  body: "text-[#43507f]",
  muted: "text-[#68739c]",
  primary: "#145be7",
  primaryBg: "bg-[#145be7] hover:bg-[#104bc0]",
  soft: "bg-[#f2f6ff]",
  border: "border-[#dfe7f5]",
} as const

function Panel({
  title,
  step,
  description,
  action,
  children,
  className,
}: {
  title: string
  step?: number
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(T.card, "flex flex-col", className)}>
      <div className={cn("flex items-start justify-between gap-3 border-b px-4 py-3.5 md:px-5", T.border)}>
        <div className="min-w-0">
          <h2 className={cn("flex items-center gap-2 text-base font-black", T.title)}>
            {step != null ? (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ backgroundColor: T.primary }}
              >
                {step}
              </span>
            ) : null}
            {title}
          </h2>
          {description ? (
            <p className={cn("mt-1 text-xs font-semibold leading-5", T.body)}>{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">{children}</div>
    </section>
  )
}

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block">
      <span className={cn("block text-xs font-black", T.title)}>{children}</span>
      {hint ? <span className={cn("mt-0.5 block text-[11px] font-semibold leading-4", T.muted)}>{hint}</span> : null}
    </span>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition hover:bg-[#f8fafc]",
        T.border,
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-xs font-black", T.title)}>{label}</span>
        {hint ? <span className={cn("mt-0.5 block text-[11px] font-semibold leading-4", T.muted)}>{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Document"
}

type ProfileMatchKey =
  | "first_name"
  | "middle_name"
  | "last_name"
  | "gender"
  | "date_of_birth"
  | "address"

const FIELD_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#ea580c",
  "#4f46e5",
]

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

function selectClass() {
  return "h-10 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#145be7] focus-visible:ring-[3px] focus-visible:ring-[#145be7]/20"
}

function createField(order: number): OcrFieldDefinition {
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

function createDocumentType(order: number, existingKeys: string[] = []): OcrDocumentType {
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

function hintsOf(field: OcrFieldDefinition): OcrFieldHints {
  return field.extraction_hints ?? {}
}

type FieldRegion = { x: number; y: number; w: number; h: number }

type RegionDragState =
  | {
      mode: "move" | "resize"
      fieldKey: string
      startX: number
      startY: number
      origin: FieldRegion
    }
  | null

function defaultRegionForIndex(index: number, total: number): FieldRegion {
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

function defaultRegions(count: number): FieldRegion[] {
  return Array.from({ length: count }, (_, index) => defaultRegionForIndex(index, count))
}

function clampRegion(region: FieldRegion): FieldRegion {
  const w = Math.min(0.95, Math.max(0.04, region.w))
  const h = Math.min(0.95, Math.max(0.03, region.h))
  const x = Math.min(1 - w, Math.max(0, region.x))
  const y = Math.min(1 - h, Math.max(0, region.y))
  return { x, y, w, h }
}

function isValidRegion(region: unknown): region is FieldRegion {
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

function ensureDocumentFieldRegions(doc: OcrDocumentType): OcrDocumentType {
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

export default function OcrTemplateBuilderPage() {
  usePageTitle("ID & Proof Templates")
  const [view, setView] = useState<"list" | "wizard">("list")
  const [configuration, setConfiguration] = useState<OcrConfiguration | null>(null)
  const [selectedDocKey, setSelectedDocKey] = useState("")
  const [selectedFieldKey, setSelectedFieldKey] = useState("")
  const [fieldSearch, setFieldSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [zoom, setZoom] = useState(1)
  const [samplePreviewUrl, setSamplePreviewUrl] = useState<string | null>(null)
  const [samplePreviewSide, setSamplePreviewSide] = useState<ProofSide>("single")
  const [samplePreviewBySide, setSamplePreviewBySide] = useState<Partial<Record<ProofSide, string>>>({})
  const [testFile, setTestFile] = useState<File | null>(null)
  const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<OcrTestResult | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [regionDrag, setRegionDrag] = useState<RegionDragState>(null)
  const sampleInputRef = useRef<HTMLInputElement>(null)
  const sampleUploadSideRef = useRef<ProofSide>("single")
  const testInputRef = useRef<HTMLInputElement>(null)
  const canvasFrameRef = useRef<HTMLDivElement>(null)

  const selectedDocument = useMemo(
    () => configuration?.document_types.find((doc) => doc.key === selectedDocKey) ?? configuration?.document_types[0],
    [configuration, selectedDocKey],
  )

  const fields = useMemo(() => {
    const list = [...(selectedDocument?.fields ?? [])].sort((a, b) => a.order - b.order)
    if (!fieldSearch.trim()) return list
    const q = fieldSearch.toLowerCase()
    return list.filter((field) => field.label.toLowerCase().includes(q) || field.key.toLowerCase().includes(q))
  }, [fieldSearch, selectedDocument?.fields])

  const selectedField =
    fields.find((field) => field.key === selectedFieldKey) ?? fields[0] ?? null

  const extractedList: OcrTestField[] = useMemo(() => {
    const list = normalizeExtractedFields(testResult?.extracted_fields)
    // Keep table order aligned with Fields Manager order.
    if (!selectedDocument?.fields?.length) return list
    const order = new Map(selectedDocument.fields.map((field, index) => [field.key, index]))
    return [...list].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [selectedDocument?.fields, testResult?.extracted_fields])

  const extractedByKey = useMemo(() => {
    const map = new Map<string, OcrTestField>()
    for (const item of extractedList) map.set(item.key, item)
    return map
  }, [extractedList])

  function regionsOverlapOrClose(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
    pad = 0.02,
  ) {
    const a2 = { x1: a.x - pad, y1: a.y - pad, x2: a.x + a.w + pad, y2: a.y + a.h + pad }
    const b2 = { x1: b.x - pad, y1: b.y - pad, x2: b.x + b.w + pad, y2: b.y + b.h + pad }
    return !(a2.x2 < b2.x1 || b2.x2 < a2.x1 || a2.y2 < b2.y1 || b2.y2 < a2.y1)
  }

  const load = useCallback(async () => {
    const draft = await getOcrDraft()
    const withRegions: OcrConfiguration = {
      ...draft,
      document_types: draft.document_types.map(ensureDocumentFieldRegions),
    }
    setConfiguration(withRegions)
    const first = withRegions.document_types[0]?.key ?? ""
    setSelectedDocKey((current) => current || first)
    setSelectedFieldKey((current) => {
      const doc =
        withRegions.document_types.find((item) => item.key === (current ? selectedDocKey : first)) ??
        withRegions.document_types[0]
      return doc?.fields[0]?.key ?? ""
    })
  }, [selectedDocKey])

  useEffect(() => {
    let active = true
    load()
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load proof templates.")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const canvasSides = useMemo((): ProofSide[] => {
    if (!selectedDocument) return ["single"]
    const sides = selectedDocument.required_sides?.length
      ? selectedDocument.required_sides
      : ["single"]
    if (sides.includes("front") && sides.includes("back")) return ["front", "back"]
    if (sides.includes("front")) return ["front"]
    if (sides.includes("back")) return ["back"]
    return ["single"]
  }, [selectedDocument?.required_sides, selectedDocument?.key])

  useEffect(() => {
    setSamplePreviewSide((current) =>
      canvasSides.includes(current) ? current : canvasSides[0] ?? "single",
    )
  }, [canvasSides])

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    async function loadSamples() {
      if (!selectedDocument) {
        setSamplePreviewBySide({})
        setSamplePreviewUrl(null)
        return
      }
      const sampleList =
        selectedDocument.samples?.filter((s) => s.url)?.length
          ? selectedDocument.samples.filter((s) => s.url)
          : selectedDocument.sample_url
            ? [
                {
                  side: (canvasSides[0] ?? "single") as ProofSide,
                  url: selectedDocument.sample_url,
                  filename: selectedDocument.sample_original_filename || "",
                },
              ]
            : []

      const next: Partial<Record<ProofSide, string>> = {}
      for (const sample of sampleList) {
        try {
          const blob = await fetchTemplateSampleBlob(sample.url)
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          created.push(url)
          next[sample.side as ProofSide] = url
        } catch {
          // side missing
        }
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      // Alias single ↔ front so swapping photo requirement keeps the sample visible.
      if (!next.front && next.single && canvasSides.includes("front")) {
        next.front = next.single
      }
      if (!next.single && next.front && canvasSides.includes("single")) {
        next.single = next.front
      }
      if (!next.single && next.back && canvasSides.includes("single") && !next.front) {
        next.single = next.back
      }
      setSamplePreviewBySide((prev) => {
        Object.values(prev).forEach((u) => {
          if (u) URL.revokeObjectURL(u)
        })
        return next
      })
    }

    void loadSamples()
    return () => {
      cancelled = true
    }
  }, [
    selectedDocument?.key,
    selectedDocument?.sample_url,
    JSON.stringify(selectedDocument?.samples ?? []),
    canvasSides.join("|"),
  ])

  useEffect(() => {
    setSamplePreviewUrl(
      samplePreviewBySide[samplePreviewSide] ??
        samplePreviewBySide[canvasSides[0] ?? "single"] ??
        null,
    )
  }, [samplePreviewSide, samplePreviewBySide, canvasSides])

  useEffect(() => {
    return () => {
      if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl)
    }
  }, [testPreviewUrl])

  // Whenever the selected document changes, guarantee every field has a canvas region.
  useEffect(() => {
    if (!selectedDocument) return
    const ensured = ensureDocumentFieldRegions(selectedDocument)
    if (ensured === selectedDocument) return
    setConfiguration((current) => {
      if (!current) return current
      return {
        ...current,
        document_types: current.document_types.map((doc) =>
          doc.key === selectedDocument.key ? ensured : doc,
        ),
      }
    })
  }, [selectedDocument?.key, selectedDocument?.fields.length])

  function updateConfiguration(updater: (current: OcrConfiguration) => OcrConfiguration) {
    setConfiguration((current) => (current ? updater(current) : current))
  }

  function updateSelectedDocument(updater: (doc: OcrDocumentType) => OcrDocumentType) {
    if (!selectedDocument) return
    updateConfiguration((current) => ({
      ...current,
      document_types: current.document_types.map((doc) =>
        doc.key === selectedDocument.key ? updater(doc) : doc,
      ),
    }))
  }

  /** How many distinct sample photos are on this proof (preview or saved). */
  function countSamplePhotos(doc: OcrDocumentType) {
    const previewUrls = new Set(
      (Object.values(samplePreviewBySide) as Array<string | undefined>).filter(Boolean) as string[],
    )
    if (previewUrls.size > 0) return previewUrls.size
    const listedUrls = new Set(
      (doc.samples ?? [])
        .map((sample) => sample.url)
        .filter((url): url is string => Boolean(url)),
    )
    if (listedUrls.size > 0) return listedUrls.size
    return doc.sample_url ? 1 : 0
  }

  /**
   * Switch between Front only and Front+back.
   * Allowed when 0–1 sample photos exist (existing photo is kept).
   * Blocked when both front and back samples are already uploaded.
   * Applies to sign-up immediately (save + publish).
   */
  function changeCaptureMode(mode: "one" | "both") {
    if (!selectedDocument || !configuration) return
    const current = selectedDocument.required_sides ?? ["single"]
    const currentlyBoth = current.includes("front") && current.includes("back")
    const wantBoth = mode === "both"
    if (currentlyBoth === wantBoth) return

    const sampleCount = countSamplePhotos(selectedDocument)
    if (sampleCount >= 2) {
      toast.error("Cannot change photo requirement", {
        description:
          "This proof already has two sample photos (front and back). Remove one sample first, then switch.",
      })
      return
    }

    const updateDoc = (doc: OcrDocumentType): OcrDocumentType => {
      if (wantBoth) {
        return {
          ...doc,
          required_sides: ["front", "back"],
          min_files: 2,
          max_files: 2,
          samples: (doc.samples ?? []).map((sample) =>
            sample.side === "single" ? { ...sample, side: "front" as ProofSide, label: "Front" } : sample,
          ),
        }
      }
      const listed = (doc.samples ?? []).filter((sample) => Boolean(sample.url))
      const primary =
        listed.find((sample) => sample.side === "front") ??
        listed.find((sample) => sample.side === "single") ??
        listed.find((sample) => sample.side === "back") ??
        null
      return {
        ...doc,
        required_sides: ["single"],
        min_files: 1,
        max_files: 1,
        samples: primary ? [{ ...primary, side: "single" as ProofSide, label: "Front" }] : [],
        sample_url: primary?.url ?? doc.sample_url ?? null,
        sample_original_filename: primary?.filename ?? doc.sample_original_filename ?? "",
      }
    }

    const next: OcrConfiguration = {
      ...configuration,
      document_types: configuration.document_types.map((doc) =>
        doc.key === selectedDocument.key ? updateDoc(doc) : doc,
      ),
    }
    setConfiguration(next)

    if (wantBoth) {
      setSamplePreviewBySide((prev) => {
        if (prev.single && !prev.front) {
          const { single: _single, ...rest } = prev
          return { ...rest, front: prev.single }
        }
        return prev
      })
      setSamplePreviewSide((prev) => (prev === "single" || prev === "back" ? "front" : prev))
    } else {
      setSamplePreviewBySide((prev) => {
        const url = prev.front ?? prev.single ?? prev.back
        if (!url) return {}
        Object.values(prev).forEach((existing) => {
          if (existing && existing !== url) URL.revokeObjectURL(existing)
        })
        return { single: url }
      })
      setSamplePreviewSide("single")
    }

    void saveAndPublish(next, {
      title: wantBoth ? "Now requires front and back" : "Now front only",
      description: wantBoth
        ? sampleCount === 1
          ? "Your existing sample is kept as the front. Upload a back sample when ready."
          : "Residents will take two photos for this ID."
        : sampleCount === 1
          ? "Your sample photo is kept. Residents will only need one photo."
          : "Residents will only need one photo of this proof.",
    })
  }

  function updateField(fieldKey: string, updater: (field: OcrFieldDefinition) => OcrFieldDefinition) {
    updateSelectedDocument((doc) => ({
      ...doc,
      fields: doc.fields.map((field) => (field.key === fieldKey ? updater(field) : field)),
    }))
  }

  function updateFieldHints(fieldKey: string, patch: Partial<OcrFieldHints>) {
    updateField(fieldKey, (field) => ({
      ...field,
      extraction_hints: { ...hintsOf(field), ...patch },
    }))
  }

  function rulesForField(fieldKey: string): OcrRuleDefinition[] {
    return (selectedDocument?.rules ?? []).filter((rule) => rule.field_key === fieldKey)
  }

  function fieldMatchProfiles(fieldKey: string): ProfileMatchKey[] {
    const keys: ProfileMatchKey[] = []
    for (const rule of rulesForField(fieldKey)) {
      if (rule.rule_type !== "profile_match" && rule.operator !== "matches_profile") continue
      const value = rule.value
      let profile = ""
      if (value && typeof value === "object" && !Array.isArray(value)) {
        profile = String((value as Record<string, unknown>).profile ?? "")
      }
      // Full-name ("name") matching removed — first/middle/last only
      if (
        profile === "first_name" ||
        profile === "middle_name" ||
        profile === "last_name" ||
        profile === "gender" ||
        profile === "date_of_birth" ||
        profile === "address"
      ) {
        keys.push(profile)
      }
    }
    return keys
  }

  function fieldHasNotExpired(fieldKey: string) {
    return rulesForField(fieldKey).some(
      (rule) => rule.rule_type === "not_expired" || rule.operator === "not_expired",
    )
  }

  function setFieldValidationRules(
    fieldKey: string,
    next: { required: boolean; matchProfiles: ProfileMatchKey[]; notExpired: boolean },
  ) {
    if (!selectedDocument) return
    const otherRules = (selectedDocument.rules ?? []).filter((rule) => rule.field_key !== fieldKey)
    const built: OcrRuleDefinition[] = []
    let order = 0
    if (next.required) {
      built.push({
        key: `${fieldKey}_required`,
        name: "Required field",
        field_key: fieldKey,
        rule_type: "required",
        operator: "exists",
        value: { field: fieldKey, fields: [fieldKey] },
        threshold: null,
        enabled: true,
        on_failure: "manual_review",
        order: order++,
      })
    }
    for (const profile of next.matchProfiles) {
      built.push({
        key: `${fieldKey}_match_${profile}`,
        name: `Match ${profile.replaceAll("_", " ")}`,
        field_key: fieldKey,
        rule_type: "profile_match",
        operator: "matches_profile",
        value: { field: fieldKey, profile },
        threshold: profile === "address" ? 0.8 : 0.85,
        enabled: true,
        on_failure: "manual_review",
        order: order++,
      })
    }
    if (next.notExpired) {
      built.push({
        key: `${fieldKey}_not_expired`,
        name: "Not expired",
        field_key: fieldKey,
        rule_type: "not_expired",
        operator: "not_expired",
        value: { field: fieldKey },
        threshold: null,
        enabled: true,
        on_failure: "manual_review",
        order: order++,
      })
    }
    updateSelectedDocument((doc) => ({
      ...doc,
      rules: [...otherRules, ...built],
    }))
  }

  function setFieldRegion(fieldKey: string, region: FieldRegion) {
    updateFieldHints(fieldKey, { region: clampRegion(region) })
  }

  function selectField(fieldKey: string) {
    setSelectedFieldKey(fieldKey)
    // Ensure the field has a region so it appears on the canvas immediately.
    if (!selectedDocument) return
    const field = selectedDocument.fields.find((item) => item.key === fieldKey)
    if (!field) return
    if (!hintsOf(field).region) {
      const sorted = [...selectedDocument.fields].sort((a, b) => a.order - b.order)
      const index = Math.max(0, sorted.findIndex((item) => item.key === fieldKey))
      setFieldRegion(fieldKey, defaultRegionForIndex(index, sorted.length))
    }
  }

  function pointerToRelative(clientX: number, clientY: number) {
    const frame = canvasFrameRef.current
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    }
  }

  function beginRegionDrag(
    event: ReactPointerEvent<HTMLElement>,
    fieldKey: string,
    mode: "move" | "resize",
    origin: FieldRegion,
  ) {
    event.preventDefault()
    event.stopPropagation()
    selectField(fieldKey)
    const point = pointerToRelative(event.clientX, event.clientY)
    if (!point) return

    const drag: NonNullable<RegionDragState> = {
      mode,
      fieldKey,
      startX: point.x,
      startY: point.y,
      origin: { ...origin },
    }
    setRegionDrag(drag)

    const onMove = (moveEvent: PointerEvent) => {
      const next = pointerToRelative(moveEvent.clientX, moveEvent.clientY)
      if (!next) return
      const dx = next.x - drag.startX
      const dy = next.y - drag.startY
      if (drag.mode === "move") {
        setFieldRegion(drag.fieldKey, {
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        })
        return
      }
      setFieldRegion(drag.fieldKey, {
        ...drag.origin,
        w: drag.origin.w + dx,
        h: drag.origin.h + dy,
      })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setRegionDrag(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  const sortedCanvasFields = useMemo(() => {
    return [...(selectedDocument?.fields ?? [])].sort((a, b) => a.order - b.order)
  }, [selectedDocument?.fields])

  const selectedFieldIndex = Math.max(
    0,
    sortedCanvasFields.findIndex((field) => field.key === selectedField?.key),
  )

  /**
   * Save the draft and push it live for sign-up.
   * Used instead of a separate “Publish” button — the Available switch and
   * other sign-up settings apply themselves when changed.
   */
  async function saveAndPublish(
    nextConfig?: OcrConfiguration | null,
    success?: { title: string; description?: string },
    options?: { verifyKey?: string; expectVisible?: boolean },
  ) {
    let config = nextConfig ?? configuration
    if (!config) return null
    setSaving(true)
    try {
      // Retry once if another save bumped the revision.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const saved = await saveOcrDraft(config)
          const result = await publishOcrDraft(saved.revision)
          setConfiguration(result.draft)

          // Confirm what sign-up actually receives (published catalog).
          let liveCount = 0
          let verifiedVisible: boolean | null = null
          try {
            const live = await listResidenceProofOptions()
            liveCount = live.length
            if (options?.verifyKey) {
              verifiedVisible = live.some((item) => item.key === options.verifyKey)
            }
          } catch {
            /* non-fatal — publish already succeeded */
          }

          if (options?.verifyKey && options.expectVisible === true && verifiedVisible === false) {
            toast.error("Saved, but not showing on sign-up yet", {
              description:
                "The proof was published as hidden or could not be found. Turn Available on, then try again.",
            })
            return result
          }

          if (success) {
            const liveNote =
              liveCount === 0
                ? "No proof types are currently visible on sign-up."
                : `${liveCount} proof type${liveCount === 1 ? "" : "s"} visible on sign-up.`
            toast.success(success.title, {
              description: [success.description, liveNote].filter(Boolean).join(" "),
            })
          }
          return result
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          if (attempt === 0 && /revision|changed since/i.test(message)) {
            const latest = await getOcrDraft()
            // Re-apply the intended document list onto the fresh draft.
            // Important: honor removals — only keep types still present in nextConfig.
            if (nextConfig) {
              const pendingKeys = new Set(nextConfig.document_types.map((doc) => doc.key))
              const latestByKey = new Map(latest.document_types.map((doc) => [doc.key, doc]))
              config = {
                ...latest,
                document_types: nextConfig.document_types.map((pending) => {
                  const base = latestByKey.get(pending.key)
                  if (!base) return pending
                  return {
                    ...base,
                    ...pending,
                    // Prefer server ids from the fresh draft when the type still exists.
                    id: base.id ?? pending.id,
                    fields: pending.fields?.length ? pending.fields : base.fields,
                    rules: pending.rules?.length ? pending.rules : base.rules,
                  }
                }).filter((doc) => pendingKeys.has(doc.key)),
              }
              continue
            }
            config = latest
            continue
          }
          throw reason
        }
      }
      return null
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update sign-up settings.")
      return null
    } finally {
      setSaving(false)
    }
  }

  async function setProofAvailableOnSignup(docKey: string, enabled: boolean) {
    try {
      // Always start from the latest draft so revision conflicts don't drop the toggle.
      const latest = await getOcrDraft()
      const next: OcrConfiguration = {
        ...latest,
        document_types: latest.document_types.map((doc) =>
          doc.key === docKey ? { ...doc, enabled } : doc,
        ),
      }
      // Keep local field regions / unsaved edits when possible.
      if (configuration) {
        const localByKey = new Map(configuration.document_types.map((doc) => [doc.key, doc]))
        next.document_types = next.document_types.map((doc) => {
          const local = localByKey.get(doc.key)
          if (!local) return doc
          return {
            ...local,
            id: doc.id,
            // Server ids + intended availability; keep local wording/fields.
            enabled: doc.key === docKey ? enabled : doc.enabled,
            name: local.name || doc.name,
            template_name: local.template_name || doc.template_name,
            description: local.description ?? doc.description,
            required_sides: local.required_sides?.length ? local.required_sides : doc.required_sides,
            min_files: local.min_files ?? doc.min_files,
            max_files: local.max_files ?? doc.max_files,
            fields: local.fields?.length ? local.fields : doc.fields,
            rules: local.rules?.length ? local.rules : doc.rules,
          }
        })
      }
      setConfiguration(next)
      setSelectedDocKey(docKey)
      await saveAndPublish(
        next,
        {
          title: enabled ? "Available on sign-up" : "Hidden from sign-up",
          description: enabled
            ? "Residents can choose this proof when registering."
            : "Residents will no longer see this proof on sign-up.",
        },
        { verifyKey: docKey, expectVisible: enabled },
      )
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update availability.")
    }
  }

  async function saveProofNameAndDescription() {
    if (!selectedDocument || !configuration) return
    const targetKey = selectedDocument.key
    const next: OcrConfiguration = {
      ...configuration,
      document_types: configuration.document_types.map((doc) => {
        if (doc.key !== targetKey) return doc
        // Prefer the typed template_name (may be empty while editing); only fall back if both blank.
        const typed = (doc.template_name ?? doc.name ?? "").trim()
        const label = typed || "Untitled proof"
        return {
          ...doc,
          name: label,
          template_name: label,
          description: (doc.description || "").trim().slice(0, 255),
        }
      }),
    }
    setConfiguration(next)
    await saveAndPublish(next, {
      title: "Proof details updated",
      description: "Name and description now show on resident sign-up.",
    })
  }

  async function handleSampleUpload(file: File | null | undefined, side?: ProofSide) {
    if (!file || !selectedDocument || !configuration) return
    const docKey = selectedDocument.key
    const uploadSide = side ?? sampleUploadSideRef.current ?? samplePreviewSide ?? "single"
    setSaving(true)
    try {
      // New document types exist only in React state until saved. Persist draft
      // first so the sample upload API can find the document type code.
      const saved = await saveOcrDraft(configuration)
      const savedDoc = saved.document_types.find((doc) => doc.key === docKey)
      if (!savedDoc) {
        setConfiguration(saved)
        toast.error("Proof type was not saved. Try uploading the sample again.")
        return
      }
      setSelectedDocKey(savedDoc.key)

      const uploaded = await uploadTemplateSample(savedDoc.key, file, uploadSide)
      const withSample: OcrConfiguration = {
        ...saved,
        document_types: saved.document_types.map((doc) =>
          doc.key === savedDoc.key
            ? {
                ...doc,
                sample_url: uploaded.sample_url,
                sample_original_filename: uploaded.sample_original_filename,
                samples: uploaded.samples ?? doc.samples,
              }
            : doc,
        ),
      }
      // Push live so sign-up and verification use the updated proof type.
      try {
        const published = await publishOcrDraft(withSample.revision)
        setConfiguration(published.draft)
      } catch {
        setConfiguration(withSample)
      }
      const localUrl = URL.createObjectURL(file)
      setSamplePreviewBySide((prev) => {
        const old = prev[uploadSide]
        if (old) URL.revokeObjectURL(old)
        return { ...prev, [uploadSide]: localUrl }
      })
      setSamplePreviewSide(uploadSide)
      setSamplePreviewUrl(localUrl)
      toast.success(`${sideLabel(uploadSide)} sample uploaded`, {
        description: "Other sides are kept. Settings are up to date for sign-up.",
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Sample upload failed."
      toast.error(
        /unknown document type/i.test(message)
          ? "Proof type is not saved yet. Try uploading the sample again."
          : message,
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSampleRemove(side: ProofSide) {
    if (!selectedDocument || !configuration) return
    setSaving(true)
    try {
      const saved = await saveOcrDraft(configuration)
      const savedDoc = saved.document_types.find((doc) => doc.key === selectedDocument.key)
      if (!savedDoc) {
        setConfiguration(saved)
        return
      }
      const updated = await deleteTemplateSample(savedDoc.key, side)
      const withSample: OcrConfiguration = {
        ...saved,
        document_types: saved.document_types.map((doc) =>
          doc.key === savedDoc.key
            ? {
                ...doc,
                sample_url: updated.sample_url,
                sample_original_filename: updated.sample_original_filename,
                samples: updated.samples ?? [],
              }
            : doc,
        ),
      }
      try {
        const published = await publishOcrDraft(withSample.revision)
        setConfiguration(published.draft)
      } catch {
        setConfiguration(withSample)
      }
      setSamplePreviewBySide((prev) => {
        const next = { ...prev }
        if (next[side]) URL.revokeObjectURL(next[side]!)
        delete next[side]
        return next
      })
      toast.success(`${sideLabel(side)} sample removed`)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not remove sample.")
    } finally {
      setSaving(false)
    }
  }

  async function runTest(file?: File | null) {
    const target = file ?? testFile
    if (!target || !selectedDocument) {
      toast.error("Choose a photo to try first.")
      setDrawerOpen(true)
      return
    }
    setTestFile(target)
    if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl)
    setTestPreviewUrl(URL.createObjectURL(target))
    setTestRunning(true)
    setDrawerOpen(true)
    try {
      // Save draft first so drawn boxes are applied by the OCR worker.
      if (configuration) {
        const saved = await saveOcrDraft(configuration)
        setConfiguration(saved)
      }
      let result = await runOcrTest(target, selectedDocument.key)
      setTestResult(result)
      if (result.status === "queued" || result.status === "processing") {
        for (let attempt = 0; attempt < 15; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
          const latest = (await listOcrTests()).find((item) => item.id === result.id)
          if (!latest) continue
          const normalized = {
            ...latest,
            extracted_fields: normalizeExtractedFields(latest.extracted_fields),
            confidence: latest.confidence ?? latest.overall_confidence ?? null,
            overall_confidence: latest.overall_confidence ?? latest.confidence ?? null,
          }
          setTestResult(normalized)
          result = normalized
          if (latest.status !== "queued" && latest.status !== "processing") break
        }
      }
      // Only auto-fill regions that are still missing — never overwrite user-drawn boxes.
      if (selectedDocument) {
        const list = normalizeExtractedFields(result.extracted_fields)
        updateSelectedDocument((doc) => ({
          ...doc,
          fields: doc.fields.map((field, index) => {
            const existing = hintsOf(field).region
            if (isValidRegion(existing)) return field
            const hit = list.find((item) => item.key === field.key)
            if (hit?.bbox && hit.bbox.length >= 4) {
              const [x1, y1, x2, y2] = hit.bbox
              if (x2 <= 1.5 && y2 <= 1.5 && x2 > x1 && y2 > y1) {
                return {
                  ...field,
                  extraction_hints: {
                    ...hintsOf(field),
                    region: clampRegion({
                      x: Math.max(0, x1),
                      y: Math.max(0, y1),
                      w: Math.max(0.04, x2 - x1),
                      h: Math.max(0.03, y2 - y1),
                    }),
                  },
                }
              }
            }
            const defaults = defaultRegions(doc.fields.length)
            return {
              ...field,
              extraction_hints: { ...hintsOf(field), region: defaults[index] ?? defaults[0] },
            }
          }),
        }))
      }
      toast.success(
        result.status === "passed"
          ? "Test passed — the photo was read successfully"
          : "Test finished — review what was found under each box",
      )
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not read the photo.")
    } finally {
      setTestRunning(false)
    }
  }

  function addField() {
    if (!selectedDocument) return
    const next = createField(selectedDocument.fields.length)
    const region = defaultRegions(selectedDocument.fields.length + 1)[selectedDocument.fields.length]
    next.extraction_hints = { ...hintsOf(next), region }
    updateSelectedDocument((doc) => ({ ...doc, fields: [...doc.fields, next] }))
    setSelectedFieldKey(next.key)
  }

  function removeField(key: string) {
    if (!selectedDocument) return
    if (!window.confirm("Remove this information field from the proof type?")) return
    const nextFields = selectedDocument.fields.filter((field) => field.key !== key)
    updateSelectedDocument((doc) => ({ ...doc, fields: nextFields }))
    if (selectedFieldKey === key) setSelectedFieldKey(nextFields[0]?.key ?? "")
  }

  function addDocumentType() {
    if (!configuration) return
    const next = createDocumentType(
      configuration.document_types.length,
      configuration.document_types.map((doc) => doc.key),
    )
    updateConfiguration((current) => ({
      ...current,
      document_types: [...current.document_types, next],
    }))
    setSelectedDocKey(next.key)
    setSelectedFieldKey(next.fields[0]?.key ?? "")
    setTestResult(null)
    setSamplePreviewUrl(null)
    toast.success("Proof type added", {
      description:
        "It starts hidden. Add a description, mark the areas to read, then turn on “Available on sign-up”.",
    })
  }

  async function removeDocumentType(key?: string, options?: { confirmed?: boolean }) {
    if (!configuration) return
    const targetKey = key || selectedDocument?.key
    if (!targetKey) return
    if (configuration.document_types.length <= 1) {
      toast.error("Keep at least one proof type.")
      return
    }
    const target = configuration.document_types.find((doc) => doc.key === targetKey)
    if (!options?.confirmed) {
      if (
        !window.confirm(
          `Remove “${target?.name || targetKey}”?\n\nIt will be removed from resident sign-up right away.`,
        )
      ) {
        return
      }
    }

    // Start from the latest draft so we don't fight a stale revision, then drop the type.
    let base = configuration
    try {
      base = await getOcrDraft()
    } catch {
      /* use local configuration */
    }
    const nextTypes = base.document_types.filter((doc) => doc.key !== targetKey)
    if (nextTypes.length === base.document_types.length) {
      // Already gone from draft — still publish so sign-up drops it if published still has it.
      toast.message("Already removed from the editor", {
        description: "Updating resident sign-up list…",
      })
    }
    if (nextTypes.length < 1) {
      toast.error("Keep at least one proof type.")
      return
    }

    const nextConfig: OcrConfiguration = {
      ...base,
      document_types: nextTypes,
    }
    setConfiguration(nextConfig)
    const fallback = nextTypes[0]
    setSelectedDocKey(fallback?.key ?? "")
    setSelectedFieldKey(fallback?.fields[0]?.key ?? "")
    setTestResult(null)

    const result = await saveAndPublish(nextConfig, {
      title: `“${target?.name || targetKey}” removed`,
      description: "It no longer appears on resident sign-up.",
    })

    if (result) {
      // Hard-check the public catalog residents see.
      try {
        const live = await listResidenceProofOptions()
        const stillThere = live.some((item) => item.key === targetKey)
        if (stillThere) {
          toast.error("Removed in the editor, but still on sign-up", {
            description: "Try removing it once more, or turn it off with Available on sign-up.",
          })
        }
      } catch {
        /* ignore verify failure */
      }
      const stillSelected =
        result.draft.document_types.find((doc) => doc.key === fallback?.key) ?? result.draft.document_types[0]
      setSelectedDocKey(stillSelected?.key ?? "")
      setSelectedFieldKey(stillSelected?.fields[0]?.key ?? "")
    } else {
      try {
        await load()
      } catch {
        /* ignore */
      }
    }
  }

  function moveField(key: string, direction: -1 | 1) {
    if (!selectedDocument) return
    const sorted = [...selectedDocument.fields].sort((a, b) => a.order - b.order)
    const index = sorted.findIndex((field) => field.key === key)
    const swap = index + direction
    if (index < 0 || swap < 0 || swap >= sorted.length) return
    const a = sorted[index]
    const b = sorted[swap]
    const orderA = a.order
    sorted[index] = { ...a, order: b.order }
    sorted[swap] = { ...b, order: orderA }
    updateSelectedDocument((doc) => ({
      ...doc,
      fields: doc.fields.map((field) => {
        const updated = sorted.find((item) => item.key === field.key)
        return updated ?? field
      }),
    }))
  }

  if (loading) {
    return (
      <div className={cn("flex min-h-[70vh] flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div className="flex flex-1 items-center justify-center gap-3">
          <LoaderCircle className="size-8 animate-spin text-[#145be7]" />
          <span className={cn("text-sm font-semibold", PROOF_THEME.muted)}>Loading proof templates…</span>
        </div>
      </div>
    )
  }

  if (!configuration) {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div className="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700" role="alert">
          {error || "Proof templates are unavailable right now."}
        </div>
      </div>
    )
  }

  if (view === "list") {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <ProofTypeList
          documents={configuration.document_types}
          saving={saving}
          onAdd={() => {
            addDocumentType()
          }}
          onEdit={(docKey) => {
            setSelectedDocKey(docKey)
            const doc = configuration.document_types.find((item) => item.key === docKey)
            setSelectedFieldKey(doc?.fields[0]?.key ?? "")
            setTestResult(null)
            setView("wizard")
          }}
          onRemove={(docKey) => {
            void removeDocumentType(docKey, { confirmed: true })
          }}
          onToggleAvailable={(docKey, enabled) => {
            void setProofAvailableOnSignup(docKey, enabled)
          }}
        />
      </div>
    )
  }

  if (!selectedDocument) {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div className="m-6 space-y-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700" role="alert">
          <p>{error || "Select a proof type to continue setup."}</p>
          <Button
            type="button"
            variant="outline"
            className="font-bold"
            onClick={() => setView("list")}
          >
            <ArrowLeft className="size-4" />
            Back to all proof types
          </Button>
        </div>
      </div>
    )
  }

  const canvasSource = testPreviewUrl || samplePreviewUrl
  const templateMatch = testResult?.template_match
  const overallConfidence = testResult?.overall_confidence ?? testResult?.confidence ?? null
  const selectedDetected = selectedField ? extractedByKey.get(selectedField.key) : null
  const activeTypeCount = configuration.document_types.filter((doc) => doc.enabled !== false).length
  const fieldCount = selectedDocument.fields.length
  const sampleCount = Object.values(samplePreviewBySide).filter(Boolean).length

  return (
    <div className={cn("flex min-h-full flex-col", T.bg)}>
      <Topbar />
      <main className="mx-auto w-full max-w-[1700px] space-y-5 p-4 md:p-7">
        {/* Header */}
        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "mb-3 inline-flex items-center gap-1.5 text-sm font-bold transition hover:text-[#145be7]",
                T.muted,
              )}
            >
              <ArrowLeft className="size-4" />
              All proof types
            </button>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-[#145be7]">
                <IdCard className="size-3.5" />
                Resident verification
              </span>
              <Badge
                className={cn(
                  "font-bold ring-1 hover:bg-inherit",
                  configuration.status === "draft"
                    ? "bg-amber-50 text-amber-800 ring-amber-200"
                    : "bg-emerald-50 text-emerald-800 ring-emerald-200",
                )}
              >
                {configuration.status === "draft" ? "Working draft" : configuration.status}
              </Badge>
            </div>
            <h1 className={cn("text-2xl font-black md:text-3xl", T.title)}>
              {selectedDocument.template_name?.trim() ||
                selectedDocument.name?.trim() ||
                "Edit proof type"}
            </h1>
            <p className={cn("mt-2 max-w-2xl text-sm font-semibold leading-6", T.body)}>
              Mark where information appears on the photo, set rules, try a sample, and turn on
              availability when ready.
            </p>
            {saving ? (
              <p className={cn("mt-2 inline-flex items-center gap-2 text-xs font-bold", T.muted)}>
                <LoaderCircle className="size-3.5 animate-spin text-[#145be7]" />
                Updating sign-up…
              </p>
            ) : null}
          </div>
        </header>

        {/* Snapshot metrics */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              [Layers3, "Proof types", configuration.document_types.length, `${activeTypeCount} shown on sign-up`, "text-[#145be7] bg-blue-50"],
              [FileCheck2, "Information fields", fieldCount, "Areas the system will read", "text-violet-700 bg-violet-50"],
              [ImageIcon, "Sample photos", sampleCount, sampleCount ? "Ready to mark areas" : "Upload a clear sample", "text-emerald-700 bg-emerald-50"],
              [Sparkles, "Last updated", configuration.updated_at ? new Date(configuration.updated_at).toLocaleDateString() : "—", configuration.updated_by || "Not published yet", "text-orange-700 bg-orange-50"],
            ] as const
          ).map(([Icon, label, value, help, color]) => (
            <section key={label} className={cn(T.card, "p-4")}>
              <div className="flex items-center gap-3">
                <span className={cn("flex size-11 items-center justify-center rounded-full", color)}>
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className={cn("text-xs font-bold", T.muted)}>{label}</p>
                  <p className={cn("text-2xl font-black", T.title)}>{value}</p>
                </div>
              </div>
              <p className={cn("mt-3 text-[11px] font-semibold", T.muted)}>{help}</p>
            </section>
          ))}
        </div>

        {/* Proof type setup */}
        <section className={cn(T.card, "p-5")}>
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className={cn("text-base font-black", T.title)}>Proof type settings</h2>
              <p className={cn("mt-1 text-xs font-semibold", T.body)}>
                Name the ID or document, choose how many photos residents take, and turn it on for sign-up.
              </p>
            </div>
            <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-semibold leading-4 text-[#145be7]">
              Use <strong>Available on sign-up</strong> to show or hide this proof for residents. Changes apply
              automatically.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-5">
              <label className="block">
                <FieldLabel hint="What residents see when choosing their ID (example: Barangay ID)">
                  Name of this proof
                </FieldLabel>
                <Input
                  value={
                    selectedDocument.template_name !== undefined && selectedDocument.template_name !== null
                      ? selectedDocument.template_name
                      : selectedDocument.name || ""
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    updateSelectedDocument((doc) => ({
                      ...doc,
                      // Keep name and template_name in sync so empty string is allowed while typing.
                      template_name: value,
                      name: value,
                    }))
                  }}
                  onBlur={() => void saveProofNameAndDescription()}
                  className={cn("h-10 font-bold", T.title)}
                  placeholder="e.g. Barangay ID, Utility bill"
                />
              </label>
              <label className="block">
                <FieldLabel hint="Shown under the name when residents choose their document">
                  Description for sign-up
                </FieldLabel>
                <textarea
                  value={selectedDocument.description || ""}
                  onChange={(event) =>
                    updateSelectedDocument((doc) => ({
                      ...doc,
                      description: event.target.value.slice(0, 255),
                    }))
                  }
                  onBlur={() => void saveProofNameAndDescription()}
                  rows={2}
                  maxLength={255}
                  className="min-h-[4.5rem] w-full resize-y rounded-lg border border-[#cbd8ee] bg-white px-3 py-2 text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8] focus:border-[#145be7] focus-visible:ring-[3px] focus-visible:ring-[#145be7]/20"
                  placeholder="e.g. Barangay-issued resident identification card."
                />
                <span className={cn("mt-1 block text-[11px] font-semibold", T.muted)}>
                  {(selectedDocument.description || "").length}/255 · Example on sign-up: “Choose your document”
                </span>
              </label>
            </div>

            <div className="lg:col-span-4">
              <FieldLabel hint="Switch between the proofs you are setting up">Select proof type</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className={cn(selectClass(), "min-w-0 flex-1")}
                  value={selectedDocument.key}
                  onChange={(event) => {
                    setSelectedDocKey(event.target.value)
                    const doc = configuration.document_types.find((item) => item.key === event.target.value)
                    setSelectedFieldKey(doc?.fields[0]?.key ?? "")
                    setTestResult(null)
                  }}
                >
                  {configuration.document_types.map((doc) => (
                    <option key={doc.key} value={doc.key}>
                      {doc.enabled === false ? `${doc.name} (hidden)` : doc.name}
                    </option>
                  ))}
                </select>
                <Button type="button" size="sm" className={cn("shrink-0 font-bold text-white", T.primaryBg)} onClick={addDocumentType}>
                  <Plus className="size-4" />
                  Add
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 font-bold text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => void removeDocumentType()}
                  disabled={configuration.document_types.length <= 1 || saving}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] px-3 py-2.5 text-xs font-semibold">
                <Switch
                  checked={selectedDocument.enabled !== false}
                  disabled={saving}
                  onCheckedChange={(enabled) =>
                    void setProofAvailableOnSignup(selectedDocument.key, enabled)
                  }
                />
                <span className="min-w-0">
                  <span className={cn("block font-black", T.title)}>
                    {selectedDocument.enabled !== false ? "Available on sign-up" : "Hidden from sign-up"}
                  </span>
                  <span className={cn("mt-0.5 block text-[11px] font-semibold", T.muted)}>
                    {saving
                      ? "Updating resident list…"
                      : selectedDocument.enabled !== false
                        ? "Residents can pick this document now"
                        : "Turn on to show this on resident registration"}
                  </span>
                </span>
              </label>
            </div>

            <label className="lg:col-span-3">
              <FieldLabel hint="Optional note for your records">Version note</FieldLabel>
              <Input
                value={selectedDocument.template_version || "v1.0"}
                onChange={(event) =>
                  updateSelectedDocument((doc) => ({ ...doc, template_version: event.target.value }))
                }
                className="h-10 font-semibold"
              />
            </label>
          </div>

          {/* Live preview of how it appears on sign-up */}
          <div className="mt-5 rounded-2xl border border-dashed border-[#cbd8ee] bg-[#f8fafc] p-4">
            <p className={cn("text-[11px] font-black uppercase tracking-wide", T.muted)}>
              Sign-up preview
            </p>
            <p className={cn("mt-2 text-sm font-black", T.title)}>Choose your document</p>
            <p className={cn("mt-0.5 text-xs font-semibold", T.body)}>
              Select the ID or bill you will capture or upload. We will verify it against the approved Barangay
              templates.
            </p>
            <div
              className={cn(
                "mt-3 flex items-start gap-3 rounded-2xl border bg-white p-4",
                selectedDocument.enabled !== false ? "border-[#dfe7f5]" : "border-amber-200 opacity-70",
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#145be7]">
                <IdCard className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-black", T.title)}>
                  {selectedDocument.template_name || selectedDocument.name || "Proof name"}
                </span>
                <span className={cn("mt-0.5 block text-xs font-semibold", T.muted)}>
                  {selectedDocument.description?.trim() ||
                    (canvasSides.length > 1
                      ? "Front and back required — you will capture both"
                      : "One clear photo of the document")}
                </span>
                {selectedDocument.enabled === false ? (
                  <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    Hidden — not shown to residents
                  </span>
                ) : (
                  <span className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Visible on sign-up
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="mt-5">
            <FieldLabel hint="How many photos a resident must take of this proof">
              Photos required at sign-up
            </FieldLabel>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    id: "one",
                    label: "Front only",
                    hint: "Resident uploads one clear photo — works for bills, certificates, and IDs that only need one side",
                    sides: ["single"] as const,
                    min: 1,
                    max: 1,
                  },
                  {
                    id: "both",
                    label: "Front and back",
                    hint: "Resident takes two photos — front of the ID first, then the back",
                    sides: ["front", "back"] as const,
                    min: 2,
                    max: 2,
                  },
                ] as const
              ).map((option) => {
                const current = selectedDocument.required_sides ?? ["single"]
                const needsBoth = current.includes("front") && current.includes("back")
                // "Front only" and "single" both mean one photo for residents — treat as the same choice.
                const selected = option.id === "both" ? needsBoth : !needsBoth
                const sampleCount = countSamplePhotos(selectedDocument)
                const blockedByTwoSamples = !selected && sampleCount >= 2
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition",
                      selected
                        ? "border-[#145be7] bg-blue-50/60 ring-1 ring-[#145be7]/25"
                        : blockedByTwoSamples
                          ? "cursor-not-allowed border-[#dfe7f5] bg-[#f1f4f9] opacity-70"
                          : "border-[#dfe7f5] bg-[#f8fafc] hover:border-[#cbd8ee] hover:bg-white",
                    )}
                  >
                    <input
                      type="radio"
                      name="capture-sides"
                      className="mt-1 accent-[#145be7]"
                      checked={selected}
                      disabled={blockedByTwoSamples}
                      onChange={() => changeCaptureMode(option.id)}
                    />
                    <span>
                      <span className={cn("block text-sm font-black", T.title)}>{option.label}</span>
                      <span className={cn("mt-0.5 block text-[11px] font-semibold leading-4", T.muted)}>
                        {option.hint}
                      </span>
                      {blockedByTwoSamples ? (
                        <span className="mt-1 block text-[11px] font-bold text-amber-800">
                          Remove one sample photo first to switch.
                        </span>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </section>

        {/* Main workspace: 3 steps */}
        <section className="grid gap-5 xl:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.45fr)_minmax(16rem,0.95fr)]">
          {/* Step 1 — Information list */}
          <Panel
            step={1}
            title="Information to read"
            description="List what the system should look for on this proof (name, address, ID number, and so on)."
            className="min-h-[28rem]"
            action={
              <Button size="sm" className={cn("font-bold text-white", T.primaryBg)} onClick={addField}>
                <Plus className="size-4" />
                Add
              </Button>
            }
          >
            <div className="relative mb-3">
              <Search className={cn("pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2", T.muted)} />
              <Input
                value={fieldSearch}
                onChange={(event) => setFieldSearch(event.target.value)}
                placeholder="Search information…"
                className="h-10 pl-8 font-semibold"
              />
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
              {fields.map((field, index) => {
                const color = FIELD_COLORS[index % FIELD_COLORS.length]
                const detected = extractedByKey.get(field.key)
                const selected = selectedField?.key === field.key
                return (
                  <div
                    key={field.key}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-colors",
                      selected
                        ? "border-[#145be7] bg-blue-50/80 shadow-sm"
                        : "border-[#dfe7f5] bg-[#f8fafc] hover:bg-white",
                    )}
                  >
                    <button
                      type="button"
                      className="text-[#c0cadb]"
                      title="Reorder"
                      onClick={() => moveField(field.key, -1)}
                    >
                      <GripVertical className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => selectField(field.key)}
                    >
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: color }}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-black", T.title)}>{field.label}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {field.required ? (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                              Required
                            </span>
                          ) : null}
                          <span className={cn("text-[11px] font-semibold", T.muted)}>
                            {asPercent(detected?.confidence ?? field.min_confidence)} quality
                          </span>
                        </span>
                      </span>
                    </button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => selectField(field.key)}>
                      <Pencil className="size-3.5 text-[#68739c]" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => removeField(field.key)}>
                      <Trash2 className="size-3.5 text-[#68739c]" />
                    </Button>
                  </div>
                )
              })}
              {fields.length === 0 ? (
                <p className={cn("rounded-xl border border-dashed border-[#cbd8ee] px-3 py-10 text-center text-sm font-semibold", T.muted)}>
                  No information listed yet. Add items such as Full name or Address.
                </p>
              ) : null}
            </div>
            <p className={cn("mt-3 border-t pt-3 text-[11px] font-semibold", T.border, T.muted)}>
              Click an item to edit it. Use the grip icon to change order.
            </p>
          </Panel>

          {/* Step 2 — Mark areas */}
          <Panel
            step={2}
            title="Mark areas on the photo"
            description="Upload a clear sample, then drag colored boxes over the text the system should read."
            className="min-h-[28rem]"
            action={
              <div className="flex flex-wrap gap-1.5">
                <input
                  ref={sampleInputRef}
                  type="file"
                  accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ""
                    void handleSampleUpload(file, sampleUploadSideRef.current)
                  }}
                />
                <Button variant="outline" size="sm" className="bg-white" onClick={() => setZoom((z) => Math.min(2, z + 0.1))}>
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="bg-white" onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}>
                  <ZoomOut className="size-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="bg-white" onClick={() => setZoom(1)}>
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>
            }
          >
            <div className="mb-4">
              <p className={cn("mb-2 text-xs font-black", T.title)}>Sample photos</p>
              <div className={cn("grid gap-2", canvasSides.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {canvasSides.map((side) => {
                  const label =
                    side === "front" ? "Front" : side === "back" ? "Back" : "Sample photo"
                  const hasImage = Boolean(samplePreviewBySide[side])
                  const active = samplePreviewSide === side
                  return (
                    <div
                      key={side}
                      className={cn(
                        "rounded-xl border p-2.5 transition",
                        active
                          ? "border-[#145be7] bg-blue-50/50 ring-1 ring-[#145be7]/25"
                          : "border-[#dfe7f5] bg-white",
                      )}
                    >
                      <button
                        type="button"
                        className={cn("mb-2 text-left text-xs font-black", T.title)}
                        onClick={() => setSamplePreviewSide(side)}
                      >
                        {label}
                        {hasImage ? (
                          <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                            Ready
                          </span>
                        ) : (
                          <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                            Needed
                          </span>
                        )}
                      </button>
                      {hasImage ? (
                        <button
                          type="button"
                          className="mb-2 block w-full overflow-hidden rounded-lg border border-[#dfe7f5] bg-[#f8faff]"
                          onClick={() => setSamplePreviewSide(side)}
                        >
                          <img
                            src={samplePreviewBySide[side]}
                            alt={label}
                            className="mx-auto max-h-24 object-contain"
                          />
                        </button>
                      ) : (
                        <p className={cn("mb-2 text-[11px] font-semibold", T.muted)}>
                          No {side === "single" ? "sample" : side} photo yet.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs font-bold"
                          disabled={saving}
                          onClick={() => {
                            sampleUploadSideRef.current = side
                            setSamplePreviewSide(side)
                            sampleInputRef.current?.click()
                          }}
                        >
                          <CloudUpload className="size-3.5" />
                          {hasImage ? "Replace" : "Upload"}
                        </Button>
                        {hasImage ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs font-bold text-destructive hover:text-destructive"
                            disabled={saving}
                            onClick={() => void handleSampleRemove(side)}
                          >
                            <Trash2 className="size-3.5" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              {canvasSides.length > 1 ? (
                <p className={cn("mt-2 text-[11px] font-semibold", T.muted)}>
                  Front and back are saved separately. Click a side to mark boxes on that photo.
                </p>
              ) : null}
            </div>

            <div className="relative flex min-h-[16rem] flex-1 items-center justify-center overflow-auto rounded-xl bg-[#eef2fb] p-4">
              {!canvasSource ? (
                <button
                  type="button"
                  onClick={() => {
                    sampleUploadSideRef.current = samplePreviewSide
                    sampleInputRef.current?.click()
                  }}
                  className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-dashed border-[#cbd8ee] bg-white px-6 py-14 text-center shadow-sm"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-blue-50 text-[#145be7]">
                    <CloudUpload className="size-6" />
                  </span>
                  <span className={cn("text-sm font-black", T.title)}>
                    Upload{" "}
                    {samplePreviewSide === "back"
                      ? "the back"
                      : samplePreviewSide === "front"
                        ? "the front"
                        : "a sample photo"}
                  </span>
                  <span className={cn("text-xs font-semibold", T.muted)}>
                    Clear JPG or PNG works best
                  </span>
                </button>
              ) : (
                <div
                  className="relative origin-center shadow-lg"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
                >
                  <div ref={canvasFrameRef} className="relative inline-block max-h-[32rem] max-w-full">
                    <img
                      src={canvasSource}
                      alt="Sample photo"
                      className="block max-h-[32rem] max-w-full select-none rounded-md border border-[#d5deee] bg-white object-contain"
                      draggable={false}
                    />
                    {sortedCanvasFields.map((field, index) => {
                      const region =
                        hintsOf(field).region ?? defaultRegionForIndex(index, sortedCanvasFields.length)
                      const color = FIELD_COLORS[index % FIELD_COLORS.length]
                      const selected = selectedField?.key === field.key
                      const crowded = sortedCanvasFields.some((other, otherIndex) => {
                        if (other.key === field.key) return false
                        const otherRegion =
                          hintsOf(other).region ?? defaultRegionForIndex(otherIndex, sortedCanvasFields.length)
                        return regionsOverlapOrClose(region, otherRegion)
                      })
                      const fillOpacity = selected ? 0.18 : crowded ? 0.04 : 0.08
                      const borderOpacity = selected ? 1 : crowded ? 0.45 : 0.85
                      return (
                        <div
                          key={field.key}
                          role="button"
                          tabIndex={0}
                          title={`${field.label} — drag to move, corner to resize. The system reads text inside this box.`}
                          onPointerDown={(event) => beginRegionDrag(event, field.key, "move", region)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              selectField(field.key)
                            }
                          }}
                          className={cn(
                            "absolute cursor-move rounded border-2 text-left outline-none transition-[box-shadow,opacity]",
                            selected ? "z-20 shadow-[0_0_0_3px_rgba(20,91,231,0.28)]" : "z-10 hover:z-20",
                            regionDrag?.fieldKey === field.key && "z-30",
                            !selected && crowded && "hover:opacity-100",
                          )}
                          style={{
                            left: `${region.x * 100}%`,
                            top: `${region.y * 100}%`,
                            width: `${region.w * 100}%`,
                            height: `${region.h * 100}%`,
                            borderColor: color,
                            backgroundColor: `color-mix(in srgb, ${color} ${Math.round(fillOpacity * 100)}%, transparent)`,
                            opacity: selected ? 1 : crowded ? 0.55 : 0.9,
                            borderWidth: selected ? 2.5 : crowded ? 1.5 : 2,
                            boxShadow: selected
                              ? undefined
                              : crowded
                                ? `inset 0 0 0 1px ${color}${Math.round(borderOpacity * 40).toString(16).padStart(2, "0")}`
                                : undefined,
                          }}
                        >
                          <span
                            className={cn(
                              "pointer-events-none absolute -left-px max-w-[10rem] truncate rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm",
                              selected || !crowded ? "-top-5" : "-top-4 scale-95",
                            )}
                            style={{
                              backgroundColor: color,
                              opacity: selected ? 1 : crowded ? 0.7 : 0.95,
                            }}
                          >
                            {index + 1} {field.label}
                          </span>
                          {selected ? (
                            <span
                              aria-label={`Resize ${field.label}`}
                              onPointerDown={(event) => beginRegionDrag(event, field.key, "resize", region)}
                              className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-se-resize rounded-sm border-2 border-white shadow"
                              style={{ backgroundColor: color }}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                    <span className="pointer-events-none absolute bottom-2 right-2 rotate-[-8deg] text-xs font-semibold uppercase tracking-widest text-blue-500/40">
                      {sideLabel(samplePreviewSide)} preview
                    </span>
                  </div>
                </div>
              )}
            </div>
            <p className={cn("mt-3 border-t pt-3 text-[11px] font-semibold", T.border, T.muted)}>
              Select an item from the list or a box on the photo. Drag the box to move it; use the corner to resize.
              Changes go live when you upload a sample, try a photo, or toggle availability.
            </p>
          </Panel>

          {/* Step 3 — Rules */}
          <Panel
            step={3}
            title="Rules for this field"
            description="Decide what must match, and how strictly the system should check."
            className="min-h-[28rem]"
          >
            {!selectedField ? (
              <p className={cn("py-8 text-center text-sm font-semibold", T.muted)}>
                Select an information item from the list to set its rules.
              </p>
            ) : (
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
                <div className="flex items-center gap-2 rounded-xl bg-[#f2f6ff] px-3 py-2.5">
                  <span
                    className="flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: FIELD_COLORS[selectedFieldIndex % FIELD_COLORS.length] }}
                  >
                    {selectedFieldIndex + 1}
                  </span>
                  <p className={cn("text-sm font-black", T.title)}>
                    Editing: <span className="text-[#145be7]">{selectedField.label}</span>
                  </p>
                </div>

                <label className="block">
                  <FieldLabel hint="Simple name officials and residents will understand">What to call this</FieldLabel>
                  <Input
                    value={selectedField.label}
                    onChange={(event) =>
                      updateField(selectedField.key, (field) => ({ ...field, label: event.target.value }))
                    }
                    className="h-10 font-semibold"
                  />
                </label>

                <div className="grid grid-cols-1 gap-2">
                  <ToggleRow
                    label="Must appear on the proof"
                    hint="The box must find a value before the check can pass"
                    checked={selectedField.required}
                    onCheckedChange={(required) => {
                      updateField(selectedField.key, (field) => ({ ...field, required }))
                      setFieldValidationRules(selectedField.key, {
                        required,
                        matchProfiles: fieldMatchProfiles(selectedField.key),
                        notExpired: fieldHasNotExpired(selectedField.key),
                      })
                    }}
                  />
                  <ToggleRow
                    label="Covers more than one line"
                    hint="Turn on for long addresses or multi-line text"
                    checked={Boolean(hintsOf(selectedField).multi_line)}
                    onCheckedChange={(multi_line) => updateFieldHints(selectedField.key, { multi_line })}
                  />
                </div>

                <div>
                  <p className={cn("mb-1 text-xs font-black", T.title)}>Compare with resident’s form</p>
                  <p className={cn("mb-2 text-[11px] font-semibold leading-4", T.muted)}>
                    Text when the resident finishes registration. Texted text must match the form fields you pick.
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {(
                      [
                        ["first_name", "First name"],
                        ["middle_name", "Middle name"],
                        ["last_name", "Last name"],
                        ["gender", "Gender"],
                        ["date_of_birth", "Date of birth"],
                        ["address", "Address"],
                      ] as const
                    ).map(([profileKey, label]) => {
                      const active = fieldMatchProfiles(selectedField.key).includes(profileKey)
                      return (
                        <label
                          key={profileKey}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition",
                            active
                              ? "border-[#145be7] bg-blue-50 text-[#07145f]"
                              : "border-[#dfe7f5] text-[#07145f] hover:bg-[#f8fafc]",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 accent-[#145be7]"
                            checked={active}
                            onChange={(event) => {
                              const current = fieldMatchProfiles(selectedField.key)
                              const next = event.target.checked
                                ? [...current, profileKey]
                                : current.filter((item) => item !== profileKey)
                              setFieldValidationRules(selectedField.key, {
                                required: selectedField.required,
                                matchProfiles: next,
                                notExpired: fieldHasNotExpired(selectedField.key),
                              })
                            }}
                          />
                          {label}
                        </label>
                      )
                    })}
                  </div>
                </div>

                <ToggleRow
                  label="Must not be expired"
                  hint="Use for expiry or valid-until dates only"
                  checked={fieldHasNotExpired(selectedField.key)}
                  onCheckedChange={(notExpired) =>
                    setFieldValidationRules(selectedField.key, {
                      required: selectedField.required,
                      matchProfiles: fieldMatchProfiles(selectedField.key),
                      notExpired,
                    })
                  }
                />

                <details className="rounded-xl border border-dashed border-[#cbd8ee] p-3">
                  <summary className={cn("cursor-pointer text-xs font-black", T.muted)}>
                    Optional: exact text pattern &amp; labels
                  </summary>
                  <label className="mt-3 block">
                    <FieldLabel hint="Advanced — require a specific pattern in the value">
                      Text pattern (optional)
                    </FieldLabel>
                    <Input
                      value={hintsOf(selectedField).regex_pattern || ""}
                      placeholder={
                        /number|id_no|document/i.test(selectedField.key + selectedField.label)
                          ? "2026|MH\\d{4}-\\d+|20\\d{2}"
                          : "^[A-Z .'-]+$"
                      }
                      onChange={(event) =>
                        updateFieldHints(selectedField.key, { regex_pattern: event.target.value })
                      }
                      className="font-mono text-xs"
                    />
                    <span className={cn("mt-1 block text-[11px] font-semibold leading-snug", T.muted)}>
                      Examples: <code className="rounded bg-[#f2f6ff] px-1">2026</code> must appear;{" "}
                      <code className="rounded bg-[#f2f6ff] px-1">MH\d{"{4}"}-\d+</code> for codes like MH2024-5148.
                      Also turn on “Must appear on the proof.”
                    </span>
                  </label>
                  <label className="mt-3 block">
                    <FieldLabel hint="Printed labels near the text, e.g. ID NO.">
                      Nearby printed labels
                    </FieldLabel>
                    <Input
                      value={(hintsOf(selectedField).expected_keywords || []).join(", ")}
                      placeholder="ID NO, DOCUMENT NUMBER"
                      onChange={(event) =>
                        updateFieldHints(selectedField.key, {
                          expected_keywords: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                          labels: event.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                    <span className={cn("mt-1 block text-[11px] font-semibold", T.muted)}>
                      Helps the system find the right area. Does not check the value itself.
                    </span>
                  </label>
                </details>

                <details className="rounded-xl border border-dashed border-[#cbd8ee] p-3">
                  <summary className={cn("cursor-pointer text-xs font-black", T.muted)}>
                    Optional: reading quality
                  </summary>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className={cn("font-black", T.title)}>Minimum reading quality</span>
                      <span className="font-black text-[#145be7]">
                        {asPercent(selectedField.min_confidence ?? 0.9)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={100}
                      value={Math.round((selectedField.min_confidence ?? 0.9) * 100)}
                      onChange={(event) =>
                        updateField(selectedField.key, (field) => ({
                          ...field,
                          min_confidence: Number(event.target.value) / 100,
                        }))
                      }
                      className="w-full accent-[#145be7]"
                    />
                    <p className={cn("mt-1 text-[11px] font-semibold", T.muted)}>
                      Higher means the system must be more sure about what it read.
                    </p>
                  </div>
                  <div className="mt-3 space-y-2">
                    <ToggleRow
                      label="Fix common reading mistakes"
                      hint="Small spelling and character corrections"
                      checked={hintsOf(selectedField).auto_correct !== false}
                      onCheckedChange={(auto_correct) => updateFieldHints(selectedField.key, { auto_correct })}
                    />
                    <label className="block">
                      <FieldLabel>Letter casing</FieldLabel>
                      <select
                        className={selectClass()}
                        value={
                          hintsOf(selectedField).case_normalization ||
                          selectedField.normalization ||
                          "none"
                        }
                        onChange={(event) => {
                          const value = event.target.value
                          updateField(selectedField.key, (field) => ({
                            ...field,
                            normalization:
                              value === "uppercase" ? "uppercase" : value === "name" ? "name" : "none",
                            extraction_hints: { ...hintsOf(field), case_normalization: value },
                          }))
                        }}
                      >
                        <option value="none">Keep as read</option>
                        <option value="uppercase">ALL CAPS</option>
                        <option value="lowercase">all lowercase</option>
                        <option value="name">Title Case (Names)</option>
                      </select>
                    </label>
                    <ToggleRow
                      label="Remove symbols"
                      hint="Strip punctuation and special characters"
                      checked={Boolean(hintsOf(selectedField).remove_special_chars)}
                      onCheckedChange={(remove_special_chars) =>
                        updateFieldHints(selectedField.key, { remove_special_chars })
                      }
                    />
                  </div>
                </details>

                <div className="rounded-xl border border-[#dfe7f5] bg-[#f2f6ff] p-3">
                  <p className={cn("mb-2 text-xs font-black", T.title)}>Last test for this field</p>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className={cn("font-semibold", T.muted)}>Value found</span>
                    <span className={cn("max-w-[60%] truncate text-right font-black", T.title)}>
                      {selectedDetected?.value || "—"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className={cn("font-semibold", T.muted)}>Reading quality</span>
                    <span className="font-black text-emerald-600">{asPercent(selectedDetected?.confidence)}</span>
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </section>

        {/* Try a sample */}
        <section className={T.card}>
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-4 text-left md:px-5"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <span className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-[#145be7]">
                <FileText className="size-5" />
              </span>
              <span>
                <span className={cn("block text-base font-black", T.title)}>Try with a sample photo</span>
                <span className={cn("mt-0.5 block text-xs font-semibold", T.body)}>
                  Upload a real or sample ID photo to see what the system reads before you publish.
                </span>
              </span>
            </span>
            <span className={cn("text-xs font-bold", T.muted)}>{drawerOpen ? "Hide" : "Show"}</span>
          </button>

          {drawerOpen ? (
            <div className="border-t border-[#dfe7f5] p-4 md:p-5">
              <div className="grid gap-5 lg:grid-cols-[minmax(14rem,0.9fr)_minmax(0,1.2fr)_minmax(14rem,0.85fr)]">
                <div>
                  <p className={cn("mb-2 text-xs font-black", T.title)}>Upload a photo to test</p>
                  <input
                    ref={testInputRef}
                    type="file"
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void runTest(file)
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => testInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOver(true)
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault()
                      setDragOver(false)
                      const file = event.dataTransfer.files?.[0]
                      if (file) void runTest(file)
                    }}
                    className={cn(
                      "flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition",
                      dragOver
                        ? "border-[#145be7] bg-blue-50"
                        : "border-[#cbd8ee] bg-[#f8fafc] hover:bg-white",
                    )}
                  >
                    <CloudUpload className="size-7 text-[#145be7]" />
                    <span className={cn("text-sm font-black", T.title)}>
                      {testRunning ? "Reading photo…" : "Drop a photo here"}
                    </span>
                    <span className={cn("text-xs font-semibold", T.muted)}>JPG or PNG, up to 10MB</span>
                    <span className={cn("mt-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white", T.primaryBg)}>
                      Choose photo
                    </span>
                  </button>
                  {testPreviewUrl ? (
                    <div className="mt-3 overflow-hidden rounded-xl border border-[#dfe7f5]">
                      <img
                        src={testPreviewUrl}
                        alt="Test preview"
                        className="max-h-36 w-full bg-white object-contain"
                      />
                      <div
                        className={cn(
                          "flex items-center justify-between gap-2 border-t border-[#dfe7f5] px-2.5 py-1.5 text-[11px] font-semibold",
                          T.muted,
                        )}
                      >
                        <span className="truncate">{testFile?.name}</span>
                        {testFile ? <span>{Math.round(testFile.size / 1024)} kB</span> : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <p className={cn("mb-2 text-xs font-black", T.title)}>What was found</p>
                  <div className="overflow-hidden rounded-xl border border-[#dfe7f5]">
                    <table className="w-full text-left text-sm">
                      <thead className={cn("bg-[#f2f6ff] text-xs font-bold", T.muted)}>
                        <tr>
                          <th className="px-3 py-2.5">Information</th>
                          <th className="px-3 py-2.5">Value found</th>
                          <th className="px-3 py-2.5 text-right">Quality</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extractedList.length === 0 ? (
                          <tr>
                            <td colSpan={3} className={cn("px-3 py-10 text-center text-xs font-semibold", T.muted)}>
                              Run a test to see what the system reads from your boxes.
                            </td>
                          </tr>
                        ) : (
                          extractedList.map((field, index) => (
                            <tr key={field.key} className="border-t border-[#dfe7f5]">
                              <td className="px-3 py-2.5">
                                <span className="inline-flex items-center gap-2 font-semibold">
                                  <span
                                    className="flex size-5 items-center justify-center rounded text-[10px] font-bold text-white"
                                    style={{ backgroundColor: FIELD_COLORS[index % FIELD_COLORS.length] }}
                                  >
                                    {index + 1}
                                  </span>
                                  {field.label}
                                </span>
                              </td>
                              <td className={cn("px-3 py-2.5 font-black", T.title)}>{field.value || "—"}</td>
                              <td className="px-3 py-2.5 text-right font-black text-emerald-600">
                                {asPercent(field.confidence)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <details className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
                    <summary className={cn("cursor-pointer text-xs font-black", T.muted)}>
                      Technical details (optional)
                    </summary>
                    <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-[#1e293b] bg-[#0b1220] p-3 text-[11px] leading-5 text-emerald-300">
                      {JSON.stringify(
                        testResult?.extraction_json ||
                          Object.fromEntries(extractedList.map((item) => [item.key, item.value])),
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-[#dfe7f5] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
                  {templateMatch?.passed ? (
                    <span className="inline-flex items-center gap-1.5 font-black text-emerald-700">
                      <CheckCircle2 className="size-4" /> Document looks valid
                    </span>
                  ) : testResult ? (
                    <span className="inline-flex items-center gap-1.5 font-black text-amber-700">
                      <XCircle className="size-4" /> Needs a closer look
                    </span>
                  ) : (
                    <span className={T.muted}>Run a test to check this proof type.</span>
                  )}
                  <span className={T.muted}>
                    Overall reading quality{" "}
                    <strong className={T.title}>{asPercent(overallConfidence)}</strong>
                  </span>
                </div>
                <Button
                  className={cn("font-bold text-white", T.primaryBg)}
                  disabled={testRunning || !testFile}
                  onClick={() => void runTest(testFile)}
                >
                  <Play className="size-4" />
                  {testRunning ? "Reading…" : "Try again"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}
