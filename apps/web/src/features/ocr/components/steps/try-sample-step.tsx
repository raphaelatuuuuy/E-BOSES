import { useMemo, useState } from "react"
import { CircleAlert, CircleCheck, CircleX } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  normalizeExtractedFields,
  type OcrDocumentType,
  type OcrTestField,
  type ProofSide,
  type SimulatedProfile,
  type VerificationRuleResult,
} from "@/features/ocr/api"
import type {
  MergedTestResult,
  ProfileMatchKey,
} from "@/features/ocr/hooks/use-ocr-template-state"

const PROFILE_FIELD_LABELS: Partial<Record<ProfileMatchKey, string>> = {
  first_name: "First name",
  middle_name: "Middle name",
  last_name: "Last name",
  date_of_birth: "Date of birth",
}

function sanitizeNameInput(raw: string): string {
  return raw.replace(/[^A-Za-z\s'-]/g, "").replace(/\s{2,}/g, " ")
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

export function TrySampleProfileForm(props: {
  testRunning: boolean
  testProfile: SimulatedProfile
  relevantProfileKeys: ProfileMatchKey[]
  onTestProfileChange: (key: ProfileMatchKey, value: string) => void
}) {
  const { testRunning, testProfile, relevantProfileKeys, onTestProfileChange } =
    props

  const profileKeys = useMemo(
    () =>
      relevantProfileKeys.filter(
        (key) => key !== "address" && key !== "gender"
      ),
    [relevantProfileKeys]
  )

  const [dobText, setDobText] = useState<string>(() =>
    isoToDisplay(testProfile.date_of_birth ?? "")
  )
  const [dobError, setDobError] = useState<string>("")

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

  if (profileKeys.length === 0) return null

  const inputClass =
    "w-full bg-white pl-4 text-[16px] text-black outline-none transition-colors placeholder:text-neutral-400 disabled:opacity-50"

  return (
    <div className="-mx-5 divide-y divide-neutral-200">
      {profileKeys.map((key) => {
        const placeholder = PROFILE_FIELD_LABELS[key] ?? key
        const value = testProfile[key] ?? ""
        if (key === "date_of_birth") {
          return (
            <div key={key} className="py-3.5 first:pt-0 last:pb-0">
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={dobText}
                  onChange={(event) => handleDobChange(event.target.value)}
                  placeholder="Date of birth"
                  maxLength={10}
                  disabled={testRunning}
                  aria-invalid={Boolean(dobError)}
                  className={cn(
                    inputClass,
                    dobError ? "pr-36 sm:pr-44" : "pr-4"
                  )}
                />
                {dobError ? (
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex max-w-[48%] items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-sos">
                    <CircleX className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{dobError}</span>
                  </span>
                ) : null}
              </div>
            </div>
          )
        }
        return (
          <div key={key} className="py-3.5 first:pt-0 last:pb-0">
            <input
              type="text"
              value={value}
              onChange={(event) =>
                onTestProfileChange(
                  key,
                  key === "first_name" ||
                    key === "middle_name" ||
                    key === "last_name"
                    ? sanitizeNameInput(event.target.value)
                    : event.target.value
                )
              }
              placeholder={placeholder}
              disabled={testRunning}
              className={inputClass}
            />
          </div>
        )
      })}
    </div>
  )
}
function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Front"
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

export function TrySampleResults(props: {
  mergedTestResult: MergedTestResult
  documentFields?: OcrDocumentType["fields"]
  canvasSides: ProofSide[]
}) {
  const { mergedTestResult, documentFields = [], canvasSides } = props

  const requiredSides: ProofSide[] = useMemo(
    () => (canvasSides.length ? canvasSides : ["single"]),
    [canvasSides]
  )
  const multiSide = requiredSides.length >= 2
  const { bySide, tested } = mergedTestResult

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

  function resolveRuleFieldKey(rule: VerificationRuleResult): string | null {
    const ruleField = rule.field ?? null
    if (ruleField && documentFields.some((f) => f.key === ruleField)) {
      return ruleField
    }
    const profile = (rule.profile ?? "").toLowerCase()
    if (!profile) return ruleField
    const PROFILE_TOKENS: Record<string, string[]> = {
      date_of_birth: [
        "date_of_birth",
        "birth_date",
        "birthdate",
        "dob",
        "birth",
      ],
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
      if (tokens.includes(key)) return true
      if (tokens.some((token) => label.includes(token))) return true
      return false
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
    if (checks.length === 0) {
      return {
        kind: "not_tested",
        severity: null,
        messages: ["No rule configured."],
        checkNames: [],
      }
    }
    if (checks.every((rule) => rule.passed == null)) {
      const explanations = [
        ...new Set(
          checks
            .map((rule) => withoutLeadingThe(rule.detail || rule.message || ""))
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

  if (!tested) return null

  return (
    <div className="space-y-4">
      {requiredSides.map((side) => {
        const fields = sideExtracted(side)
        return (
          <section key={side}>
            {multiSide ? (
              <p className="mb-1 text-[13px] font-semibold text-neutral-500 uppercase">
                {sideLabel(side)}
              </p>
            ) : null}
            {bySide[side] ? (
              fields.length === 0 ? (
                <p className="py-6 text-center text-[13px] font-medium text-neutral-500 italic">
                  Nothing was read from this photo.
                </p>
              ) : (
                <div className="-mx-5 divide-y divide-neutral-200">
                  {fields.map((field) => {
                    const def = documentFields.find(
                      (item) => item.key === field.key
                    )
                    const check = fieldCheck(
                      side,
                      field.key,
                      Boolean((field.value ?? "").trim()),
                      Boolean(def?.required)
                    )
                    return (
                      <div
                        key={field.key}
                        className="flex items-start gap-3 px-5 py-3"
                      >
                        <div className="flex w-5 shrink-0 justify-center pt-[3px]">
                          {check.kind === "pass" ? (
                            <CircleCheck
                              className="size-4 text-status-closed"
                              aria-hidden
                            />
                          ) : check.kind === "fail" ? (
                            check.severity === "block" ? (
                              <CircleX
                                className="size-4 text-sos"
                                aria-hidden
                              />
                            ) : (
                              <CircleAlert
                                className="size-4 text-severity-moderate"
                                aria-hidden
                              />
                            )
                          ) : check.kind === "not_tested" ? (
                            <span className="mt-2 size-2 rounded-full bg-neutral-300" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-neutral-500">
                            {field.label}
                          </p>
                          <p className="mt-0.5 text-[15px] leading-snug font-semibold break-words text-neutral-900">
                            {field.value ? (
                              field.value
                            ) : (
                              <span className="font-medium text-neutral-400 italic">
                                Not detected
                              </span>
                            )}
                          </p>
                          {check.kind === "pass" ? (
                            <p
                              className="mt-0.5 text-[13px] font-medium text-status-closed"
                              title={check.checkNames.join(", ")}
                            >
                              Passed
                            </p>
                          ) : check.kind === "fail" ? (
                            <p
                              className={cn(
                                "mt-0.5 text-[13px] leading-snug font-medium",
                                check.severity === "block"
                                  ? "text-sos"
                                  : "text-severity-moderate"
                              )}
                            >
                              {check.messages[0] ?? "Check failed"}
                              {check.messages.length > 1 ? (
                                <span className="font-normal text-neutral-400">
                                  {" "}
                                  +{check.messages.length - 1} more
                                </span>
                              ) : null}
                            </p>
                          ) : check.kind === "not_tested" ? (
                            <p className="mt-0.5 text-[13px] text-neutral-400">
                              {check.messages[0] ?? "Not tested"}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            ) : (
              <p className="py-6 text-center text-[13px] font-medium text-neutral-500 italic">
                Test the {sideLabel(side).toLowerCase()} photo to see these
                fields.
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}
