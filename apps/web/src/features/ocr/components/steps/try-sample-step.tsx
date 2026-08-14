import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Expand,
  ImagePlus,
  Info,
  LoaderCircle,
  Play,
  X,
  XCircle,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import {
  normalizeExtractedFields,
  type OcrDocumentType,
  type OcrTestField,
  type ProofSide,
  type SimulatedProfile,
  type SimulatedProfileKey,
  type VerificationRuleResult,
} from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import type {
  MergedTestResult,
  ProfileMatchKey,
  TestSlot,
} from "@/features/ocr/hooks/use-ocr-template-state"
import {
  FIELD_COLORS,
  fieldDisplayColor,
  fieldDisplayNumber,
} from "@/features/ocr/lib/create-document-defaults"

const PROFILE_FIELD_LABELS: Partial<Record<SimulatedProfileKey, string>> = {
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
  gender: "Gender",
}

const PROFILE_FIELD_PLACEHOLDERS: Partial<Record<SimulatedProfileKey, string>> =
  {
    first_name: "e.g. Juan",
    middle_name: "e.g. Dela Cruz",
    last_name: "e.g. Santos",
    date_of_birth: "e.g. 07/24/2004",
    gender: "e.g. Male",
  }

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Front"
}

function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return ""
  return `${match[2]}/${match[3]}/${match[1]}`
}

function parseDobInput(text: string): { iso: string | null; error: string } {
  const raw = text.trim()
  if (!raw) return { iso: "", error: "" }
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  if (!match) return { iso: null, error: "Use MM/DD/YYYY." }
  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
  if (month < 1 || month > 12) return { iso: null, error: "Month is 1 to 12." }
  if (day < 1 || day > 31) return { iso: null, error: "Day is 1 to 31." }
  if (year < 1900) return { iso: null, error: "Year must be 1900 or later." }
  const parsed = new Date(year, month - 1, day)
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return { iso: null, error: "That date does not exist." }
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (parsed.getTime() > today.getTime()) {
    return { iso: null, error: "Date of birth cannot be in the future." }
  }
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  return { iso, error: "" }
}

