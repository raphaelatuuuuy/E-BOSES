import { useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { usePageTitle } from "@/hooks/use-page-title"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  confirmAccountNameChange,
  type ResidenceProofDetectResult,
} from "@/features/auth/api"
import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { ProofStep } from "@/features/auth/components/sign-up-steps/proof-step"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"
import { listResidenceProofOptions } from "@/features/ocr/api"
import type { ResidenceProofOption } from "@/features/ocr/api"
import { getAccessToken } from "@/lib/api"
import { ApiError } from "@/lib/api"

type Step = "name" | "proof" | "result"

/** Minimal SignUpValues shell — ProofStep only reads proof fields. */
function emptyProofValues(): SignUpValues {
  return {
    email: "",
    password: "",
    agreeToTerms: true,
    emailOtpCode: "",
    firstName: "",
    middleName: "",
    lastName: "",
    dateOfBirth: "",
    street: "",
    houseNumber: "",
    address: "",
    proofOfResidency: [],
    proofType: "",
    phoneNumber: "",
    phoneOtpCode: "",
    gender: "prefer_not_to_say",
    avatar: "",
  } as SignUpValues
}

function fieldValue(
  fields: ResidenceProofDetectResult["extracted_fields"] | undefined,
  key: string,
): string {
  if (!fields || !fields[key]) return ""
  const item = fields[key]
  if (typeof item === "string") return item.trim()
  if (item && typeof item === "object") {
    return String(item.value ?? item.raw_value ?? "").trim()
  }
  return ""
}

function splitFullName(full: string): {
  first: string
  middle: string
  last: string
} {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: "", middle: "", last: "" }
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" }
  if (parts.length === 2) return { first: parts[0], middle: "", last: parts[1] }
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(" "),
    last: parts[parts.length - 1],
  }
}

function extractOcrNames(detect: ResidenceProofDetectResult | null) {
  const fields = detect?.extracted_fields
  // National ID / PhilSys templates often use first_name + last_name; some use full_name only.
  let first =
    fieldValue(fields, "first_name") ||
    fieldValue(fields, "given_name") ||
    fieldValue(fields, "given_names") ||
    fieldValue(fields, "firstname")
  let middle =
    fieldValue(fields, "middle_name") ||
    fieldValue(fields, "middlename") ||
    fieldValue(fields, "middle_initial")
  let last =
    fieldValue(fields, "last_name") ||
    fieldValue(fields, "lastname") ||
    fieldValue(fields, "surname") ||
    fieldValue(fields, "family_name")
  const full =
    fieldValue(fields, "full_name") ||
    fieldValue(fields, "resident_name") ||
    fieldValue(fields, "account_name") ||
    fieldValue(fields, "name")
  if ((!first || !last) && full) {
    const split = splitFullName(full)
    first = first || split.first
    middle = middle || split.middle
    last = last || split.last
  }
  return { first, middle, last, full }
}

