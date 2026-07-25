import { CheckCircle, Spinner, XCircle as XCircleIcon } from "@phosphor-icons/react"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { ProofStep } from "@/features/auth/components/sign-up-steps/proof-step"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"
import type { ResidenceProofOption } from "@/features/ocr/api"
import type { ResidenceProofDetectResult } from "@/features/auth/api"

export function NameFormStep({
  firstName,
  middleName,
  lastName,
  error,
  nameOk,
  onFirstNameChange,
  onMiddleNameChange,
  onLastNameChange,
  onContinue,
}: {
  firstName: string
  middleName: string
  lastName: string
  error: string
  nameOk: boolean
  onFirstNameChange: (value: string) => void
  onMiddleNameChange: (value: string) => void
  onLastNameChange: (value: string) => void
  onContinue: () => void
}) {
  return (
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
          onChange={(e) => onFirstNameChange(e.target.value)}
          autoComplete="given-name"
        />
        <FloatingLabelInput
          id="reverify-middle-name"
          label="Middle name (optional)"
          value={middleName}
          onChange={(e) => onMiddleNameChange(e.target.value)}
          autoComplete="additional-name"
        />
        <FloatingLabelInput
          id="reverify-last-name"
          label="Last name"
          value={lastName}
          onChange={(e) => onLastNameChange(e.target.value)}
          autoComplete="family-name"
        />
      </div>
      {error ? (
        <p className="mt-2 text-[13px] font-medium text-red-600">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={!nameOk}
        onClick={onContinue}
        className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
      >
        Continue
      </button>
    </>
  )
}

export function ProofUploadStep({
  values,
  errors,
  proofOptions,
  proofOptionsLoading,
  proofDetect,
  onValueChange,
  onErrorChange,
  onContinue,
  onProofDetectChange,
}: {
  values: SignUpValues
  errors: SignUpErrors
  proofOptions: ResidenceProofOption[]
  proofOptionsLoading: boolean
  proofDetect: ResidenceProofDetectResult | null
  onValueChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onErrorChange: (field: keyof SignUpValues, message: string | undefined) => void
  onContinue: (detect?: ResidenceProofDetectResult | null) => void
  onProofDetectChange: (detect: ResidenceProofDetectResult | null) => void
}) {
  return (
    <ProofStep
      title="Upload proof of identity"
      values={values}
      errors={errors}
      proofOptions={proofOptions}
      proofOptionsLoading={proofOptionsLoading}
      canCaptureProof
      proofCaptureBlockedReason={null}
      onChange={onValueChange}
      onSetFieldError={onErrorChange}
      onRefreshProofOptions={async () => proofOptions}
      onContinue={onContinue}
      proofDetect={proofDetect}
      onProofDetectChange={onProofDetectChange}
    />
  )
}

export function VerifyResultStep({
  busy,
  matchOk,
  saved,
  onDone,
  onRetryProof,
  onEditName,
}: {
  busy: boolean
  matchOk: boolean | null
  saved: boolean
  onDone: () => void
  onRetryProof: () => void
  onEditName: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center pt-8 text-center">
      {busy && matchOk !== false ? (
        <>
          <Spinner className="size-12 animate-spin text-neutral-400" />
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
            <CheckCircle className="size-10" />
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
            onClick={onDone}
            className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
          >
            {busy ? (
              <Spinner className="size-4 animate-spin" />
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
            <XCircleIcon className="size-10" />
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
            onClick={onRetryProof}
            className="mt-10 flex h-12 w-full max-w-sm items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e]"
          >
            Try again
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onEditName}
            className="mt-3 flex h-11 w-full max-w-sm items-center justify-center text-[14px] font-semibold text-neutral-700"
          >
            Edit name
          </button>
        </>
      )}
    </div>
  )
}