function ImageLightbox({
  url,
  filename,
  onClose,
}: {
  url: string
  filename: string
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Photo preview"
    >
      <div
        className="flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={url}
          alt={filename}
          className="max-h-[78vh] max-w-[85vw] rounded-lg object-contain"
        />
        <div className="flex items-center gap-3">
          <a
            href={url}
            download={filename}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <Download className="size-4" />
            Download
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
          >
            <X className="size-4" />
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function withoutLeadingThe(message: string): string {
  return message.replace(/^The\s+/i, "")
}

type FieldCheck = {
  kind: "none" | "not_tested" | "pass" | "fail"
  severity: "block" | "warning" | null
  messages: string[]
  checkNames: string[]
}

export function TrySampleStep(props: {
  testRunning: boolean
  runningTestKey?: string | null
  testSlots: Partial<Record<ProofSide, TestSlot>>
  mergedTestResult: MergedTestResult
  documentFields?: OcrDocumentType["fields"]
  canvasSides: ProofSide[]
  sampleMatchForSide: (
    side: ProofSide
  ) => { url: string; filename: string } | null
  testProfile: SimulatedProfile
  relevantProfileKeys: ProfileMatchKey[]
  onTestProfileChange: (key: ProfileMatchKey, value: string) => void
  onUploadSlot: (side: ProofSide, file: File) => void
  onClearSlot: (side: ProofSide) => void
  onRunTestAll: () => void
}) {
  const {
    testRunning,
    runningTestKey = null,
    testSlots,
    mergedTestResult,
    documentFields = [],
    canvasSides,
    sampleMatchForSide,
    testProfile,
    relevantProfileKeys,
    onTestProfileChange,
    onUploadSlot,
    onClearSlot,
    onRunTestAll,
  } = props

  const profileKeys = useMemo(
    () => relevantProfileKeys.filter((key) => key !== "address"),
    [relevantProfileKeys]
  )

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingSideRef = useRef<ProofSide>("front")
  const [lightbox, setLightbox] = useState<{
    url: string
    filename: string
  } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const [dobText, setDobText] = useState<string>(() =>
    isoToDisplay(testProfile.date_of_birth ?? "")
  )
  const [dobError, setDobError] = useState<string>("")

  // Keep the date field synced to the sample profile but don't clobber a value
  // that already parses to it — render-adjust instead of a sync setState effect.
  const dobIso = testProfile.date_of_birth ?? ""
  const [prevDobIso, setPrevDobIso] = useState(dobIso)
  if (prevDobIso !== dobIso) {
    setPrevDobIso(dobIso)
    setDobText((current) => {
      const parsed = parseDobInput(current)
      if (parsed.iso === dobIso) return current
      return isoToDisplay(dobIso)
    })
  }

  const requiredSides: ProofSide[] = useMemo(
    () => (canvasSides.length ? canvasSides : ["single"]),
    [canvasSides]
  )
  const multiSide = requiredSides.length >= 2
  const { bySide, tested } = mergedTestResult

  const runningSide = useMemo(() => {
    if (!runningTestKey?.startsWith("test:")) return null
    return runningTestKey.slice(5) as ProofSide
  }, [runningTestKey])

  const runningIndex = runningSide ? requiredSides.indexOf(runningSide) : -1
  const runningLabel =
    testRunning && runningSide && runningIndex >= 0
      ? multiSide
        ? `Testing ${sideLabel(runningSide).toLowerCase()} (${runningIndex + 1} of ${requiredSides.length})`
        : "Testing"
      : null

  function contentReady(side: ProofSide): boolean {
    return Boolean(testSlots[side] || sampleMatchForSide(side))
  }

  const missingLabels = requiredSides
    .filter((side) => !contentReady(side))
    .map((side) => sideLabel(side).toLowerCase())
  const allReady = missingLabels.length === 0
  const testDisabled = testRunning || !allReady || Boolean(dobError)

  function pickFor(side: ProofSide) {
    pendingSideRef.current = side
    fileInputRef.current?.click()
  }

  function handleDobChange(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 8)
    let formatted = digits
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    }
    setDobText(formatted)
    const parsed = parseDobInput(formatted)
    setDobError(parsed.error)
    if (parsed.iso !== null) {
      onTestProfileChange("date_of_birth", parsed.iso)
    }
  }

  function sideExtracted(side: ProofSide): OcrTestField[] {
    const result = bySide[side]
    if (!result) return []
    const order = new Map(
      documentFields.map((field, index) => [field.key, index])
    )
    return normalizeExtractedFields(result.extracted_fields).sort(
      (a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999)
    )
  }

  // Match rule.field to a document field using multiple signals so a rule
  // whose backend `field` FK drifted from the extracted field's code still
  // shows up (e.g. Barangay ID's DOB field that migrations couldn't rename
  // without breaking IDs). Order: exact code match → profile+data_type match
  // → profile+label token match. Returns the field key to bucket under.
  function resolveRuleFieldKey(rule: VerificationRuleResult): string | null {
    const ruleField = rule.field ?? null
    if (ruleField && documentFields.some((f) => f.key === ruleField)) {
      return ruleField
    }
    const profile = (rule.profile ?? "").toLowerCase()
    if (!profile) return ruleField
    const PROFILE_TOKENS: Record<string, string[]> = {
      date_of_birth: ["date_of_birth", "birth_date", "birthdate", "dob", "birth"],
      first_name: ["first_name", "given_name", "firstname"],
      middle_name: ["middle_name", "middlename"],
      last_name: ["last_name", "surname", "family_name", "lastname"],
      gender: ["gender", "sex"],
      address: ["address", "residence"],
    }
    const tokens = PROFILE_TOKENS[profile] ?? [profile]
    const dataTypeHint = profile === "date_of_birth" ? "date" : null
    const matched = documentFields.find((field) => {
      const key = String(field.key ?? "").toLowerCase()
      const label = String(field.label ?? "").toLowerCase()
      if (dataTypeHint && field.data_type === dataTypeHint) return true
      return tokens.some((token) => key.includes(token) || label.includes(token))
    })
    return matched?.key ?? ruleField
  }

  const rulesByFieldSide = useMemo(() => {
    const perSide: Partial<
      Record<ProofSide, Map<string, VerificationRuleResult[]>>
    > = {}
    for (const side of requiredSides) {
      const map = new Map<string, VerificationRuleResult[]>()
      for (const rule of bySide[side]?.rule_results ?? []) {
        const bucketKey = resolveRuleFieldKey(rule)
        if (!bucketKey) continue
        const list = map.get(bucketKey) ?? []
        list.push(rule)
        map.set(bucketKey, list)
      }
      perSide[side] = map
    }
    return perSide
    // eslint-disable-next-line react-hooks/exhaustive-deps -- documentFields is stable per render
  }, [bySide, requiredSides, documentFields])

  function fieldCheck(
    side: ProofSide,
    fieldKey: string,
    hasValue: boolean,
    isRequired: boolean
  ): FieldCheck {
    const checks = rulesByFieldSide[side]?.get(fieldKey) ?? []
    const failed = checks.filter((rule) => rule.passed === false)
    if (failed.length > 0) {
      return {
        kind: "fail",
        severity: failed.some((rule) => rule.on_failure === "reject")
          ? "block"
          : "warning",
        messages: [
          ...new Set(
            failed
              .map((rule) =>
                withoutLeadingThe(
                  rule.detail || rule.message || rule.name || rule.code || ""
                )
              )
              .filter(Boolean)
          ),
        ],
        checkNames: [],
      }
    }
    const runPassed = checks.filter((rule) => rule.passed === true)
    if (runPassed.length > 0) {
      return {
        kind: "pass",
        severity: null,
        messages: [],
        checkNames: runPassed
          .map((rule) => rule.name || rule.label || rule.code || "check")
          .filter(Boolean),
      }
    }
    if (!hasValue) {
      if (isRequired) {
        return {
          kind: "fail",
          severity: "block",
          messages: ["Not read from this photo."],
          checkNames: [],
        }
      }
      return { kind: "none", severity: null, messages: [], checkNames: [] }
    }
    // A value was read but no rule actually verified it (no applicable rule,
    // or every applicable rule was left untested). Honest outcome is "not
    // tested", never a green "Passed".
    if (checks.length === 0) {
      return {
        kind: "not_tested",
        severity: null,
        messages: ["No rule configured."],
        checkNames: [],
      }
    }
    if (checks.every((rule) => rule.passed == null)) {
      // Prefer the rule's own detail (backend explains what's missing, e.g.
      // "Not tested. Fill the resident details form to check this.").
      const explanations = [
        ...new Set(
          checks
            .map((rule) =>
              withoutLeadingThe(rule.detail || rule.message || "")
            )
            .filter(Boolean)
        ),
      ]
      return {
        kind: "not_tested",
        severity: null,
        messages: explanations.length
          ? explanations
          : ["Fill the Resident details form to run this check."],
        checkNames: [],
      }
    }
    return { kind: "none", severity: null, messages: [], checkNames: [] }
  }

  const anyProfileValue = profileKeys.some((key) =>
    Boolean((testProfile[key] ?? "").trim())
  )

  return (
    <section className="p-1">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) onUploadSlot(pendingSideRef.current, file)
          }}
        />

        <Button
          type="button"
          onClick={() => onRunTestAll()}
          disabled={testDisabled}
          className={cn(
            "h-11 w-full gap-2 rounded-xl font-semibold text-white",
            PROOF_THEME.primaryBg
          )}
        >
          {testRunning ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {testRunning ? (runningLabel ?? "Testing") : "Test sample"}
        </Button>

        {profileKeys.length > 0 ? (
          <div className="mt-4 rounded-xl border border-line-tint bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p
                className={cn("text-xs font-semibold", PROOF_THEME.title)}
              >
                Resident details for this test
              </p>
              {anyProfileValue ? (
                <button
                  type="button"
                  onClick={() => {
                    for (const key of profileKeys)
                      onTestProfileChange(key, "")
                    setDobText("")
                    setDobError("")
                  }}
                  disabled={testRunning}
                  className="text-[11px] font-semibold text-brand-blue transition hover:underline disabled:opacity-50"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {profileKeys.map((key) => {
                const label = PROFILE_FIELD_LABELS[key] ?? key
                const value = testProfile[key] ?? ""
                if (key === "gender") {
                  return (
                    <label key={key} className="block">
                      <span
                        className={cn(
                          "mb-1 block text-[11px] font-semibold",
                          PROOF_THEME.muted
                        )}
                      >
                        {label}
                      </span>
                      <select
                        value={value}
                        onChange={(event) =>
                          onTestProfileChange(key, event.target.value)
                        }
                        disabled={testRunning}
                        className="h-9 w-full rounded-lg border border-line-tint bg-white px-2.5 text-xs font-medium text-brand-navy transition outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                      >
                        <option value="">Not entered</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="prefer_not_to_say">
                          Prefer not to say
                        </option>
                      </select>
                    </label>
                  )
                }
                if (key === "date_of_birth") {
                  return (
                    <label key={key} className="block">
                      <span
                        className={cn(
                          "mb-1 block text-[11px] font-semibold",
                          PROOF_THEME.muted
                        )}
                      >
                        {label}
                      </span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={dobText}
                        onChange={(event) =>
                          handleDobChange(event.target.value)
                        }
                        placeholder={PROFILE_FIELD_PLACEHOLDERS.date_of_birth ?? "MM/DD/YYYY"}
                        maxLength={10}
                        disabled={testRunning}
                        aria-invalid={Boolean(dobError)}
                        className={cn(
                          "h-9 rounded-lg border bg-white text-xs font-medium text-brand-navy disabled:opacity-50",
                          dobError
                            ? "border-rose-400 focus:border-rose-500"
                            : "border-line-tint"
                        )}
                      />
                      {dobError ? (
                        <span className="mt-1 block text-[11px] font-medium text-rose-600">
                          {dobError}
                        </span>
                      ) : null}
                    </label>
                  )
                }
                return (
                  <label key={key} className="block">
                    <span
                      className={cn(
                        "mb-1 block text-[11px] font-semibold",
                        PROOF_THEME.muted
                      )}
                    >
                      {label}
                    </span>
                    <Input
                      type="text"
                      value={value}
                      onChange={(event) =>
                        onTestProfileChange(key, event.target.value)
                      }
                      placeholder={PROFILE_FIELD_PLACEHOLDERS[key] ?? ""}
                      disabled={testRunning}
                      className="h-9 rounded-lg border border-line-tint bg-white text-xs font-medium text-brand-navy disabled:opacity-50"
                    />
                  </label>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-3">
          <button
            type="button"
            onClick={() => setUploadOpen((value) => !value)}
            aria-expanded={uploadOpen}
            className="mx-auto flex items-center gap-1.5 text-xs font-semibold text-brand-blue transition"
          >
            {uploadOpen ? (
              <>
                <X className="size-3.5" />
                Hide upload
              </>
            ) : (
              <>
                or{" "}
                <span className="underline-offset-2 hover:underline">
                  upload a different photo
                </span>
              </>
            )}
          </button>

          {uploadOpen ? (
            <div className="mt-3 space-y-3">
              {requiredSides.map((side) => {
                const slot = testSlots[side]
                const isRunning = runningSide === side
                const sideName = sideLabel(side).toLowerCase()
                return (
                  <div
                    key={side}
                    className={cn(
                      "flex items-center gap-3",
                      isRunning && "rounded-lg bg-tint/60 px-2 py-1.5"
                    )}
                  >
                    <span
                      className={cn(
                        "w-14 shrink-0 text-[11px] font-semibold uppercase",
                        PROOF_THEME.muted
                      )}
                    >
                      {sideLabel(side)}
                    </span>

                    {slot ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setLightbox({
                              url: slot.url,
                              filename: slot.file.name,
                            })
                          }
                          className="group relative shrink-0 overflow-hidden rounded-lg border border-line-tint"
                          aria-label="Preview test photo"
                        >
                          <img
                            src={slot.url}
                            alt={slot.file.name}
                            className="h-12 w-[4.5rem] bg-white object-contain transition group-hover:opacity-80"
                          />
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
                            <Expand className="size-3.5" />
                          </span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "truncate text-xs font-semibold",
                              PROOF_THEME.title
                            )}
                          >
                            {slot.file.name}
                          </p>
                          <p
                            className={cn(
                              "text-[11px] font-medium",
                              PROOF_THEME.muted
                            )}
                          >
                            {Math.max(1, Math.round(slot.file.size / 1024))} kB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => pickFor(side)}
                          disabled={testRunning}
                          className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-brand-blue transition hover:bg-tint disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => onClearSlot(side)}
                          disabled={testRunning}
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                          aria-label="Remove test photo"
                        >
                          <X className="size-4" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => pickFor(side)}
                        disabled={testRunning}
                        className="inline-flex items-center gap-2 rounded-lg border border-dashed border-line-tint bg-white px-3 py-2 text-xs font-semibold text-navy-muted transition hover:border-brand-blue hover:bg-tint disabled:opacity-50"
                      >
                        <ImagePlus className="size-4 text-brand-blue" />
                        Upload {sideName} photo
                      </button>
                    )}
                  </div>
                )
              })}
              <p className={cn("text-[11px] font-medium", PROOF_THEME.muted)}>
                JPG or PNG, up to 10 MB.
              </p>
            </div>
          ) : null}
        </div>

        {tested ? (
          <div className="mt-5 border-t border-line-tint pt-4">
            <div>
              <p
                className={cn("mb-2 text-xs font-semibold", PROOF_THEME.title)}
              >
                What was found
              </p>
              <div className="space-y-4">
                {requiredSides.map((side) => {
                  const fields = sideExtracted(side)
                  return (
                    <section
                      key={side}
                      className="overflow-hidden rounded-xl border border-line-tint"
                    >
                      {multiSide ? (
                        <p
                          className={cn(
                            "border-b border-line-tint bg-tint px-3 py-2 text-[11px] font-semibold uppercase",
                            PROOF_THEME.muted
                          )}
                        >
                          {sideLabel(side)}
                        </p>
                      ) : null}
                      {bySide[side] ? (
                        fields.length === 0 ? (
                          <p
                            className={cn(
                              "px-3 py-6 text-center text-xs font-medium italic",
                              PROOF_THEME.muted
                            )}
                          >
                            Nothing was read from this photo.
                          </p>
                        ) : (
                          <table className="w-full table-fixed text-left text-sm">
                            <colgroup>
                              <col className="w-[28%]" />
                              <col className="w-[47%]" />
                              <col className="w-[25%]" />
                            </colgroup>
                            <thead
                              className={cn(
                                "bg-tint text-xs font-semibold",
                                PROOF_THEME.muted
                              )}
                            >
                              <tr>
                                <th className="px-3 py-2.5">Information</th>
                                <th className="px-3 py-2.5">Value found</th>
                                <th className="px-3 py-2.5">Result</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fields.map((field) => {
                                const def = documentFields.find(
                                  (item) => item.key === field.key
                                )
                                const displayNumber = def
                                  ? fieldDisplayNumber(def, documentFields)
                                  : 0
                                const color = def
                                  ? fieldDisplayColor(def, documentFields)
                                  : FIELD_COLORS[0]
                                const check = fieldCheck(
                                  side,
                                  field.key,
                                  Boolean((field.value ?? "").trim()),
                                  Boolean(def?.required)
                                )
                                return (
                                  <tr
                                    key={field.key}
                                    className="border-t border-line-tint"
                                  >
                                    <td className="px-3 py-2.5 align-top">
                                      <span className="inline-flex items-center gap-2 font-medium">
                                        <span
                                          className="flex size-5 items-center justify-center rounded text-[10px] font-semibold text-white"
                                          style={{ backgroundColor: color }}
                                        >
                                          {displayNumber || "."}
                                        </span>
                                        {field.label}
                                      </span>
                                    </td>
                                    <td
                                      className={cn(
                                        "px-3 py-2.5 font-semibold break-words whitespace-normal align-top",
                                        PROOF_THEME.title
                                      )}
                                    >
                                      {field.value || (
                                        <span
                                          className={cn(
                                            "font-medium italic",
                                            PROOF_THEME.muted
                                          )}
                                        >
                                          Not detected
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 align-top">
                                      {check.kind === "none" ? null : check.kind ===
                                        "not_tested" ? (
                                        <span
                                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
                                          title={check.messages.join(", ")}
                                        >
                                          <Info className="size-3.5" />
                                          {check.messages[0] ?? "Not tested"}
                                        </span>
                                      ) : check.kind === "pass" ? (
                                        <span
                                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                                          title={check.checkNames.join(", ")}
                                        >
                                          <CheckCircle2 className="size-3.5" />
                                          Passed
                                        </span>
                                      ) : (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                            check.severity === "block"
                                              ? "bg-rose-50 text-rose-700"
                                              : "bg-amber-50 text-amber-700"
                                          )}
                                        >
                                          {check.severity === "block" ? (
                                            <XCircle className="size-3.5 shrink-0" />
                                          ) : (
                                            <AlertTriangle className="size-3.5 shrink-0" />
                                          )}
                                          <span className="min-w-0">
                                            {check.messages[0] ??
                                              "Check failed"}
                                            {check.messages.length > 1 ? (
                                              <span
                                                className={
                                                  check.severity === "block"
                                                    ? "text-rose-600"
                                                    : "text-amber-600"
                                                }
                                              >
                                                {" "}
                                                +{check.messages.length -
                                                  1}{" "}
                                                more
                                              </span>
                                            ) : null}
                                          </span>
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )
                      ) : (
                        <p
                          className={cn(
                            "px-3 py-6 text-center text-xs font-medium italic",
                            PROOF_THEME.muted
                          )}
                        >
                          Test the {sideLabel(side).toLowerCase()} photo to see
                          these fields.
                        </p>
                      )}
                    </section>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {lightbox ? (
        <ImageLightbox
          url={lightbox.url}
          filename={lightbox.filename}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  )
}