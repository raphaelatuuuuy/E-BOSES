"use client"

import { useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  Loader2Icon,
  XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

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

type Step = "name" | "proof" | "result"
type ExtractedFieldValue =
  | string
  | { value?: string; label?: string; confidence?: number | null; raw_value?: string }

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
    homeLatitude: null,
    homeLongitude: null,
    homeAccuracyMeters: null,
    homeLocationSource: null,
    communityResolutionToken: "",
    communityMatch: null,
  } as SignUpValues
}

function fieldValue(
  fields: ResidenceProofDetectResult["extracted_fields"] | undefined,
  key: string,
): string {
  if (!fields || !fields[key]) return ""
  const item = fields[key] as ExtractedFieldValue
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

  if (reqFull && docFull) {
    if (
      reqFull === docFull ||
      reqFull.includes(docFull) ||
      docFull.includes(reqFull)
    ) {
      return true
    }
    const reqTokens = reqFull.split(" ").filter(Boolean).sort().join(" ")
    const docTokens = docFull.split(" ").filter(Boolean).sort().join(" ")
    if (reqTokens && reqTokens === docTokens) return true
  }

  if (!ocrFirst && !ocrLast && !docFull) return false

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

  if (docFull && reqFull) {
    return reqFull.includes(docFull) || docFull.includes(reqFull)
  }
  return false
}

export function ReverifyNameFlow({
  registerBack,
  onDone,
  onExit,
}: {
  registerBack: (fn: () => void) => void
  onDone: () => void
  onExit: () => void
}) {
  const { user, setAuthenticatedUser, refreshUser } = useAuthSession()

  const [step, setStep] = useState<Step>("name")
  const [firstName, setFirstName] = useState(user?.firstName ?? "")
  const [middleName, setMiddleName] = useState(user?.middleName ?? "")
  const [lastName, setLastName] = useState(user?.lastName ?? "")
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
  const [matchOk, setMatchOk] = useState<boolean | null>(null)
  const [saved, setSaved] = useState(false)

  const progress = step === "name" ? 30 : step === "proof" ? 65 : 100

  const nameOk =
    firstName.trim().length >= 1 &&
    lastName.trim().length >= 1 &&
    /^[A-Za-zÑñ ]+$/.test(firstName.trim()) &&
    /^[A-Za-zÑñ ]+$/.test(lastName.trim()) &&
    (middleName.trim() === "" || /^[A-Za-zÑñ ]+$/.test(middleName.trim()))

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
    onExit()
  }

  useEffect(() => {
    registerBack(goBack)
  })

  useEffect(() => {
    let cancelled = false
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
      setMatchOk(false)
      setSaved(false)
      setError("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="w-full pb-5">
        <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {step === "name" ? (
        <>
          <h1 className="text-[1.5rem] font-bold tracking-tight text-foreground">
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
            <p className="mt-2 text-[13px] font-medium text-sos">{error}</p>
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
            className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
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
            setProofOptionsLoading(true)
            try {
              const options = await listResidenceProofOptions()
              setProofOptions(options)
              return options
            } catch {
              setProofOptions([])
              return [] as ResidenceProofOption[]
            } finally {
              setProofOptionsLoading(false)
            }
          }}
          onContinue={handleProofContinue}
          proofDetect={proofDetect}
          onProofDetectChange={setProofDetect}
        />
      ) : null}

      {step === "result" ? (
        <div className="flex flex-col items-center pt-8 text-center">
          {busy && matchOk !== false ? (
            <>
              <Loader2Icon className="size-12 animate-spin text-neutral-400" />
              <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-foreground">
                Checking your name…
              </h1>
              <p className="mt-2 max-w-sm text-[15px] text-neutral-500">
                Verifying that your document matches the name you entered.
              </p>
            </>
          ) : matchOk ? (
            <>
              <span className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                <CheckCircle2Icon className="size-10" strokeWidth={1.75} />
              </span>
              <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-foreground">
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
                    onDone()
                  } else {
                    void applyNameChange()
                  }
                }}
                className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
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
              <span className="flex size-16 items-center justify-center rounded-full bg-sos/10 text-sos">
                <XCircleIcon className="size-10" strokeWidth={1.75} />
              </span>
              <h1 className="mt-6 text-[1.45rem] font-bold tracking-tight text-foreground">
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
                className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-brand-orange-strong"
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
    </>
  )
}
