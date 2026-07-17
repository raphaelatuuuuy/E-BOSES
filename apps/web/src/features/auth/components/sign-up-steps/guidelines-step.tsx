import {
  AlertTriangleIcon,
  BadgeCheckIcon,
  BanIcon,
  HeartHandshakeIcon,
  LockIcon,
  SmileIcon,
} from "lucide-react"

import { FieldError } from "@workspace/ui/components/field"

import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"

interface GuidelinesStepProps {
  firstName: string
  isSubmitting: boolean
  submitError?: string
  onUnderstand: () => void
}

const GUIDELINES = [
  {
    icon: BadgeCheckIcon,
    title: "Be truthful",
    body: "Submit accurate concern reports and real emergency alerts only.",
  },
  {
    icon: BanIcon,
    title: "Do no harm",
    body: "Don't share sensitive information, violate a neighbour's rights, or do anything that could hurt someone or put them in danger.",
  },
  {
    icon: SmileIcon,
    title: "All are welcome",
    body: "Racism, hateful language, and discrimination are expressly prohibited.",
  },
  {
    icon: HeartHandshakeIcon,
    title: "Be helpful",
    body: "Keep posts and conversations constructive, even when opinions differ.",
  },
  {
    icon: AlertTriangleIcon,
    title: "Emergencies are serious",
    body: "Use SOS for real threats so responders can respond quickly.",
  },
  {
    icon: LockIcon,
    title: "Your data stays local",
    body: "Personal info and IDs are used for barangay verification and service delivery under the Data Privacy Act.",
  },
] as const

export function GuidelinesStep({
  isSubmitting,
  submitError,
  onUnderstand,
}: GuidelinesStepProps) {
  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle className="max-w-[34rem] text-[1.625rem] font-semibold leading-[1.25] tracking-tight text-[#1a1a1a] md:text-[1.75rem]">
        One last thing! Let&apos;s all do our part to keep
        <br />
        E-Boses safe and fun.
      </StepTitle>

      <div className="mt-10 space-y-7">
        {GUIDELINES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-3.5">
            <Icon
              className="mt-0.5 size-5 shrink-0 text-neutral-900"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="min-w-0">
              <h2 className="text-[1.05rem] font-semibold leading-snug text-neutral-900">
                {title}
              </h2>
              <p className="mt-1.5 text-[0.95rem] leading-relaxed text-neutral-600">{body}</p>
            </div>
          </div>
        ))}
      </div>

      {submitError ? <FieldError className="mt-6">{submitError}</FieldError> : null}

      <StepContinueButton onClick={onUnderstand} loading={isSubmitting} disabled={isSubmitting}>
        I understand
      </StepContinueButton>
    </div>
  )
}
