/* eslint-disable react-refresh/only-export-components */
import { useState } from "react"
import { ChevronLeft } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { completeOnboard } from "@/features/auth/api"

const steps = [
  { imgMb: "/contents/official-onboard-mb-1.png", img: "/contents/official-onboard-1.png", title: "Review concerns with confidence", description: "View submitted reports, locations, evidence, and AI-assisted assessments in one organized workspace." },
  { imgMb: "/contents/official-onboard-mb-2.png", img: "/contents/official-onboard-2.png", title: "Make informed decisions", description: "Use evidence, location details, and explainable AI insights to validate and prioritize community concerns." },
  { imgMb: "/contents/official-onboard-mb-3.png", img: "/contents/official-onboard-3.png", title: "Assign and coordinate action", description: "Assign responders, monitor progress, and keep residents informed from review to resolution." },
]

export default function OfficialOnboardingPage() {
  const [step, setStep] = useState(0)
  const [isMobile] = useState(() => window.innerWidth < 768)
  const current = steps[step]
  const imgSrc = (isMobile && current.imgMb) ? current.imgMb : current.img
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

  const content = (
    <div className="flex w-full max-w-sm flex-col items-center">
      <div className="mb-5 flex items-center gap-2" role="tablist" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((_, i) => (
          <span key={i} role="tab" aria-selected={i === step} className={`block rounded-full transition-all duration-300 ${i === step ? "h-2.5 w-8 bg-primary" : "h-2.5 w-2.5 bg-muted-foreground/25"}`} />
        ))}
      </div>
      <h1 className="mb-2 text-center font-heading text-2xl font-bold text-foreground">{current.title}</h1>
      <p className="mb-8 text-center text-sm leading-relaxed text-muted-foreground">{current.description}</p>
      <Button size="lg" className="w-full rounded-3xl text-base font-semibold md:max-w-sm" onClick={handleNext}>
        {isLast ? "Get Started" : "Next"}
      </Button>
      <div className="mt-4 flex w-full items-center justify-center md:max-w-sm">
        {step > 0 && (
          <button type="button" onClick={handleBack} className="flex items-center gap-1 text-sm text-muted-foreground/60 hover:text-muted-foreground">
            <ChevronLeft className="size-3.5" />
            Back
          </button>
        )}
        {!isLast && step > 0 && <span className="mx-4 text-muted-foreground/20">|</span>}
        {!isLast && (
          <button type="button" onClick={handleSkip} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Skip for now
          </button>
        )}
      </div>
    </div>
  )

  if (isLast && isMobile) {
    return (
      <div className="flex min-h-svh flex-col bg-white">
        <div className="flex flex-1 flex-col justify-center">
          <img src={imgSrc} alt="" className="w-full object-cover" />
          <div className="flex flex-col items-center px-6 pt-4 pb-8">
            {content}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col bg-white">
      <div className="relative flex-1 flex items-center justify-center md:flex-[5] md:py-8">
        <img src={imgSrc} alt="" className="w-full md:max-h-screen md:w-auto md:max-w-full" />
      </div>
      <div className="flex flex-col items-center px-6 pb-16 pt-6 md:pb-8">
        {content}
      </div>
    </div>
  )
}
