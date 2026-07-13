import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react"
import { toast } from "sonner"

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
import {
  clampRegion,
  createDocumentType,
  createField,
  defaultRegionForIndex,
  ensureDocumentFieldRegions,
  hintsOf,
  isValidRegion,
  type FieldRegion,
} from "@/features/ocr/lib/create-document-defaults"

export type WizardStepId = 1 | 2 | 3 | 4

export type ProfileMatchKey =
  | "first_name"
  | "middle_name"
  | "last_name"
  | "gender"
  | "date_of_birth"
  | "address"

export type RegionDragState =
  | {
      mode: "move" | "resize"
      fieldKey: string
      startX: number
      startY: number
      origin: FieldRegion
    }
  | null

export type SaveAndPublishSuccess = {
  title: string
  description?: string
}

export type SaveAndPublishOptions = {
  verifyKey?: string
  expectVisible?: boolean
  expectAbsent?: boolean
}

export type SaveAndPublishResult = {
  published: OcrConfiguration
  draft: OcrConfiguration
}

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Document"
}

function defaultRegions(count: number): FieldRegion[] {
  return Array.from({ length: count }, (_, index) => defaultRegionForIndex(index, count))
}

export function useOcrTemplateState() {
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
    () =>
      configuration?.document_types.find((doc) => doc.key === selectedDocKey) ??
      configuration?.document_types[0],
    [configuration, selectedDocKey],
  )

  const fields = useMemo(() => {
    const list = [...(selectedDocument?.fields ?? [])].sort((a, b) => a.order - b.order)
    if (!fieldSearch.trim()) return list
    const q = fieldSearch.toLowerCase()
    return list.filter(
      (field) => field.label.toLowerCase().includes(q) || field.key.toLowerCase().includes(q),
    )
  }, [fieldSearch, selectedDocument?.fields])

  const selectedField =
    fields.find((field) => field.key === selectedFieldKey) ?? fields[0] ?? null

  const extractedList: OcrTestField[] = useMemo(() => {
    const list = normalizeExtractedFields(testResult?.extracted_fields)
    if (!selectedDocument?.fields?.length) return list
    const order = new Map(selectedDocument.fields.map((field, index) => [field.key, index]))
    return [...list].sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [selectedDocument?.fields, testResult?.extracted_fields])

  const extractedByKey = useMemo(() => {
    const map = new Map<string, OcrTestField>()
    for (const item of extractedList) map.set(item.key, item)
    return map
  }, [extractedList])

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
      if (current) {
        const stillThere = withRegions.document_types.some((doc) =>
          doc.fields.some((field) => field.key === current),
        )
        if (stillThere) return current
      }
      const doc =
        withRegions.document_types.find((item) => item.key === first) ?? withRegions.document_types[0]
      return doc?.fields[0]?.key ?? ""
    })
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      await load()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Could not load proof templates.")
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    let active = true
    load()
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Could not load proof templates.")
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [load])

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
      canvasSides.includes(current) ? current : (canvasSides[0] ?? "single"),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- match page: reload samples when doc key/url/samples/sides change
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-ensure when identity/count changes
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

  async function saveAndPublish(
    nextConfig?: OcrConfiguration | null,
    success?: SaveAndPublishSuccess,
    options?: SaveAndPublishOptions,
  ): Promise<SaveAndPublishResult | null> {
    let config = nextConfig ?? configuration
    if (!config) return null
    setSaving(true)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const saved = await saveOcrDraft(config)
          const result = await publishOcrDraft(saved.revision)
          setConfiguration(result.draft)

          const live = await listResidenceProofOptions().catch(() => null)
          if (options?.verifyKey && live) {
            const present = live.some((item) => item.key === options.verifyKey)
            if (options.expectVisible && !present) {
              toast.error("Saved, but not showing on sign-up yet", {
                description: "Turn Available on, then try again.",
              })
              // Publish already succeeded; skip success toast when sign-up verify fails.
              return result
            }
            if (options.expectAbsent && present) {
              toast.error("Still on sign-up", {
                description: "Try removing it once more.",
              })
              // Publish already succeeded; skip success toast when sign-up verify fails.
              return result
            }
          }

          if (success) {
            const n = live?.length
            const liveNote =
              n == null
                ? null
                : n === 0
                  ? "No proof types are currently visible on sign-up."
                  : `${n} proof type${n === 1 ? "" : "s"} visible on sign-up.`
            toast.success(success.title, {
              description: [success.description, liveNote].filter(Boolean).join(" "),
            })
          }
          return result
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : String(reason)
          if (attempt === 0 && /revision|changed since/i.test(message)) {
            const latest = await getOcrDraft()
            // Re-apply the intended document list onto the fresh draft (honor removals).
            if (nextConfig) {
              const pendingKeys = new Set(nextConfig.document_types.map((doc) => doc.key))
              const latestByKey = new Map(latest.document_types.map((doc) => [doc.key, doc]))
              config = {
                ...latest,
                document_types: nextConfig.document_types
                  .map((pending) => {
                    const base = latestByKey.get(pending.key)
                    if (!base) return pending
                    return {
                      ...base,
                      ...pending,
                      id: base.id ?? pending.id,
                      // Always honor pending fields/rules (including empty arrays).
                      fields: pending.fields,
                      rules: pending.rules,
                    }
                  })
                  .filter((doc) => pendingKeys.has(doc.key)),
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
      const latest = await getOcrDraft()
      const next: OcrConfiguration = {
        ...latest,
        document_types: latest.document_types.map((doc) =>
          doc.key === docKey ? { ...doc, enabled } : doc,
        ),
      }
      // Preserve local field regions / unsaved edits when keys match.
      // Also append local-only document types that are not yet on the server.
      if (configuration) {
        const localByKey = new Map(configuration.document_types.map((doc) => [doc.key, doc]))
        next.document_types = next.document_types.map((doc) => {
          const local = localByKey.get(doc.key)
          if (!local) return doc
          return {
            ...local,
            id: doc.id,
            enabled: doc.key === docKey ? enabled : doc.enabled,
            // Prefer local name fields even when empty string (do not use ||).
            name: local.name !== undefined && local.name !== null ? local.name : doc.name,
            template_name:
              local.template_name !== undefined && local.template_name !== null
                ? local.template_name
                : doc.template_name,
            description:
              local.description !== undefined && local.description !== null
                ? local.description
                : doc.description,
            required_sides: local.required_sides?.length ? local.required_sides : doc.required_sides,
            min_files: local.min_files ?? doc.min_files,
            max_files: local.max_files ?? doc.max_files,
            fields: local.fields?.length ? local.fields : doc.fields,
            rules: local.rules?.length ? local.rules : doc.rules,
          }
        })
        const latestKeys = new Set(next.document_types.map((doc) => doc.key))
        for (const local of configuration.document_types) {
          if (!latestKeys.has(local.key)) {
            next.document_types.push({
              ...local,
              enabled: local.key === docKey ? enabled : local.enabled,
            })
          }
        }
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
        { verifyKey: docKey, expectVisible: enabled, expectAbsent: !enabled },
      )
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not update availability.")
    }
  }

  /** Persist draft (always) and publish when any proof type is live, then leave wizard safely. */
  async function persistWizardExit(): Promise<void> {
    if (!configuration) return
    setSaving(true)
    try {
      const saved = await saveOcrDraft(configuration)
      setConfiguration(saved)

      const anyEnabled = saved.document_types.some((doc) => doc.enabled !== false)
      const selectedFromSaved = selectedDocument
        ? saved.document_types.find((doc) => doc.key === selectedDocument.key)
        : undefined
      const selectedEnabled =
        (selectedFromSaved?.enabled ?? selectedDocument?.enabled) !== false &&
        Boolean(selectedDocument)
      if (anyEnabled || selectedEnabled) {
        // Soft toast — avoid noisy publish messaging on routine exit.
        await saveAndPublish(saved, { title: "Changes saved" })
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not save changes.")
    } finally {
      setSaving(false)
    }
  }

  async function saveProofNameAndDescription() {
    if (!selectedDocument || !configuration) return
    const targetKey = selectedDocument.key
    const next: OcrConfiguration = {
      ...configuration,
      document_types: configuration.document_types.map((doc) => {
        if (doc.key !== targetKey) return doc
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
    // Hidden proofs: draft-only to avoid thrashing publish. Live proofs: publish so sign-up updates.
    const target = next.document_types.find((doc) => doc.key === targetKey)
    if (target?.enabled === false) {
      setSaving(true)
      try {
        const saved = await saveOcrDraft(next)
        setConfiguration(saved)
      } catch (reason) {
        toast.error(reason instanceof Error ? reason.message : "Could not save proof details.")
      } finally {
        setSaving(false)
      }
      return
    }
    await saveAndPublish(next, {
      title: "Proof details updated",
      description: "Name and description now show on resident sign-up.",
    })
  }

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
            sample.side === "single"
              ? { ...sample, side: "front" as ProofSide, label: "Front" }
              : sample,
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
    if (!selectedDocument) return
    const field = selectedDocument.fields.find((item) => item.key === fieldKey)
    if (!field) return
    if (!hintsOf(field).region) {
      const sorted = [...selectedDocument.fields].sort((a, b) => a.order - b.order)
      const index = Math.max(
        0,
        sorted.findIndex((item) => item.key === fieldKey),
      )
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

  async function handleSampleUpload(file: File | null | undefined, side?: ProofSide) {
    if (!file || !selectedDocument || !configuration) return
    const docKey = selectedDocument.key
    const uploadSide = side ?? sampleUploadSideRef.current ?? samplePreviewSide ?? "single"
    setSaving(true)
    try {
      // New document types exist only in React state until saved.
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

  async function addDocumentType() {
    if (!configuration) return
    const next = createDocumentType(
      configuration.document_types.length,
      configuration.document_types.map((doc) => doc.key),
    )
    const optimistic: OcrConfiguration = {
      ...configuration,
      document_types: [...configuration.document_types, next],
    }
    setConfiguration(optimistic)
    setSelectedDocKey(next.key)
    setSelectedFieldKey(next.fields[0]?.key ?? "")
    setTestResult(null)
    setSamplePreviewUrl(null)
    toast.success("Proof type added", {
      description:
        "It starts hidden. Add a description, mark the areas to read, then turn on “Available on sign-up”.",
    })
    try {
      // Persist immediately so the new type exists on the server (samples/publish can find it).
      const saved = await saveOcrDraft(optimistic)
      setConfiguration(saved)
      const savedDoc =
        saved.document_types.find((doc) => doc.key === next.key) ??
        saved.document_types[saved.document_types.length - 1]
      if (savedDoc) {
        setSelectedDocKey(savedDoc.key)
        setSelectedFieldKey(savedDoc.fields[0]?.key ?? "")
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Could not save the new proof type.")
    }
  }

  async function removeDocumentType(docKey: string): Promise<boolean> {
    const base = configuration
    if (!base || base.document_types.length <= 1) {
      toast.error("Keep at least one proof type.")
      return false
    }

    let working = base
    try {
      working = await getOcrDraft()
    } catch {
      /* use local configuration */
    }

    // Merge local-only document types (not yet on server) before filtering the removed key.
    if (configuration) {
      const workingKeys = new Set(working.document_types.map((doc) => doc.key))
      const localOnly = configuration.document_types.filter((doc) => !workingKeys.has(doc.key))
      if (localOnly.length > 0) {
        working = {
          ...working,
          document_types: [...working.document_types, ...localOnly],
        }
      }
    }

    const target = working.document_types.find((doc) => doc.key === docKey) ??
      base.document_types.find((doc) => doc.key === docKey)
    const nextTypes = working.document_types.filter((doc) => doc.key !== docKey)
    if (nextTypes.length < 1) {
      toast.error("Keep at least one proof type.")
      return false
    }

    const next: OcrConfiguration = {
      ...working,
      document_types: nextTypes,
    }
    setConfiguration(next)
    const fallback = nextTypes[0]
    setSelectedDocKey(fallback?.key ?? "")
    setSelectedFieldKey(fallback?.fields[0]?.key ?? "")
    setTestResult(null)

    const result = await saveAndPublish(
      next,
      {
        title: `“${target?.name || docKey}” removed`,
        description: "It no longer appears on resident sign-up.",
      },
      { verifyKey: docKey, expectAbsent: true },
    )

    if (result) {
      const stillSelected =
        result.draft.document_types.find((doc) => doc.key === fallback?.key) ??
        result.draft.document_types[0]
      setSelectedDocKey(stillSelected?.key ?? "")
      setSelectedFieldKey(stillSelected?.fields[0]?.key ?? "")
      return true
    }

    try {
      await load()
    } catch {
      /* ignore */
    }
    return false
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

  // Mark-areas canvas must show the sample template, never the try-sample test photo.
  const canvasSource = samplePreviewUrl
  const templateMatch = testResult?.template_match
  const overallConfidence = testResult?.overall_confidence ?? testResult?.confidence ?? null
  const selectedDetected = selectedField ? extractedByKey.get(selectedField.key) : null
  const activeTypeCount =
    configuration?.document_types.filter((doc) => doc.enabled !== false).length ?? 0
  const fieldCount = selectedDocument?.fields.length ?? 0
  const sampleCount = Object.values(samplePreviewBySide).filter(Boolean).length

  return {
    // core state
    configuration,
    setConfiguration,
    loading,
    saving,
    error,
    selectedDocKey,
    selectedFieldKey,
    selectedDocument,
    selectedField,
    fields,
    fieldSearch,
    setFieldSearch,

    // selection / mutations
    setSelectedDocKey,
    setSelectedFieldKey,
    updateConfiguration,
    updateSelectedDocument,
    updateField,
    updateFieldHints,

    // lifecycle
    reload,
    load,
    saveAndPublish,
    persistWizardExit,
    setProofAvailableOnSignup,
    saveProofNameAndDescription,
    addDocumentType,
    removeDocumentType,

    // capture mode
    changeCaptureMode,
    countSamplePhotos,
    canvasSides,

    // field validation rules
    rulesForField,
    fieldMatchProfiles,
    fieldHasNotExpired,
    setFieldValidationRules,

    // fields
    addField,
    removeField,
    moveField,
    selectField,
    setFieldRegion,

    // samples
    samplePreviewUrl,
    setSamplePreviewUrl,
    samplePreviewSide,
    setSamplePreviewSide,
    samplePreviewBySide,
    setSamplePreviewBySide,
    sampleInputRef: sampleInputRef as RefObject<HTMLInputElement>,
    sampleUploadSideRef,
    handleSampleUpload,
    handleSampleRemove,

    // canvas
    zoom,
    setZoom,
    dragOver,
    setDragOver,
    regionDrag,
    setRegionDrag,
    canvasFrameRef: canvasFrameRef as RefObject<HTMLDivElement>,
    sortedCanvasFields,
    selectedFieldIndex,
    pointerToRelative,
    beginRegionDrag,
    canvasSource,

    // test
    testFile,
    setTestFile,
    testPreviewUrl,
    setTestPreviewUrl,
    testResult,
    setTestResult,
    testRunning,
    drawerOpen,
    setDrawerOpen,
    testInputRef: testInputRef as RefObject<HTMLInputElement>,
    runTest,
    extractedList,
    extractedByKey,
    templateMatch,
    overallConfidence,
    selectedDetected,

    // derived
    activeTypeCount,
    fieldCount,
    sampleCount,
  }
}
