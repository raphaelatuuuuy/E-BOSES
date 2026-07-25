import { PhoneIcon } from "@phosphor-icons/react"

import type { WizardStep } from "@/features/dashboard/components/sos-wizard-types"

export function SosWizardFooter({
  step,
  submitting,
  isOnline,
  emergencySmsHref,
  onGoBack,
  onGoNext,
  onCancel,
}: {
  step: WizardStep
  submitting: boolean
  isOnline: boolean
  emergencySmsHref: string
  onGoBack: () => void
  onGoNext: () => void
  onCancel: () => void
}) {
  if (step !== "countdown") {
    return (
      <div className="flex gap-2">
        {step !== "category" ? (
          <button type="button" onClick={onGoBack}
            className="h-11 flex-1 rounded-full border border-white/20 bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15">
            Back
          </button>
        ) : null}
        {step === "review" && !isOnline ? (
          emergencySmsHref ? (
            <a href={emergencySmsHref} onClick={() => { /* fallback announcement handled by parent */ }}
              className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-full bg-[#ff6a1a] px-4 text-[14px] font-semibold text-white hover:bg-[#e85f17]">
              <PhoneIcon className="size-4" aria-hidden="true" />Open SMS backup
            </a>
          ) : (
            <button type="button" disabled className="h-11 flex-[1.4] rounded-full bg-white/15 px-4 text-[14px] font-semibold text-white/60">Reconnect to submit</button>
          )
        ) : (
          <button type="button" onClick={onGoNext}
            className="h-11 flex-[1.4] rounded-full bg-[#ff6a1a] text-[14px] font-semibold text-white hover:bg-[#e85f17]">
            {step === "details" ? "Skip / Next" : step === "review" ? "Send SOS in 5 seconds" : "Next"}
          </button>
        )}
      </div>
    )
  }

  return (
    <button type="button" onClick={onCancel} disabled={submitting}
      className="h-11 w-full rounded-full border border-white/25 bg-white text-[14px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60">
      {submitting ? "Sending…" : "Cancel before send"}
    </button>
  )
}
