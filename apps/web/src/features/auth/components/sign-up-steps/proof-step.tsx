import * as React from "react"
import { flushSync } from "react-dom"
import {
  LoaderCircleIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import type { ResidenceProofDetectResult } from "@/features/auth/api"
import { BoxIdCardIcon } from "@/features/auth/components/id-card-icon"
import {
  StepContinueButton,
  StepTitle,
} from "@/features/auth/components/sign-up-shell"
import {
  checkProofSide,
  detectProofOcr,
  humanizeProofError,
  sideLabel,
  sidesForOption,
} from "@/features/auth/lib/process-proof-file"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"
import type { ResidenceProofOption } from "@/features/ocr/api"

interface ProofStepProps {
  values: SignUpValues
  errors: SignUpErrors
  proofOptions: ResidenceProofOption[]
  proofOptionsLoading: boolean
  canCaptureProof: boolean
  proofCaptureBlockedReason: string | null
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onSetFieldError: (field: keyof SignUpValues, message: string | undefined) => void
  onRefreshProofOptions: () => Promise<unknown>
  /**
   * Called after successful OCR. Optional detect payload avoids stale React state
   * when the parent advances immediately (name re-verify match uses this).
   */
  onContinue: (detect?: ResidenceProofDetectResult | null) => void
  proofDetect: ResidenceProofDetectResult | null
  onProofDetectChange: (detect: ResidenceProofDetectResult | null) => void
  /** Override default title (e.g. name re-verify flow). */
  title?: string
}

/** Prefer non-empty field values when combining front + back OCR. */
function mergeProofDetects(
  parts: ResidenceProofDetectResult[],
): ResidenceProofDetectResult | null {
  if (parts.length === 0) return null
  const base = { ...parts[parts.length - 1]! }
  const merged: NonNullable<ResidenceProofDetectResult["extracted_fields"]> = {
    ...(base.extracted_fields || {}),
  }
  for (const part of parts) {
    for (const [key, item] of Object.entries(part.extracted_fields || {})) {
      const nextVal =
        item == null
          ? ""
          : typeof item === "string" || typeof item === "number"
            ? String(item).trim()
            : String(
                (item as { value?: string; raw_value?: string }).value ??
                  (item as { raw_value?: string }).raw_value ??
                  "",
              ).trim()
      const prev = merged[key]
      const prevVal =
        prev == null
          ? ""
          : typeof prev === "string" || typeof prev === "number"
            ? String(prev).trim()
            : String(
                (prev as { value?: string; raw_value?: string }).value ??
                  (prev as { raw_value?: string }).raw_value ??
                  "",
              ).trim()
      if (nextVal && !prevVal) {
        merged[key] = item as (typeof merged)[string]
      } else if (nextVal && prevVal && nextVal.length > prevVal.length) {
        // Prefer richer OCR hit when both sides return something for the same key.
        merged[key] = item as (typeof merged)[string]
      }
    }
  }
  return {
    ...base,
    detected: parts.some((p) => p.detected) || base.detected,
    extracted_fields: merged,
  }
}

type TypeStatus = "idle" | "approved" | "rejected"

export function ProofStep({
  values,
  errors,
  proofOptions,
  proofOptionsLoading,
  canCaptureProof,
  proofCaptureBlockedReason,
  onChange,
  onSetFieldError,
  onContinue,
  onRefreshProofOptions,
  proofDetect,
  onProofDetectChange,
  title = "One quick check that you live in this area.",
}: ProofStepProps) {
  const [selectedType, setSelectedType] = React.useState(values.proofType || "")
  const [typeStatus, setTypeStatus] = React.useState<TypeStatus>(() =>
    values.proofOfResidency.length > 0 && proofDetect?.detected ? "approved" : "idle",
  )
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogOption, setDialogOption] = React.useState<ResidenceProofOption | null>(null)
  /** Original files that already passed media forensics (for registration). */
  const [acceptedFiles, setAcceptedFiles] = React.useState<(File | null)[]>([])
  const [previewUrls, setPreviewUrls] = React.useState<(string | null)[]>([])
  const [sideErrors, setSideErrors] = React.useState<(string | null)[]>([])
  const [checkingSide, setCheckingSide] = React.useState<number | null>(null)
  const [checkStatus, setCheckStatus] = React.useState("")
  const [verifyingOcr, setVerifyingOcr] = React.useState(false)
  const [dialogError, setDialogError] = React.useState<string | null>(null)
  const [activeSide, setActiveSide] = React.useState(0)
  const [fullPreviewUrl, setFullPreviewUrl] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const selectedOption =
    proofOptions.find((item) => item.key === selectedType || item.key === values.proofType) ?? null
  const requiredSides = sidesForOption(dialogOption ?? selectedOption)

  const allSidesAccepted =
    requiredSides.length > 0 &&
    requiredSides.every((_, i) => acceptedFiles[i] instanceof File)

  const isApproved =
    typeStatus === "approved" &&
    Boolean(proofDetect?.detected && values.proofOfResidency.length > 0)
  const isRejected = typeStatus === "rejected"
  const feedbackError = errors.proofOfResidency || errors.proofType || null

  /** After a type is verified, lock all options so switching does not wipe uploads. */
  const typesLocked = isApproved

  // When the submitted proof type changes externally, adopt it locally —
  // render-adjust instead of a sync setState effect.
  const [prevProofType, setPrevProofType] = React.useState(values.proofType)
  if (prevProofType !== values.proofType) {
    setPrevProofType(values.proofType)
    if (values.proofType && values.proofType !== selectedType) {
      setSelectedType(values.proofType)
    }
  }

  React.useEffect(() => {
    return () => {
      previewUrls.forEach((url) => {
        if (url) URL.revokeObjectURL(url)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function revokeAllPreviews() {
    setPreviewUrls((prev) => {
      prev.forEach((url) => {
        if (url) URL.revokeObjectURL(url)
      })
      return []
    })
  }

  function openUploadDialog(option: ResidenceProofOption) {
    if (!canCaptureProof || verifyingOcr || checkingSide !== null) return
    // Verified already — do not reopen / reset by picking another type
    if (typesLocked) return

    if (selectedType && selectedType !== option.key) {
      onChange("proofOfResidency", [])
      onProofDetectChange(null)
    }

    setSelectedType(option.key)
    onChange("proofType", option.key)
    setTypeStatus("idle")
    onSetFieldError("proofType", undefined)
    onSetFieldError("proofOfResidency", undefined)
    onProofDetectChange(null)
    onChange("proofOfResidency", [])

    const sides = sidesForOption(option)
    revokeAllPreviews()
    setDialogOption(option)
    setAcceptedFiles(sides.map(() => null))
    setPreviewUrls(sides.map(() => null))
    setSideErrors(sides.map(() => null))
    setActiveSide(0)
    setDialogError(null)
    setCheckStatus("")
    setCheckingSide(null)
    setVerifyingOcr(false)
    setFullPreviewUrl(null)
    setDialogOpen(true)
  }

  function closeDialog() {
    if (verifyingOcr || checkingSide !== null) return
    setDialogOpen(false)
    setDialogError(null)
    setCheckStatus("")
    setFullPreviewUrl(null)
  }

  function pickSide(sideIndex: number) {
    if (verifyingOcr || checkingSide !== null) return
    setActiveSide(sideIndex)
    setDialogError(null)
    setTypeStatus((s) => (s === "rejected" ? "idle" : s))
    setSideErrors((prev) => {
      const next = [...prev]
      next[sideIndex] = null
      return next
    })
    requestAnimationFrame(() => fileInputRef.current?.click())
  }

  async function handleFileSelected(fileList: FileList | null) {
    const input = fileInputRef.current
    const raw = fileList?.[0] ?? null
    if (input) input.value = ""
    if (!raw || !dialogOption) return

    const sideIndex = activeSide
    const others = acceptedFiles
      .map((f, i) => (i === sideIndex ? null : f))
      .filter((f): f is File => f instanceof File)

    setCheckingSide(sideIndex)
    setDialogError(null)
    setSideErrors((prev) => {
      const next = [...prev]
      next[sideIndex] = null
      return next
    })
    setCheckStatus("Checking photo…")

    const result = await checkProofSide({
      file: raw,
      sideIndex,
      option: dialogOption,
      alreadyCaptured: others,
      email: values.email,
      communityResolutionToken: values.communityResolutionToken,
      onStatus: setCheckStatus,
    })

    if (!result.ok) {
      // Error state only on the side that failed (not both Front and Back).
      setSideErrors((prev) => {
        const next = [...prev]
        next[sideIndex] = result.message
        return next
      })
      setDialogError(null)
      setAcceptedFiles((prev) => {
        const next = [...prev]
        next[sideIndex] = null
        return next
      })
      setPreviewUrls((prev) => {
        const next = [...prev]
        if (next[sideIndex]) URL.revokeObjectURL(next[sideIndex]!)
        next[sideIndex] = null
        return next
      })
      setCheckStatus("")
      setCheckingSide(null)
      return
    }

    const projected = requiredSides.map((_, i) =>
      i === sideIndex ? result.file : acceptedFiles[i],
    )

    setAcceptedFiles((prev) => {
      const next = [...prev]
      next[sideIndex] = result.file
      return next
    })
    setPreviewUrls((prev) => {
      const next = [...prev]
      if (next[sideIndex]) URL.revokeObjectURL(next[sideIndex]!)
      next[sideIndex] = URL.createObjectURL(result.file)
      return next
    })
    setSideErrors((prev) => {
      const next = [...prev]
      next[sideIndex] = null
      return next
    })
    setDialogError(null)
    setCheckStatus("")
    setCheckingSide(null)

    const emptyIdx = projected.findIndex((f) => !(f instanceof File))
    if (emptyIdx >= 0) setActiveSide(emptyIdx)
  }

  function removeSide(sideIndex: number) {
    if (verifyingOcr || checkingSide !== null) return
    setAcceptedFiles((prev) => {
      const next = [...prev]
      next[sideIndex] = null
      return next
    })
    setPreviewUrls((prev) => {
      const next = [...prev]
      if (next[sideIndex]) URL.revokeObjectURL(next[sideIndex]!)
      next[sideIndex] = null
      return next
    })
    setSideErrors((prev) => {
      const next = [...prev]
      next[sideIndex] = null
      return next
    })
    setActiveSide(sideIndex)
    setDialogError(null)
  }

  async function runOcrVerify() {
    if (!dialogOption || !allSidesAccepted || verifyingOcr) return

    const files = requiredSides
      .map((_, i) => acceptedFiles[i])
      .filter((f): f is File => f instanceof File)
    if (files.length < requiredSides.length) {
      setDialogError(
        requiredSides.length > 1
          ? "Upload both Front and Back before verifying."
          : "Upload Front before verifying.",
      )
      return
    }

    setVerifyingOcr(true)
    setDialogError(null)

    try {
      // OCR each photo with its own fields (front boxes on front, back boxes on back).
      // Merge all sides — National ID names live on front; last side alone is often back-only.
      const successfulDetects: ResidenceProofDetectResult[] = []
      for (let i = 0; i < files.length; i += 1) {
        const side = requiredSides[i] ?? "front"
        const ocr = await detectProofOcr({
          file: files[i]!,
          option: dialogOption,
          side,
          email: values.email,
          communityResolutionToken: values.communityResolutionToken,
          profile: {
            first_name: values.firstName ?? "",
            middle_name: values.middleName ?? "",
            last_name: values.lastName ?? "",
            date_of_birth: values.dateOfBirth ?? "",
            gender: values.gender ?? "",
            address: values.address ?? "",
          },
        })
        if (!ocr.ok) {
          const message = humanizeProofError(
            ocr.message,
            requiredSides.length > 1 ? side : null,
          )
          // Highlight only the side that failed OCR, not every row.
          setSideErrors(() => {
            const next = requiredSides.map(() => null as string | null)
            next[i] = message
            return next
          })
          setDialogError(null)
          setTypeStatus("rejected")
          onSetFieldError("proofOfResidency", message)
          onProofDetectChange(ocr.detect)
          onChange("proofOfResidency", [])
          return
        }
        successfulDetects.push(ocr.detect)
      }

      const mergedDetect = mergeProofDetects(successfulDetects)

      flushSync(() => {
        onChange("proofType", dialogOption.key)
        onChange("proofOfResidency", files)
        onProofDetectChange(mergedDetect)
        onSetFieldError("proofOfResidency", undefined)
        onSetFieldError("proofType", undefined)
        setSelectedType(dialogOption.key)
        setTypeStatus("approved")
      })

      // Valid document → close dialog and go to the next sign-up step.
      // Pass mergedDetect so callers don't rely on stale React state.
      setDialogOpen(false)
      onContinue(mergedDetect)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while reading the document. Please try again."
      setDialogError(message)
      setTypeStatus("rejected")
      onSetFieldError("proofOfResidency", message)
    } finally {
      setVerifyingOcr(false)
    }
  }

  function handlePrimaryAction() {
    if (!isApproved) return
    // Re-use last known detect from parent (already approved earlier).
    onContinue(proofDetect)
  }

  const busy = verifyingOcr || checkingSide !== null

  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>{title}</StepTitle>

      <div className="mt-8 space-y-4">
        {proofOptionsLoading ? (
          <p className="text-sm text-muted-foreground">Loading document types…</p>
        ) : proofOptions.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Document choices are loading. If nothing appears, go back and try again in a moment.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onRefreshProofOptions()}
              className="h-10 rounded-full px-6 text-sm font-semibold"
            >
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Document type">
            {proofOptions.map((option) => {
              const selected = selectedType === option.key
              const disabled =
                !canCaptureProof || busy || typesLocked
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => openUploadDialog(option)}
                  className={cn(
                    // Same light-grey card for every option (no check / close icons)
                    "group relative flex w-full items-center gap-3 rounded-2xl bg-tint px-4 py-3.5 text-left text-neutral-800 transition-[background-color,transform] duration-150 ease-out hover:bg-tint active:scale-[0.99] disabled:cursor-not-allowed",
                    typesLocked && !selected && "opacity-50",
                    typesLocked && selected && "opacity-100",
                    !typesLocked && "disabled:opacity-50",
                  )}
                >
                  <BoxIdCardIcon
                    // Always regular at rest; solid only on hover/focus (group).
                    solid={false}
                    className="shrink-0 text-neutral-800"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight tracking-tight">
                      {option.name}
                    </span>
                    {option.description?.trim() ? (
                      <span className="mt-0.5 block text-xs font-medium leading-snug text-neutral-500">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {proofCaptureBlockedReason ? (
          <p className="text-sm text-foreground">{proofCaptureBlockedReason}</p>
        ) : null}

        {/* Rejection / field errors only (no check/X on the ID cards). */}
        {isRejected && feedbackError ? <FieldError>{feedbackError}</FieldError> : null}
        {!isRejected && (errors.proofOfResidency || errors.proofType) ? (
          <FieldError>{errors.proofOfResidency || errors.proofType}</FieldError>
        ) : null}
      </div>

      {/* Shown if the user returns here with a valid proof already attached. */}
      {isApproved ? (
        <StepContinueButton
          onClick={handlePrimaryAction}
          disabled={!canCaptureProof || busy}
        >
          Continue
        </StepContinueButton>
      ) : null}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog()
          else setDialogOpen(true)
        }}
      >
        <DialogContent
          overlayClassName="bg-black/55"
          className={cn(
            "border-0 bg-white p-0 shadow-2xl",
            "left-0 right-0 top-auto bottom-0 max-h-[90vh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none",
            "sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(100%-2rem,26rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          )}
        >
          <div className="mx-auto w-full px-6 pb-8 pt-3 sm:px-7 sm:pb-7 sm:pt-7">
            <div
              className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-300 sm:hidden"
              aria-hidden
            />

            <h2 className="text-xl font-semibold leading-snug tracking-tight text-neutral-900">
              {dialogOption ? `Upload your ${dialogOption.name}` : "Upload document"}
            </h2>
            <p className="mt-2 flex items-start gap-2 text-sm leading-snug text-neutral-500">
              <ShieldCheckIcon
                className="mt-0.5 size-4 shrink-0 text-neutral-400"
                strokeWidth={2}
              />
              <span>
                {requiredSides.length > 1
                  ? "Add clear photos of both sides. We’ll review them before you continue."
                  : "Add a clear photo of your ID. We’ll review it before you continue."}
              </span>
            </p>

            <div className="mt-5 space-y-2">
              {requiredSides.map((side, index) => {
                const file = acceptedFiles[index]
                const preview = previewUrls[index]
                const err = sideErrors[index]
                const isChecking = checkingSide === index
                const label = sideLabel(side)
                const hasFile = Boolean(file && preview && !isChecking)
                // Only this row’s own error — never paint Front+Back red from one failure.
                const showError = Boolean(err)
                return (
                  <div key={side}>
                    <div
                      role="button"
                      tabIndex={busy ? -1 : 0}
                      onClick={() => {
                        if (!busy) pickSide(index)
                      }}
                      onKeyDown={(e) => {
                        if (busy) return
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          pickSide(index)
                        }
                      }}
                      className={cn(
                        "relative flex w-full cursor-pointer items-center rounded-xl border-2 px-3 py-3.5 transition-colors",
                        hasFile ? "gap-3 text-left" : "justify-center text-center",
                        showError
                          ? "border-[3px] border-destructive bg-neutral-100/40"
                          : "border-input",
                        busy && !isChecking
                          ? "cursor-not-allowed opacity-60"
                          : !showError && "hover:bg-neutral-50",
                        isChecking && "cursor-wait",
                      )}
                      aria-invalid={showError || undefined}
                      aria-label={file ? `Replace ${label}` : `Upload ${label}`}
                    >
                      {hasFile ? (
                        <button
                          type="button"
                          className={cn(
                            "size-14 shrink-0 overflow-hidden rounded-lg border-2 bg-white",
                            showError ? "border-destructive" : "border-input",
                          )}
                          onClick={(e) => {
                            e.stopPropagation()
                            setFullPreviewUrl(preview)
                          }}
                          aria-label={`Preview ${label}`}
                        >
                          <img
                            src={preview!}
                            alt=""
                            className="size-full object-cover"
                          />
                        </button>
                      ) : null}

                      <div
                        className={cn(
                          "min-w-0",
                          hasFile ? "flex-1 text-left" : "text-center",
                        )}
                      >
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            showError ? "text-destructive" : "text-foreground",
                          )}
                        >
                          {label}
                        </p>
                        {isChecking ? (
                          <p
                            className={cn(
                              "mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground",
                              !hasFile && "justify-center",
                            )}
                          >
                            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
                            <span>{checkStatus || "Running checks…"}</span>
                          </p>
                        ) : (
                          <p
                            className={cn(
                              "mt-0.5 text-xs",
                              showError ? "text-destructive/80" : "text-muted-foreground",
                            )}
                          >
                            {file ? "Tap to replace" : "Tap to upload"}
                          </p>
                        )}
                      </div>

                      {hasFile ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeSide(index)
                          }}
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-neutral-100",
                            showError ? "text-destructive" : "text-black",
                          )}
                          aria-label={`Remove ${label}`}
                        >
                          <XIcon className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    {err ? <FieldError className="mt-1.5 text-left">{err}</FieldError> : null}
                  </div>
                )
              })}
            </div>

            {/* Global dialog messages only (e.g. missing both sides) — not per-side forensics. */}
            {dialogError && !sideErrors.some(Boolean) ? (
              <FieldError className="mt-3 text-left">{dialogError}</FieldError>
            ) : null}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void handleFileSelected(e.target.files)}
            />

            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy || !allSidesAccepted}
                onClick={() => void runOcrVerify()}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-white shadow-sm transition-[transform,colors,filter] duration-150 ease-out hover:bg-brand-orange-strong active:scale-[0.96] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifyingOcr ? (
                  <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  "Verify"
                )}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={closeDialog}
                className="inline-flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-black transition-colors hover:bg-neutral-100 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {fullPreviewUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Document full preview"
          onClick={() => setFullPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setFullPreviewUrl(null)}
            className="absolute top-1/2 right-4 z-[101] flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black text-white shadow-lg transition-colors hover:bg-neutral-900"
            aria-label="Close preview"
          >
            <XIcon className="size-5" strokeWidth={2.5} />
          </button>
          <img
            src={fullPreviewUrl}
            alt="Document full preview"
            className="max-h-[90vh] max-w-[min(100%,56rem)] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  )
}
