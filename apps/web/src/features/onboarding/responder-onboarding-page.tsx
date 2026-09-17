import { useState } from "react"

import { cn } from "@workspace/ui/lib/utils"
import { completeOnboard } from "@/features/auth/api"

const steps = [
  "Answer the call",
  "Get there faster",
  "Close the loop",
]

export default function ResponderOnboardingPage() {
  const [step, setStep] = useState(0)
  const current = steps[step]
  const isLast = step === steps.length - 1

  async function finishOnboard() {
    try {
      await completeOnboard()
    } catch { /* ignore */ }
    window.location.href = "/dashboard"
  }

  function handleNext() {
    if (isLast) {
      void finishOnboard()
    } else {
      setStep((s) => s + 1)
    }
  }

  function handleSkip() {
    void finishOnboard()
  }

  function handleBack() {
    if (step > 0) setStep((s) => s - 1)
  }

  return (
    <div className="flex min-h-svh flex-col items-center bg-white px-6 pt-6">
      <div className="flex items-center gap-1.5" role="tablist" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === step} aria-label={`Go to step ${i + 1}`} onClick={() => setStep(i)} className={cn("block h-2 rounded-full transition-all duration-300", i === step ? "w-7 bg-accent" : "w-2 bg-muted-foreground/25")} />
        ))}
      </div>
      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center py-8 text-center">
        <h1 className="font-heading text-3xl font-bold text-foreground">{current}</h1>
      </div>
      <div className="flex w-full max-w-sm gap-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {isLast ? (
          <button
            type="button"
            onClick={handleNext}
            className="h-16 flex-1 rounded-full bg-accent text-base font-semibold text-white transition-colors hover:bg-brand-orange-strong"
          >
            Get Started
          </button>
        ) : (
          <>
            {step === 0 ? (
              <button
                type="button"
                onClick={handleSkip}
                className="h-16 flex-[0.75] rounded-full bg-neutral-100 text-[15px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
              >
                Skip
              </button>
            ) : (
              <button
                type="button"
                onClick={handleBack}
                className="h-16 flex-[0.75] rounded-full bg-neutral-100 text-[15px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              className="h-16 flex-[1.25] rounded-full bg-accent text-base font-semibold text-white transition-colors hover:bg-brand-orange-strong"
            >
              Next
            </button>
          </>
        )}
      </div>
    </div>
  )
}