/** Align with server-side name normalize for match feedback. */
function normalizePersonName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\sñ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function namePartsMatch(requested: string, ocr: string) {
  const a = normalizePersonName(requested)
  const b = normalizePersonName(ocr)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

function evaluateNameMatch(
  firstName: string,
  middleName: string,
  lastName: string,
  ocrFirst: string,
  ocrMiddle: string,
  ocrLast: string,
  ocrFull?: string,
): boolean {
  const reqFull = normalizePersonName(
    [firstName, middleName, lastName].filter((p) => p.trim()).join(" "),
  )
  const docFull = normalizePersonName(
    ocrFull ||
      [ocrFirst, ocrMiddle, ocrLast].filter((p) => p.trim()).join(" "),
  )

  // Full-string compare (handles single full_name field or OCR order quirks).
  if (reqFull && docFull) {
    if (
      reqFull === docFull ||
      reqFull.includes(docFull) ||
      docFull.includes(reqFull)
    ) {
      return true
    }
    // Token multiset: "Juan Dela Cruz" vs "DELA CRUZ JUAN"
    const reqTokens = reqFull.split(" ").filter(Boolean).sort().join(" ")
    const docTokens = docFull.split(" ").filter(Boolean).sort().join(" ")
    if (reqTokens && reqTokens === docTokens) return true
  }

  if (!ocrFirst && !ocrLast && !docFull) return false

  // Part-wise (National ID: first_name + last_name)
  if (ocrFirst && ocrLast) {
    const firstOk = namePartsMatch(firstName, ocrFirst)
    const lastOk = namePartsMatch(lastName, ocrLast)
    if (!firstOk || !lastOk) return false
    const reqMiddle = middleName.trim()
    const docMiddle = ocrMiddle.trim()
    if (reqMiddle && docMiddle) {
      return namePartsMatch(reqMiddle, docMiddle)
    }
    return true
  }

  // Only one part extracted — require it to appear in the entered full name.
  if (docFull && reqFull) {
    return reqFull.includes(docFull) || docFull.includes(reqFull)
  }
  return false
}

export default function AccountReverifyNamePage() {
  usePageTitle("Change name")
  const navigate = useNavigate()
  const location = useLocation()
  const { user, setAuthenticatedUser, refreshUser } = useAuthSession()
  const draft = (location.state as {
    firstName?: string
    middleName?: string
    lastName?: string
  } | null) ?? null

  const [step, setStep] = useState<Step>("name")
  const [firstName, setFirstName] = useState(
    draft?.firstName ?? user?.firstName ?? "",
  )
  const [middleName, setMiddleName] = useState(
    draft?.middleName ?? user?.middleName ?? "",
  )
  const [lastName, setLastName] = useState(
    draft?.lastName ?? user?.lastName ?? "",
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const [proofValues, setProofValues] = useState<SignUpValues>(emptyProofValues)
  const [proofErrors, setProofErrors] = useState<SignUpErrors>({})
  const [proofDetect, setProofDetect] = useState<ResidenceProofDetectResult | null>(null)
  const [proofOptions, setProofOptions] = useState<ResidenceProofOption[]>([])
  const [proofOptionsLoading, setProofOptionsLoading] = useState(true)

  const [ocrFirst, setOcrFirst] = useState("")
  const [ocrMiddle, setOcrMiddle] = useState("")
  const [ocrLast, setOcrLast] = useState("")
  /** Result step: only success / failure feedback (no OCR detail dump). */
  const [matchOk, setMatchOk] = useState<boolean | null>(null)
  const [saved, setSaved] = useState(false)

  const progress = step === "name" ? 30 : step === "proof" ? 65 : 100

  const nameOk =
    firstName.trim().length >= 1 &&
    lastName.trim().length >= 1 &&
    /^[A-Za-zÑñ ]+$/.test(firstName.trim()) &&
    /^[A-Za-zÑñ ]+$/.test(lastName.trim()) &&
    (middleName.trim() === "" || /^[A-Za-zÑñ ]+$/.test(middleName.trim()))

  useEffect(() => {
    let cancelled = false
    setProofOptionsLoading(true)
    void listResidenceProofOptions()
      .then((options) => {
        if (!cancelled) setProofOptions(options)
      })
      .catch(() => {
        if (!cancelled) setProofOptions([])
      })
      .finally(() => {
        if (!cancelled) setProofOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function goBack() {
    if (step === "proof") {
      setStep("name")
      setError("")
      return
    }
    if (step === "result") {
      setStep("proof")
      setError("")
      return
    }
    navigate("/dashboard/settings?panel=account")
  }

  function onProofChange<K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) {
    setProofValues((prev) => ({ ...prev, [field]: value }))
  }

  function onSetFieldError(field: keyof SignUpValues, message: string | undefined) {
    setProofErrors((prev) => {
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  function handleProofContinue(detectFromProof?: ResidenceProofDetectResult | null) {
    // Prefer detect passed from ProofStep — React state can still be stale here.
    const detect = detectFromProof ?? proofDetect
    const extracted = extractOcrNames(detect)
    setOcrFirst(extracted.first)
    setOcrMiddle(extracted.middle)
    setOcrLast(extracted.last)
    setSaved(false)
    setError("")
    setProofDetect(detect)

    const ok = evaluateNameMatch(
      firstName,
      middleName,
      lastName,
      extracted.first,
      extracted.middle,
      extracted.last,
      extracted.full,
    )
    setMatchOk(ok)
    setStep("result")

    // Auto-apply when matched so user only sees success feedback.
    if (ok) {
      void applyNameChange(extracted.first, extracted.middle, extracted.last)
    }
  }

  async function applyNameChange(
    ocrF: string = ocrFirst,
    ocrM: string = ocrMiddle,
    ocrL: string = ocrLast,
  ) {
    setBusy(true)
    setError("")
    try {
      const nextUser = await confirmAccountNameChange({
        first_name: firstName.trim(),
        middle_name: middleName.trim(),
        last_name: lastName.trim(),
        ocr_first_name: ocrF,
        ocr_middle_name: ocrM,
        ocr_last_name: ocrL,
      })
      const access = getAccessToken()
      if (access) setAuthenticatedUser(nextUser, access)
      else await refreshUser()
      setMatchOk(true)
      setSaved(true)
      toast.success("Name updated")
    } catch {
      // Server rejected — treat as not matched (no raw field dump).
      setMatchOk(false)
      setSaved(false)
      setError("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh min-w-0 flex-1 flex-col bg-white">
      {/* Sign-up style: centered wizard column, no chrome beside */}
      <div className="mx-auto w-full max-w-[600px] flex-1 px-5 pb-10 pt-4 md:px-0 md:pt-6">
        <header className="relative flex w-full items-center">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex size-11 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
            aria-label="Go back"
          >
            <ChevronLeftIcon className="size-6 stroke-[2]" />
          </button>
        </header>
        <div className="mt-3 w-full pb-5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-[#ff8133] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {step === "name" ? (
          <>
            <h1 className="text-[1.5rem] font-bold tracking-tight text-[#020c4e]">
              Enter your legal name
            </h1>
            <p className="mt-2 text-[15px] text-neutral-500">
              This must match your ID or residence proof. Only your name will be
              updated after document verification.
            </p>
            <div className="mt-6 space-y-3">
              <FloatingLabelInput
                id="reverify-first-name"
                label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoComplete="given-name"
              />
              <FloatingLabelInput
                id="reverify-middle-name"
                label="Middle name (optional)"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
                autoComplete="additional-name"
              />
              <FloatingLabelInput
                id="reverify-last-name"
                label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                autoComplete="family-name"
              />
            </div>
            {error ? (
              <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>
            ) : null}
            <button
              type="button"
              disabled={!nameOk}
              onClick={() => {
                setError("")
                setProofValues(emptyProofValues())
                setProofDetect(null)
                setProofErrors({})
                setStep("proof")
              }}
              className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
            >
              Continue
            </button>
          </>
        ) : null}

        {step === "proof" ? (
          <ProofStep
            title="Upload proof of identity"
            values={proofValues}
            errors={proofErrors}
            proofOptions={proofOptions}
            proofOptionsLoading={proofOptionsLoading}
            canCaptureProof
            proofCaptureBlockedReason={null}
            onChange={onProofChange}
            onSetFieldError={onSetFieldError}
            onRefreshProofOptions={async () => {
              const options = await listResidenceProofOptions()
              setProofOptions(options)
              return options
            }}
            onContinue={handleProofContinue}
            proofDetect={proofDetect}
            onProofDetectChange={setProofDetect}
          />
        ) : null}

        {step === "result" ? (
          <div className="flex flex-1 flex-col items-center pt-8 text-center">
            {busy && matchOk !== false ? (
              <>
                <Loader2Icon className="size-12 animate-spin text-neutral-400" />
                <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-[#020c4e]">
                  Checking your name…
                </h1>
                <p className="mt-2 max-w-sm text-[15px] text-neutral-500">
                  Verifying that your document matches the name you entered.
                </p>
              </>
            ) : matchOk ? (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <CheckCircle2Icon className="size-10" strokeWidth={1.75} />
                </span>
                <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-[#020c4e]">
                  Name matched
                </h1>
                <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-neutral-500">
                  {saved
                    ? "Your name was verified successfully and has been updated on your account."
                    : "Your name matches the document. Your account is ready to update."}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (saved) {
                      navigate("/dashboard/settings?panel=account", { replace: true })
                    } else {
                      void applyNameChange()
                    }
                  }}
                  className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
                >
                  {busy ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : saved ? (
                    "Done"
                  ) : (
                    "Update name"
                  )}
                </button>
              </>
            ) : (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-red-50 text-red-600">
                  <XCircleIcon className="size-10" strokeWidth={1.75} />
                </span>
                <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-[#020c4e]">
                  Name did not match
                </h1>
                <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-neutral-500">
                  We could not verify your name from the document. Nothing was
                  changed. Try a clearer ID photo or correct the name you entered.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setProofValues(emptyProofValues())
                    setProofDetect(null)
                    setProofErrors({})
                    setMatchOk(null)
                    setSaved(false)
                    setError("")
                    setStep("proof")
                  }}
                  className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e]"
                >
                  Try again
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMatchOk(null)
                    setSaved(false)
                    setError("")
                    setStep("name")
                  }}
                  className="mt-3 flex h-11 w-full max-w-sm items-center justify-center text-[14px] font-semibold text-neutral-700"
                >
                  Edit name
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}


