/* eslint-disable react-refresh/only-export-components */
import { useState } from "react"
import { ChevronLeft } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { completeOnboard } from "@/features/auth/api"

const steps = [
  { imgMb: "/contents/onboarding-1-mb.png", img: "/contents/onboarding-1.png", title: "Report a Concern", description: "Easily submit reports about road issues, flood concerns, or any community problem. Your voice matters in making our barangay better." },
  { imgMb: "/contents/onboarding-2-mb.png", img: "/contents/onboarding-2.png", title: "Emergency Alert", description: "Send instant emergency alerts with your location. First responders and barangay officials are notified immediately to provide assistance." },
  { imgMb: "/contents/onboarding-3-mb.png", img: "/contents/onboarding-3.png", title: "Stay Connected", description: "Keep up with barangay announcements, community events, and updates. Engage with your neighbors and local officials in one place." },
  { img: "/contents/onboarding-4.png", title: "You're All Set!", description: "You now have access to report concerns, send alerts, and stay connected. Let's work together for a better barangay." },
]

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [isMobile] = useState(() => window.innerWidth < 768)
  const current = steps[step]
  const imgSrc = (isMobile && current.imgMb) ? current.imgMb : current.img
  const isLast = step === steps.length - 1

  async function finishOnboard() {
    try {
      await completeOnboard()
    } catch { /* ignore */ }
    window.location.href = "/dashboard/home"
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

  // Mobile last step: everything centered as one group, image edge-to-edge
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

  // Desktop last step and all other steps: image fills top, content below
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
