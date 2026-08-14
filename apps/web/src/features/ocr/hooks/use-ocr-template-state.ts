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
  type SimulatedProfile,
  type VerificationRuleResult,
} from "@/features/ocr/api"
import {
  clampRegion,
  createDocumentType,
  createField,
  defaultRegionForIndex,
  ensureDocumentFieldRegions,
  fieldCanvasSide,
  hintsOf,
  isAutoFieldKey,
  isValidRegion,
  slugifyFieldKey,
  withFieldSide,
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

export type RegionDragState = {
  mode: "move" | "resize"
  fieldKey: string
  startX: number
  startY: number
  origin: FieldRegion
} | null

export type SaveAndPublishSuccess = {
  title: string
  description?: string
  /** Success toasts are opt-in. Set to true only for user-initiated actions the operator explicitly needs confirmation for. */
  notify?: boolean
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

export type TestSlot = {
  file: File
  url: string
}

export type MergedTestVerdict = "idle" | "pass" | "warning" | "block"

export type MergedTestResult = {
  bySide: Partial<Record<ProofSide, OcrTestResult>>
  verdict: MergedTestVerdict
  /** Every rule result across all tested sides (passed and failed). */
  allRules: VerificationRuleResult[]
  failedRules: VerificationRuleResult[]
  tested: boolean
}

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Document"
}

const PROFILE_KEY_ORDER: ProfileMatchKey[] = [
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "gender",
]

// The official's simulated sign-up profile survives a page reload so match
// checks don't silently fall back to the logged-in official's own details.
const TEST_PROFILE_STORAGE_KEY = "proofing.simulatedProfile.v1"

function loadStoredTestProfile(): SimulatedProfile {
  try {
    const raw = window.localStorage.getItem(TEST_PROFILE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: SimulatedProfile = {}
    for (const key of PROFILE_KEY_ORDER) {
      const value = parsed[key]
      if (typeof value === "string" && value.trim()) result[key] = value.trim()
    }
    return result
  } catch {
    return {}
  }
}

function defaultRegions(count: number): FieldRegion[] {
  return Array.from({ length: count }, (_, index) =>
    defaultRegionForIndex(index, count)
  )
}

function mergeConfigPreservingRegions(
  local: OcrConfiguration | null,
  saved: OcrConfiguration
): OcrConfiguration {
  if (!local) return saved
  const localByKey = new Map(
    local.document_types.map((doc) => [doc.key, doc])
  )
  return {
    ...saved,
    document_types: saved.document_types.map((doc) => {
      const localDoc = localByKey.get(doc.key)
      if (!localDoc) return doc
      const localFieldByKey = new Map(
        localDoc.fields.map((field) => [field.key, field])
      )
      return {
        ...doc,
        fields: doc.fields.map((field) => {
          const localField = localFieldByKey.get(field.key)
          if (!localField) return field
          const localHints = localField.extraction_hints ?? {}
          const savedHints = field.extraction_hints ?? {}
          const savedRegion = (savedHints as Record<string, unknown>).region
          const localRegion = (localHints as Record<string, unknown>).region
          if (isValidRegion(localRegion) && !isValidRegion(savedRegion)) {
            return {
              ...field,
              extraction_hints: { ...savedHints, region: localRegion },
            }
          }
          return field
        }),
      }
    }),
  }
}

export function useOcrTemplateState() {
  const [configuration, setConfiguration] = useState<OcrConfiguration | null>(
    null
  )
  const [selectedDocKey, setSelectedDocKey] = useState("")
  const [selectedFieldKey, setSelectedFieldKey] = useState("")
  const [fieldSearch, setFieldSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [zoom, setZoom] = useState(1)
  const [samplePreviewUrl, setSamplePreviewUrl] = useState<string | null>(null)
  const [samplePreviewSide, setSamplePreviewSide] =
    useState<ProofSide>("single")
  const [samplePreviewBySide, setSamplePreviewBySide] = useState<
    Partial<Record<ProofSide, string>>
  >({})
  const [testSlots, setTestSlots] = useState<
    Partial<Record<ProofSide, TestSlot>>
  >({})
  const [testResultsBySide, setTestResultsBySide] = useState<
    Partial<Record<ProofSide, OcrTestResult>>
  >({})
  const [testRunning, setTestRunning] = useState(false)
  const [runningTestKey, setRunningTestKey] = useState<string | null>(null)
  // Resident details typed by the official to simulate a sign-up submission.
  const [testProfile, setTestProfile] = useState<SimulatedProfile>(
    loadStoredTestProfile
  )
  const [dragOver, setDragOver] = useState(false)
  const [regionDrag, setRegionDrag] = useState<RegionDragState>(null)
  // Docs created this session and whether the official has edited them. A doc
  // that was just added and never touched is a blank slate: its placeholder
  // name and pre-placed default regions must not count as configured setup.
  const [editedDocKeys, setEditedDocKeys] = useState<ReadonlySet<string>>(
    new Set()
  )
  const [addedDocKeys, setAddedDocKeys] = useState<ReadonlySet<string>>(
    new Set()
  )

  const sampleInputRef = useRef<HTMLInputElement>(null)
  const sampleUploadSideRef = useRef<ProofSide>("single")
  const canvasFrameRef = useRef<HTMLDivElement>(null)
  const testRunningRef = useRef(false)
  const configDirtyRef = useRef(false)
  const configurationRef = useRef<OcrConfiguration | null>(null)
  const regionSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error">("idle")
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedDocument = useMemo(
    () =>
      configuration?.document_types.find((doc) => doc.key === selectedDocKey) ??
      configuration?.document_types[0],
    [configuration, selectedDocKey]
  )

  const fields = useMemo(() => {
    const list = [...(selectedDocument?.fields ?? [])].sort(
      (a, b) => a.order - b.order
    )
    if (!fieldSearch.trim()) return list
    const q = fieldSearch.toLowerCase()
    return list.filter(
      (field) =>
        field.label.toLowerCase().includes(q) ||
        field.key.toLowerCase().includes(q)
    )
  }, [fieldSearch, selectedDocument?.fields])

  const selectedField =
    fields.find((field) => field.key === selectedFieldKey) ?? fields[0] ?? null

  // Union of every tested side's extractions (first side wins for shared keys),
  // sorted to match the field list so RulesStep can show last-detected values.
  const extractedByKeyMap = new Map<string, OcrTestField>()
  for (const result of Object.values(testResultsBySide)) {
    if (!result) continue
    for (const item of normalizeExtractedFields(result.extracted_fields)) {
      if (!extractedByKeyMap.has(item.key)) extractedByKeyMap.set(item.key, item)
    }
  }
  let extractedList: OcrTestField[] = Array.from(extractedByKeyMap.values())
  if (selectedDocument?.fields?.length) {
    const order = new Map(
      selectedDocument.fields.map((field, index) => [field.key, index])
    )
    extractedList = extractedList.sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999)
    )
  }

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
          doc.fields.some((field) => field.key === current)
        )
        if (stillThere) return current
      }
      const doc =
        withRegions.document_types.find((item) => item.key === first) ??
        withRegions.document_types[0]
      return doc?.fields[0]?.key ?? ""
    })
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      await load()
    } catch (reason: unknown) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load proof templates."
      )
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => {
    // load() sets state synchronously, so defer the initial fetch one
    // macrotask to let the mount render settle (reload is event-driven).
    let active = true
    const id = window.setTimeout(() => {
      load()
        .catch((reason: unknown) => {
          if (active) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not load proof templates."
            )
          }
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(id)
    }
  }, [load])

  // Resident details always show these four fields so every template is tested
  // against the same identity signals; extra profile keys are added when the
  // admin toggles them on. Consistent baseline across every proof type.
  const ALWAYS_SHOWN_PROFILE_KEYS: ProfileMatchKey[] = [
    "first_name",
    "last_name",
    "date_of_birth",
    "gender",
  ]

  const relevantProfileKeys = useMemo<ProfileMatchKey[]>(() => {
    const used = new Set<ProfileMatchKey>(ALWAYS_SHOWN_PROFILE_KEYS)
    for (const field of selectedDocument?.fields ?? []) {
      for (const key of fieldMatchProfiles(field.key)) used.add(key)
    }
    return PROFILE_KEY_ORDER.filter((key) => used.has(key))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rules array identity changes with every edit; recompute is cheap
  }, [selectedDocument?.fields, selectedDocument?.rules])

  const canvasSides = useMemo((): ProofSide[] => {
    if (!selectedDocument) return ["single"]
    const sides = selectedDocument.required_sides?.length
      ? selectedDocument.required_sides
      : ["single"]
    if (sides.includes("front") && sides.includes("back"))
      return ["front", "back"]
    if (sides.includes("front")) return ["front"]
    if (sides.includes("back")) return ["back"]
    return ["single"]
  }, [selectedDocument])

  // Keep the active preview side valid as the canvas sides change —
  // render-adjust instead of a sync setState effect.
  const sidesKey = canvasSides.join("|")
  // Stable primitives for the sample-loader effect below. The document object
  // is replaced on unrelated field/rules edits, so it can't be a dependency
  // without reloading sample blobs on every keystroke — only the exact fields
  // the effect reads go into its dep array.
  const docSamples = selectedDocument?.samples
  const docSampleUrl = selectedDocument?.sample_url
  const docSampleFilename = selectedDocument?.sample_original_filename
  const hasSelectedDocument = selectedDocument != null
  const [prevSidesKey, setPrevSidesKey] = useState(sidesKey)
  if (prevSidesKey !== sidesKey) {
    setPrevSidesKey(sidesKey)
    setSamplePreviewSide((current) =>
      canvasSides.includes(current) ? current : (canvasSides[0] ?? "single")
    )
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(
        TEST_PROFILE_STORAGE_KEY,
        JSON.stringify(testProfile)
      )
    } catch {
      // Storage unavailable — the profile just won't persist across reloads.
    }
  }, [testProfile])

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    async function loadSamples() {
      if (!hasSelectedDocument) {
        setSamplePreviewBySide({})
        setSamplePreviewUrl(null)
        return
      }
      const sampleList = docSamples?.filter((s) => s.url)?.length
        ? docSamples.filter((s) => s.url)
        : docSampleUrl
          ? [
              {
                side: (canvasSides[0] ?? "single") as ProofSide,
                url: docSampleUrl,
                filename: docSampleFilename || "",
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
      if (
        !next.single &&
        next.back &&
        canvasSides.includes("single") &&
        !next.front
      ) {
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
  }, [hasSelectedDocument, docSamples, docSampleUrl, docSampleFilename, canvasSides])

  useEffect(() => {
    // Re-derive the preview URL on side/bySide changes. Deferred a microtask
    // so the setState isn't synchronous inside the effect (imperceptible).
    queueMicrotask(() =>
      setSamplePreviewUrl(
        samplePreviewBySide[samplePreviewSide] ??
          samplePreviewBySide[canvasSides[0] ?? "single"] ??
          null
      )
    )
  }, [samplePreviewSide, samplePreviewBySide, canvasSides])

  // Whenever the selected document changes, guarantee every field has a canvas
  // region — render-adjust instead of a sync setState inside an effect.
  const ensureKey = selectedDocument
    ? `${selectedDocument.key}|${selectedDocument.fields.length}`
    : ""
  const [prevEnsureKey, setPrevEnsureKey] = useState(ensureKey)
  if (ensureKey !== prevEnsureKey && selectedDocument) {
    setPrevEnsureKey(ensureKey)
    const ensured = ensureDocumentFieldRegions(selectedDocument)
    if (ensured !== selectedDocument) {
      setConfiguration((current) => {
        if (!current) return current
        return {
          ...current,
          document_types: current.document_types.map((doc) =>
            doc.key === selectedDocument.key ? ensured : doc
          ),
        }
      })
    }
  }

  useEffect(() => {
    configurationRef.current = configuration ?? null
  }, [configuration])

  useEffect(() => {
    return () => {
      if (regionSaveTimerRef.current) clearTimeout(regionSaveTimerRef.current)
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    }
  }, [])

  // Best-effort flush on tab close so rapid nav doesn't drop the last edit.
  useEffect(() => {
    function handler() {
      if (!configDirtyRef.current) return
      const current = configurationRef.current
      if (!current) return
      try {
        const url = "/api/auth/ocr/config/draft/"
        const body = JSON.stringify(current)
        const blob = new Blob([body], { type: "application/json" })
        // sendBeacon is fire-and-forget and survives unload.
        navigator.sendBeacon?.(url, blob)
      } catch {
        /* best-effort only */
      }
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])

  function flushSavedIndicator() {
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current)
    savedFlashTimerRef.current = setTimeout(() => setAutoSaveState("idle"), 1500)
  }

  function scheduleDraftSave(delayMs = 500) {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    setAutoSaveState("pending")
    autoSaveTimerRef.current = setTimeout(async () => {
      const current = configurationRef.current
      if (!current || !configDirtyRef.current) return
      setAutoSaveState("saving")
      // Snapshot dirty flag: any edit that happens during the network call
      // must survive the response, so we clear only when nothing new dirties.
      const revisionAtSend = current.revision
      configDirtyRef.current = false
      try {
        const saved = await saveOcrDraft(current)
        // Never overwrite local rules/fields with server state — the user may
        // have kept editing while the request was in flight (e.g. toggling a
        // chip off, then the response for the "on" save arrives and snaps it
        // back on). Only pull the fresh revision so the next save doesn't 409.
        setConfiguration((state) => {
          if (!state) return saved
          if (state.revision !== revisionAtSend) return state
          return { ...state, revision: saved.revision }
        })
        setAutoSaveState("saved")
        flushSavedIndicator()
        // Another edit landed while we were saving → schedule again.
        if (configDirtyRef.current) scheduleDraftSave(200)
      } catch {
        configDirtyRef.current = true
        setAutoSaveState("error")
      }
    }, delayMs)
  }

  function updateConfiguration(
    updater: (current: OcrConfiguration) => OcrConfiguration
  ) {
    setConfiguration((current) => {
      if (!current) return current
      const next = updater(current)
      if (next !== current) {
        configDirtyRef.current = true
        scheduleDraftSave()
      }
      return next
    })
  }

  function markDocumentEdited(docKey: string) {
    setEditedDocKeys((current) => {
      if (current.has(docKey)) return current
      const next = new Set(current)
      next.add(docKey)
      return next
    })
  }

  function markDocumentAdded(docKey: string) {
    setAddedDocKeys((current) => {
      if (current.has(docKey)) return current
      const next = new Set(current)
      next.add(docKey)
      return next
    })
  }

  function forgetDocument(docKey: string) {
    setEditedDocKeys((current) => {
      if (!current.has(docKey)) return current
      const next = new Set(current)
      next.delete(docKey)
      return next
    })
    setAddedDocKeys((current) => {
      if (!current.has(docKey)) return current
      const next = new Set(current)
      next.delete(docKey)
      return next
    })
  }

  function updateSelectedDocument(
    updater: (doc: OcrDocumentType) => OcrDocumentType
  ) {
    if (!selectedDocument) return
    markDocumentEdited(selectedDocument.key)
    updateConfiguration((current) => ({
      ...current,
      document_types: current.document_types.map((doc) =>
        doc.key === selectedDocument.key ? updater(doc) : doc
      ),
    }))
  }

  function countSamplePhotos(doc: OcrDocumentType) {
    const previewUrls = new Set(
      (Object.values(samplePreviewBySide) as Array<string | undefined>).filter(
        Boolean
      ) as string[]
    )
    if (previewUrls.size > 0) return previewUrls.size
    const listedUrls = new Set(
      (doc.samples ?? [])
        .map((sample) => sample.url)
        .filter((url): url is string => Boolean(url))
    )
    if (listedUrls.size > 0) return listedUrls.size
    return doc.sample_url ? 1 : 0
  }

  async function saveAndPublish(
    nextConfig?: OcrConfiguration | null,
    success?: SaveAndPublishSuccess,
    options?: SaveAndPublishOptions
  ): Promise<SaveAndPublishResult | null> {
    let config = nextConfig ?? configuration
    if (!config) return null
    setSaving(true)
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const saved = await saveOcrDraft(config)
          const result = await publishOcrDraft(saved.revision)
          setConfiguration(mergeConfigPreservingRegions(configurationRef.current, result.draft))

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

          if (success?.notify) {
            const n = live?.length
            const liveNote =
              n == null
                ? null
                : n === 0
                  ? "No proof types visible on sign-up."
                  : `${n} proof type${n === 1 ? "" : "s"} visible on sign-up.`
            toast.success(success.title, {
              description: [success.description, liveNote]
                .filter(Boolean)
                .join(" "),
            })
          }
          return result
        } catch (reason) {
          const message =
            reason instanceof Error ? reason.message : String(reason)
          if (attempt === 0 && /revision|changed since/i.test(message)) {
            const latest = await getOcrDraft()
            // Re-apply the intended document list onto the fresh draft (honor removals).
            if (nextConfig) {
              const pendingKeys = new Set(
                nextConfig.document_types.map((doc) => doc.key)
              )
              const latestByKey = new Map(
                latest.document_types.map((doc) => [doc.key, doc])
              )
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
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Could not update sign-up settings."
      )
      return null
    } finally {
      setSaving(false)
    }
  }

  async function setProofAvailableOnSignup(docKey: string, enabled: boolean) {
    // Never let a proof go live on sign-up without its required sample photo(s).
    // Check the persisted samples only — local previews belong to the wizard's
    // selected document and may belong to a different proof on the list page.
    if (enabled) {
      const doc = configuration?.document_types.find(
        (item) => item.key === docKey
      )
      if (doc && !validateRequiredSamples(doc, { includeLocalPreview: false }))
        return
    }
    try {
      const latest = await getOcrDraft()
      const next: OcrConfiguration = {
        ...latest,
        document_types: latest.document_types.map((doc) =>
          doc.key === docKey ? { ...doc, enabled } : doc
        ),
      }
      // Preserve local field regions / unsaved edits when keys match.
      // Also append local-only document types that are not yet on the server.
      if (configuration) {
        const localByKey = new Map(
          configuration.document_types.map((doc) => [doc.key, doc])
        )
        next.document_types = next.document_types.map((doc) => {
          const local = localByKey.get(doc.key)
          if (!local) return doc
          return {
            ...local,
            id: doc.id,
            enabled: doc.key === docKey ? enabled : doc.enabled,
            // Prefer local name fields even when empty string (do not use ||).
            name:
              local.name !== undefined && local.name !== null
                ? local.name
                : doc.name,
            template_name:
              local.template_name !== undefined && local.template_name !== null
                ? local.template_name
                : doc.template_name,
            description:
              local.description !== undefined && local.description !== null
                ? local.description
                : doc.description,
            required_sides: local.required_sides?.length
              ? local.required_sides
              : doc.required_sides,
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
        { verifyKey: docKey, expectVisible: enabled, expectAbsent: !enabled }
      )
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Could not update availability."
      )
    }
  }

  async function persistWizardExit(): Promise<void> {
    // Cancel the pending debounced auto-save so its stale-config PATCH cannot
    // race with our final flush. Using configurationRef guarantees we send
    // whatever the user just typed, not the closure value from the render
    // where the Done button was mounted.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    const current = configurationRef.current
    if (!current) return
    setSaving(true)
    try {
      const saved = await saveOcrDraft(current)
      // Keep local state — user's rules/fields are the source of truth. Only
      // pull the fresh revision + any newly-assigned IDs for created rows so
      // the next PATCH does not 409 or duplicate. Do NOT overwrite the rules
      // array (that was the "Done reverts to default" bug — server state was
      // clobbering the just-toggled chips).
      configDirtyRef.current = false
      setConfiguration((state) => {
        if (!state) return saved
        return {
          ...state,
          revision: saved.revision,
          id: state.id ?? saved.id,
        }
      })

      const anyEnabled = saved.document_types.some(
        (doc) => doc.enabled !== false
      )
      const selectedFromSaved = selectedDocument
        ? saved.document_types.find((doc) => doc.key === selectedDocument.key)
        : undefined
      const selectedEnabled =
        (selectedFromSaved?.enabled ?? selectedDocument?.enabled) !== false &&
        Boolean(selectedDocument)
      if (anyEnabled || selectedEnabled) {
        // Publish the just-saved draft so sign-up sees the changes. We publish
        // the SAVED revision (which is what the server just accepted) rather
        // than pushing local state through saveAndPublish again — that helper
        // re-runs saveOcrDraft internally and its own state-merge would undo
        // the local rules we intentionally kept above.
        try {
          const result = await publishOcrDraft(saved.revision)
          setConfiguration((state) => {
            if (!state) return result.draft
            // Only bump revision to the new draft; keep local rules/fields.
            return { ...state, revision: result.draft.revision }
          })
        } catch (reason) {
          toast.error(
            reason instanceof Error
              ? reason.message
              : "Could not publish changes."
          )
        }
      }
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : "Could not save changes."
      )
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
    // Real content edits already mark the doc via updateSelectedDocument during
    // typing. Skip marking here so a focus-then-blur with no change cannot flip
    // a freshly added proof out of its blank-slate state.
    // Hidden proofs: draft-only to avoid thrashing publish. Live proofs: publish so sign-up updates.
    const target = next.document_types.find((doc) => doc.key === targetKey)
    if (target?.enabled === false) {
      setSaving(true)
      try {
        const saved = await saveOcrDraft(next)
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, saved))
      } catch (reason) {
        toast.error(
          reason instanceof Error
            ? reason.message
            : "Could not save proof details."
        )
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
              : sample
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
        samples: primary
          ? [{ ...primary, side: "single" as ProofSide, label: "Front" }]
          : [],
        sample_url: primary?.url ?? doc.sample_url ?? null,
        sample_original_filename:
          primary?.filename ?? doc.sample_original_filename ?? "",
      }
    }

    const next: OcrConfiguration = {
      ...configuration,
      document_types: configuration.document_types.map((doc) =>
        doc.key === selectedDocument.key ? updateDoc(doc) : doc
      ),
    }
    setConfiguration(next)
    markDocumentEdited(selectedDocument.key)

    if (wantBoth) {
      setSamplePreviewBySide((prev) => {
        if (prev.single && !prev.front) {
          const { single: _single, ...rest } = prev
          return { ...rest, front: prev.single }
        }
        return prev
      })
      setSamplePreviewSide((prev) =>
        prev === "single" || prev === "back" ? "front" : prev
      )
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

  function updateField(
    fieldKey: string,
    updater: (f: OcrFieldDefinition) => OcrFieldDefinition
  ) {
    updateSelectedDocument((doc) => ({
      ...doc,
      fields: doc.fields.map((field) => {
        if (field.key !== fieldKey) return field
        const next = updater(field)
        // Keep sides[] aligned whenever hints.side is present.
        const side = fieldCanvasSide(next)
        return {
          ...next,
          sides: [side],
          extraction_hints: { ...hintsOf(next), side },
        }
      }),
    }))
  }

  function updateFieldHints(fieldKey: string, patch: Partial<OcrFieldHints>) {
    updateField(fieldKey, (field) => ({
      ...field,
      extraction_hints: { ...hintsOf(field), ...patch },
    }))
  }

  function rulesForField(fieldKey: string): OcrRuleDefinition[] {
    return (selectedDocument?.rules ?? []).filter(
      (rule) => rule.field_key === fieldKey
    )
  }

  function fieldMatchProfiles(fieldKey: string): ProfileMatchKey[] {
    const keys: ProfileMatchKey[] = []
    for (const rule of rulesForField(fieldKey)) {
      if (
        rule.rule_type !== "profile_match" &&
        rule.operator !== "matches_profile"
      )
        continue
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
      (rule) =>
        rule.rule_type === "not_expired" || rule.operator === "not_expired"
    )
  }

  function setFieldValidationRules(
    fieldKey: string,
    next: {
      required: boolean
      matchProfiles: ProfileMatchKey[]
      notExpired: boolean
    }
  ) {
    if (!selectedDocument) return
    const otherRules = (selectedDocument.rules ?? []).filter(
      (rule) => rule.field_key !== fieldKey
    )
    const built: OcrRuleDefinition[] = []
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
        on_failure: "reject",
        order: built.length,
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
        threshold: null,
        enabled: true,
        on_failure: "reject",
        order: built.length,
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
        on_failure: "reject",
        order: built.length,
      })
    }
    const wantsDobMatch = next.matchProfiles.includes("date_of_birth")
    updateSelectedDocument((doc) => ({
      ...doc,
      fields: wantsDobMatch
        ? doc.fields.map((field) =>
            field.key === fieldKey && field.data_type !== "date"
              ? { ...field, data_type: "date" as const }
              : field
          )
        : doc.fields,
      rules: [...otherRules, ...built],
    }))
  }

  function setFieldRegion(fieldKey: string, region: FieldRegion) {
    updateFieldHints(fieldKey, { region: clampRegion(region) })
    if (regionSaveTimerRef.current) clearTimeout(regionSaveTimerRef.current)
    regionSaveTimerRef.current = setTimeout(async () => {
      const current = configurationRef.current
      if (!current) return
      try {
        const saved = await saveOcrDraft(current)
        setConfiguration((state) => {
          if (!state) return saved
          return { ...state, revision: saved.revision }
        })
        configDirtyRef.current = false
      } catch {
        configDirtyRef.current = true
      }
    }, 500)
  }

  function selectField(fieldKey: string) {
    setSelectedFieldKey(fieldKey)
    if (!selectedDocument) return
    const field = selectedDocument.fields.find((item) => item.key === fieldKey)
    if (!field) return
    if (!hintsOf(field).region) {
      const sorted = [...selectedDocument.fields].sort(
        (a, b) => a.order - b.order
      )
      const index = Math.max(
        0,
        sorted.findIndex((item) => item.key === fieldKey)
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
    origin: FieldRegion
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
    return [...(selectedDocument?.fields ?? [])].sort(
      (a, b) => a.order - b.order
    )
  }, [selectedDocument?.fields])

  const selectedFieldIndex = Math.max(
    0,
    sortedCanvasFields.findIndex((field) => field.key === selectedField?.key)
  )

  async function handleSampleUpload(
    file: File | null | undefined,
    side?: ProofSide
  ) {
    if (!file || !selectedDocument || !configuration) return
    const docKey = selectedDocument.key
    const uploadSide =
      side ?? sampleUploadSideRef.current ?? samplePreviewSide ?? "single"
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

      const uploaded = await uploadTemplateSample(
        savedDoc.key,
        file,
        uploadSide
      )
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
            : doc
        ),
      }
      try {
        const published = await publishOcrDraft(withSample.revision)
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, published.draft))
      } catch {
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, withSample))
      }
      markDocumentEdited(docKey)
      const localUrl = URL.createObjectURL(file)
      setSamplePreviewBySide((prev) => {
        const old = prev[uploadSide]
        if (old) URL.revokeObjectURL(old)
        return { ...prev, [uploadSide]: localUrl }
      })
      setSamplePreviewSide(uploadSide)
      setSamplePreviewUrl(localUrl)
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Sample upload failed."
      toast.error(
        /unknown document type/i.test(message)
          ? "Proof type is not saved yet. Try uploading the sample again."
          : message
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleSampleRemove(side: ProofSide) {
    if (!selectedDocument || !configuration) return
    const docKey = selectedDocument.key
    setSaving(true)
    try {
      const saved = await saveOcrDraft(configuration)
      const savedDoc = saved.document_types.find((doc) => doc.key === docKey)
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
            : doc
        ),
      }
      try {
        const published = await publishOcrDraft(withSample.revision)
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, published.draft))
      } catch {
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, withSample))
      }
      markDocumentEdited(docKey)
      setSamplePreviewBySide((prev) => {
        const next = { ...prev }
        if (next[side]) URL.revokeObjectURL(next[side]!)
        delete next[side]
        return next
      })
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : "Could not remove sample."
      )
    } finally {
      setSaving(false)
    }
  }

  function missingRequiredSampleSides(
    doc?: OcrDocumentType | null,
    opts?: { includeLocalPreview?: boolean }
  ): ProofSide[] {
    const target = doc ?? selectedDocument
    if (!target) return ["single"]
    // Local previews count for the wizard's selected document (a sample may
    // have just been uploaded), but must not mask a missing sample when the
    // check targets another proof, e.g. toggling availability on the list page.
    const includePreview = opts?.includeLocalPreview ?? true
    const sides = target.required_sides?.length
      ? target.required_sides
      : (["single"] as ProofSide[])
    const required: ProofSide[] =
      sides.includes("front") && sides.includes("back")
        ? ["front", "back"]
        : sides.includes("front")
          ? ["front"]
          : sides.includes("back")
            ? ["back"]
            : ["single"]

    return required.filter((side) => {
      if (includePreview && samplePreviewBySide[side]) return false
      // Treat single/front as interchangeable for front-only templates.
      if (
        includePreview &&
        side === "front" &&
        (samplePreviewBySide.single || samplePreviewBySide.front)
      ) {
        return false
      }
      if (
        includePreview &&
        side === "single" &&
        (samplePreviewBySide.single || samplePreviewBySide.front)
      ) {
        return false
      }
      const listed = (target.samples ?? []).some(
        (sample) => sample.side === side && Boolean(sample.url)
      )
      if (listed) return false
      if (
        (side === "front" || side === "single") &&
        (target.sample_url ||
          (target.samples ?? []).some(
            (sample) =>
              (sample.side === "front" || sample.side === "single") &&
              Boolean(sample.url)
          ))
      ) {
        return false
      }
      return true
    })
  }

  function validateRequiredSamples(
    doc?: OcrDocumentType | null,
    opts?: { includeLocalPreview?: boolean }
  ): boolean {
    const missing = missingRequiredSampleSides(doc, opts)
    if (missing.length === 0) return true
    const labels = missing.map((side) => sideLabel(side)).join(" and ")
    toast.error(`Upload the ${labels} sample photo first.`, {
      description:
        missing.length > 1
          ? "This proof needs both sides before you continue."
          : "Add a clear sample so you can mark areas and test reading.",
    })
    return false
  }

  /** Mark-areas sample matching a side (single/front interchangeable), persisted or local preview. */
  function sampleMatchForSide(
    side: ProofSide
  ): { url: string; filename: string } | null {
    if (!selectedDocument) return null
    // Prefer the already-downloaded preview blob so each test run reuses the
    // in-memory image instead of re-fetching the sample URL from the server.
    const previewUrl =
      samplePreviewBySide[side] ??
      (side === "front" ? samplePreviewBySide.single : undefined) ??
      (side === "single"
        ? (samplePreviewBySide.front ?? samplePreviewBySide.back)
        : undefined)
    if (previewUrl) {
      const samples = selectedDocument.samples ?? []
      const listed =
        samples.find((sample) => sample.side === side && sample.url) ??
        (side === "front"
          ? samples.find((sample) => sample.side === "single" && sample.url)
          : undefined) ??
        (side === "single"
          ? samples.find((sample) => sample.side === "front" && sample.url)
          : undefined)
      return {
        url: previewUrl,
        filename:
          listed?.filename ||
          selectedDocument.sample_original_filename ||
          "sample.jpg",
      }
    }
    const samples = selectedDocument.samples ?? []
    const listed =
      samples.find((sample) => sample.side === side && sample.url) ??
      (side === "front"
        ? samples.find((sample) => sample.side === "single" && sample.url)
        : undefined) ??
      (side === "single"
        ? samples.find((sample) => sample.side === "front" && sample.url)
        : undefined)
    if (listed)
      return { url: listed.url, filename: listed.filename || "sample.jpg" }
    if (
      (side === "front" || side === "single") &&
      selectedDocument.sample_url
    ) {
      return {
        url: selectedDocument.sample_url,
        filename: selectedDocument.sample_original_filename || "sample.jpg",
      }
    }
    // Just-uploaded Mark-areas samples may only exist as local previews yet.
    const localPreview =
      samplePreviewBySide[side] ??
      (side === "front" ? samplePreviewBySide.single : undefined) ??
      (side === "single" ? samplePreviewBySide.front : undefined)
    if (localPreview) return { url: localPreview, filename: "sample.jpg" }
    return null
  }

  /** Turn a sample match into a File, handling both protected server URLs and local object URLs. */
  async function fileForSampleMatch(match: {
    url: string
    filename: string
  }): Promise<File | null> {
    try {
      let blob: Blob
      if (match.url.startsWith("blob:")) {
        const response = await fetch(match.url)
        if (!response.ok) return null
        blob = await response.blob()
      } else {
        blob = await fetchTemplateSampleBlob(match.url)
      }
      return new File([blob], match.filename, {
        type: blob.type || "image/jpeg",
      })
    } catch {
      return null
    }
  }

  function invalidateSideResult(side: ProofSide) {
    setTestResultsBySide((prev) => {
      if (!prev[side]) return prev
      const next = { ...prev }
      delete next[side]
      return next
    })
  }

  function uploadTestSlot(side: ProofSide, file: File) {
    const url = URL.createObjectURL(file)
    setTestSlots((prev) => {
      if (prev[side]) URL.revokeObjectURL(prev[side]!.url)
      return { ...prev, [side]: { file, url } }
    })
    // A new photo invalidates the previous result for this side.
    invalidateSideResult(side)
  }

  function clearTestSlot(side: ProofSide) {
    setTestSlots((prev) => {
      if (!prev[side]) return prev
      const next = { ...prev }
      URL.revokeObjectURL(next[side]!.url)
      delete next[side]
      return next
    })
    invalidateSideResult(side)
  }

  function setTestProfileField(key: ProfileMatchKey, value: string) {
    setTestProfile((prev) => {
      if (!value.trim()) {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }

  /** The file to test for a side: an uploaded slot, else the sample (fetched lazily). */
  async function resolveTestContent(side: ProofSide): Promise<File | null> {
    const slot = testSlots[side]
    if (slot) return slot.file
    const match = sampleMatchForSide(side)
    if (!match) return null
    return fileForSampleMatch(match)
  }

  /** Run one side's OCR test, poll until done, store the per-side result, auto-fill missing regions. */
  async function runSingleSideTest(
    file: File,
    side: ProofSide
  ): Promise<OcrTestResult | null> {
    if (!selectedDocument) return null
    try {
      let result = await runOcrTest(
        file,
        selectedDocument.key,
        side,
        testProfile
      )
      result = { ...result, test_side: side }
      setTestResultsBySide((prev) => ({ ...prev, [side]: result }))
      if (result.status === "queued" || result.status === "processing") {
        for (let attempt = 0; attempt < 15; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000))
          const latest = (await listOcrTests()).find(
            (item) => item.id === result.id
          )
          if (!latest) continue
          const normalized = {
            ...latest,
            extracted_fields: normalizeExtractedFields(latest.extracted_fields),
            confidence: latest.confidence ?? latest.overall_confidence ?? null,
            overall_confidence:
              latest.overall_confidence ?? latest.confidence ?? null,
            test_side: side,
          }
          setTestResultsBySide((prev) => ({ ...prev, [side]: normalized }))
          result = normalized
          if (latest.status !== "queued" && latest.status !== "processing")
            break
        }
      }
      // Only auto-fill regions that are still missing — never overwrite user-drawn boxes.
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
            extraction_hints: {
              ...hintsOf(field),
              region: defaults[index] ?? defaults[0],
            },
          }
        }),
      }))
      return result
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : "Could not read the photo."
      )
      return null
    }
  }

  /** Run every required side in order, merging each result into the per-side map. */
  async function runTestAll() {
    // Claim the guard up front so a double-click cannot start two runs while
    // the async content resolution below is still fetching sample blobs.
    if (testRunningRef.current) return
    if (!selectedDocument) {
      toast.error("Select a proof type first.")
      return
    }
    testRunningRef.current = true
    setTestRunning(true)
    try {
      const sides: ProofSide[] = canvasSides.length ? canvasSides : ["single"]
      const files = new Map<ProofSide, File>()
      for (const side of sides) {
        const file = await resolveTestContent(side)
        if (!file) {
          if (sampleMatchForSide(side)) {
            toast.error("Could not load the sample photo.")
          } else {
            toast.error(`Upload the ${sideLabel(side)} sample first.`, {
              description:
                sides.length > 1
                  ? "Add a clear photo so you can test both sides."
                  : "Add a clear photo so you can test reading.",
            })
          }
          return
        }
        files.set(side, file)
      }

      if (configuration && configDirtyRef.current) {
        const saved = await saveOcrDraft(configuration)
        setConfiguration(mergeConfigPreservingRegions(configurationRef.current, saved))
        configDirtyRef.current = false
      }
      for (const side of sides) {
        setRunningTestKey(`test:${side}`)
        const result = await runSingleSideTest(files.get(side)!, side)
        if (!result) break // error already toasted — stop the sequence
      }
    } finally {
      testRunningRef.current = false
      setTestRunning(false)
      setRunningTestKey(null)
    }
  }

  /** Clear every test photo and its results (e.g. when switching proof types). */
  function resetTests() {
    setTestSlots((prev) => {
      Object.values(prev).forEach((slot) => {
        if (slot?.url) URL.revokeObjectURL(slot.url)
      })
      return {}
    })
    setTestResultsBySide({})
  }

  function addField() {
    if (!selectedDocument) return
    const sideForField: "front" | "back" =
      samplePreviewSide === "back" ? "back" : "front"
    const sideFields = selectedDocument.fields.filter(
      (f) => fieldCanvasSide(f) === sideForField
    )
    const existingKeys = selectedDocument.fields.map((f) => f.key)
    const next = withFieldSide(
      createField(
        selectedDocument.fields.length,
        sideForField,
        existingKeys,
        "New information"
      ),
      sideForField
    )
    next.extraction_hints = {
      ...hintsOf(next),
      side: sideForField,
      region: defaultRegionForIndex(sideFields.length, sideFields.length + 1),
    }
    next.sides = [sideForField]
    updateSelectedDocument((doc) => ({ ...doc, fields: [...doc.fields, next] }))
    setSelectedFieldKey(next.key)
  }

  /**
   * Rename a field label and, when the key is still auto-generated, refresh it
   * to a readable slug (e.g. "Digital Number" → digital_number). Rules stay linked.
   */
  function renameField(fieldKey: string, label: string) {
    if (!selectedDocument) return
    const nextLabel = label.trim()
    if (!nextLabel) return
    const target = selectedDocument.fields.find((f) => f.key === fieldKey)
    if (!target) return

    const shouldReslug =
      isAutoFieldKey(target.key) || target.label === "New information"
    const nextKey = shouldReslug
      ? slugifyFieldKey(
          nextLabel,
          selectedDocument.fields.map((f) => f.key),
          { excludeKey: fieldKey }
        )
      : target.key

    updateSelectedDocument((doc) => ({
      ...doc,
      fields: doc.fields.map((field) =>
        field.key === fieldKey
          ? {
              ...field,
              key: nextKey,
              label: nextLabel,
            }
          : field
      ),
      rules: (doc.rules ?? []).map((rule) =>
        rule.field_key === fieldKey ? { ...rule, field_key: nextKey } : rule
      ),
    }))
    if (selectedFieldKey === fieldKey) setSelectedFieldKey(nextKey)
  }

  function removeField(key: string) {
    if (!selectedDocument) return
    if (!window.confirm("Remove this information field from the proof type?"))
      return
    const nextFields = selectedDocument.fields.filter(
      (field) => field.key !== key
    )
    updateSelectedDocument((doc) => ({ ...doc, fields: nextFields }))
    if (selectedFieldKey === key) setSelectedFieldKey(nextFields[0]?.key ?? "")
  }

  async function addDocumentType() {
    if (!configuration) return
    const next = createDocumentType(
      configuration.document_types.length,
      configuration.document_types.map((doc) => doc.key)
    )
    const optimistic: OcrConfiguration = {
      ...configuration,
      document_types: [...configuration.document_types, next],
    }
    setConfiguration(optimistic)
    setSelectedDocKey(next.key)
    setSelectedFieldKey(next.fields[0]?.key ?? "")
    resetTests()
    setSamplePreviewUrl(null)
    markDocumentAdded(next.key)
    toast.success("Proof type added")
    try {
      const saved = await saveOcrDraft(optimistic)
      setConfiguration(mergeConfigPreservingRegions(configurationRef.current, saved))
      const savedDoc =
        saved.document_types.find((doc) => doc.key === next.key) ??
        saved.document_types[saved.document_types.length - 1]
      if (savedDoc) {
        setSelectedDocKey(savedDoc.key)
        setSelectedFieldKey(savedDoc.fields[0]?.key ?? "")
      }
    } catch (reason) {
      toast.error(
        reason instanceof Error
          ? reason.message
          : "Could not save the new proof type."
      )
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
      const localOnly = configuration.document_types.filter(
        (doc) => !workingKeys.has(doc.key)
      )
      if (localOnly.length > 0) {
        working = {
          ...working,
          document_types: [...working.document_types, ...localOnly],
        }
      }
    }

    const target =
      working.document_types.find((doc) => doc.key === docKey) ??
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
    forgetDocument(docKey)
    const fallback = nextTypes[0]
    setSelectedDocKey(fallback?.key ?? "")
    setSelectedFieldKey(fallback?.fields[0]?.key ?? "")
    resetTests()

    const result = await saveAndPublish(
      next,
      {
        title: `“${target?.name || docKey}” removed`,
        notify: true,
      },
      { verifyKey: docKey, expectAbsent: true }
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
    const target = selectedDocument.fields.find((f) => f.key === key)
    if (!target) return
    const side = fieldCanvasSide(target)
    // Reorder only within the same side so Front/Back lists stay independent
    const sameSide = selectedDocument.fields
      .filter((f) => fieldCanvasSide(f) === side)
      .sort((a, b) => a.order - b.order)
    const index = sameSide.findIndex((field) => field.key === key)
    const swap = index + direction
    if (index < 0 || swap < 0 || swap >= sameSide.length) return
    const nextSide = [...sameSide]
    const [item] = nextSide.splice(index, 1)
    nextSide.splice(swap, 0, item)
    const orderMap = new Map(nextSide.map((f, i) => [f.key, i]))
    // Keep other-side fields' relative orders; renumber this side
    const other = selectedDocument.fields
      .filter((f) => fieldCanvasSide(f) !== side)
      .sort((a, b) => a.order - b.order)
    const merged =
      side === "front" ? [...nextSide, ...other] : [...other, ...nextSide]
    updateSelectedDocument((doc) => ({
      ...doc,
      fields: merged.map((field, i) => ({
        ...field,
        order: orderMap.has(field.key) ? orderMap.get(field.key)! : i + 100,
      })),
    }))
  }

  /**
   * Drag-and-drop reorder, including moving a field between Front and Back lists.
   * `targetSide` is the list the row was dropped on; `toIndex` is the insert index in that list.
   */
  function reorderField(
    key: string,
    toIndex: number,
    targetSide?: "front" | "back"
  ) {
    if (!selectedDocument) return
    const target = selectedDocument.fields.find((f) => f.key === key)
    if (!target) return
    const fromSide = fieldCanvasSide(target)
    const side = targetSide ?? fromSide

    const destination = selectedDocument.fields
      .filter((f) => fieldCanvasSide(f) === side && f.key !== key)
      .sort((a, b) => a.order - b.order)

    const moved = withFieldSide(target, side)
    const insertAt = Math.max(0, Math.min(toIndex, destination.length))
    const nextDest = [...destination]
    nextDest.splice(insertAt, 0, moved)

    const otherSide: "front" | "back" = side === "front" ? "back" : "front"
    const other = selectedDocument.fields
      .filter((f) => fieldCanvasSide(f) === otherSide && f.key !== key)
      .sort((a, b) => a.order - b.order)

    const frontList = side === "front" ? nextDest : other
    const backList = side === "back" ? nextDest : other

    updateSelectedDocument((doc) => ({
      ...doc,
      fields: [
        ...frontList.map((field, index) => ({
          ...withFieldSide(field, "front"),
          order: index,
        })),
        ...backList.map((field, index) => ({
          ...withFieldSide(field, "back"),
          order: index,
        })),
      ],
    }))

    if (side !== fromSide) {
      setSamplePreviewSide(side)
      setSelectedFieldKey(key)
    }
  }

  // Mark-areas canvas must show the sample template, never the try-sample test photo.
  const canvasSource = samplePreviewUrl
  const selectedDetected = selectedField
    ? extractedByKey.get(selectedField.key)
    : null

  // Verdict + failures across every tested side's rule results.
  // Same rule can run on front AND back; a synthetic template_check row can
  // also mirror a field-level failure. Both count as one to the resident, so
  // the pill and bullet list should count once too.
  const mergedTestResult = useMemo<MergedTestResult>(() => {
    const ruleResults: VerificationRuleResult[] = []
    for (const result of Object.values(testResultsBySide)) {
      if (!result) continue
      for (const rule of result.rule_results ?? []) ruleResults.push(rule)
    }
    const dedupedFailedByKey = new Map<string, VerificationRuleResult>()
    for (const rule of ruleResults) {
      if (rule.passed !== false) continue
      // Group by (code|field). When code is absent, fall back to the message.
      const key = `${rule.code ?? ""}|${rule.field ?? ""}|${!rule.code && !rule.field ? rule.detail ?? rule.message ?? rule.name ?? "" : ""}`
      const existing = dedupedFailedByKey.get(key)
      // Prefer the worst severity when the same rule differs across sides.
      if (
        !existing ||
        (existing.on_failure !== "reject" &&
          rule.on_failure === "reject")
      ) {
        dedupedFailedByKey.set(key, rule)
      }
    }
    const failedRules = Array.from(dedupedFailedByKey.values())
    let hasBlock = false
    let hasWarning = false
    for (const rule of failedRules) {
      if (rule.on_failure === "reject") hasBlock = true
      else hasWarning = true
    }
    const tested = Object.values(testResultsBySide).some(Boolean)
    const verdict: MergedTestVerdict = !tested
      ? "idle"
      : hasBlock
        ? "block"
        : hasWarning
          ? "warning"
          : "pass"
    return {
      bySide: testResultsBySide,
      verdict,
      allRules: ruleResults,
      failedRules,
      tested,
    }
  }, [testResultsBySide])
  const activeTypeCount =
    configuration?.document_types.filter((doc) => doc.enabled !== false)
      .length ?? 0
  const fieldCount = selectedDocument?.fields.length ?? 0
  const sampleCount = Object.values(samplePreviewBySide).filter(Boolean).length

  return {
    // core state
    configuration,
    setConfiguration,
    loading,
    saving,
    autoSaveState,
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
    editedDocKeys,
    addedDocKeys,
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
    renameField,
    moveField,
    reorderField,
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
    testSlots,
    testResultsBySide,
    mergedTestResult,
    testRunning,
    runningTestKey,
    runTestAll,
    uploadTestSlot,
    clearTestSlot,
    sampleMatchForSide,
    resetTests,
    testProfile,
    setTestProfileField,
    relevantProfileKeys,
    missingRequiredSampleSides,
    validateRequiredSamples,
    selectedDetected,

    // derived
    activeTypeCount,
    fieldCount,
    sampleCount,
  }
}
