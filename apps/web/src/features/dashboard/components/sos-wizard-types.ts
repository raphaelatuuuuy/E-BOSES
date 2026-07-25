import type { EmergencyType } from "@/features/dashboard/emergency-api"
import type { SosLocationValue } from "@/features/dashboard/components/sos-location-step"

export type WizardStep = "category" | "location" | "details" | "review" | "countdown"

export const WIZARD_STEPS: WizardStep[] = [
  "category",
  "location",
  "details",
  "review",
  "countdown",
]

export function stepIndex(step: WizardStep) {
  return WIZARD_STEPS.indexOf(step) + 1
}

export type WizardState = {
  step: WizardStep
  emergency: EmergencyType | ""
  note: string
  location: SosLocationValue | null
  mediaFiles: File[]
  fieldErrors: Record<string, string>
  submitError: string
  submitting: boolean
  dispatchCountdown: number
}

export type WizardAction =
  | { type: "RESET" }
  | { type: "SET_STEP"; step: WizardStep }
  | { type: "SET_EMERGENCY"; emergency: EmergencyType | "" }
  | { type: "SET_NOTE"; note: string }
  | { type: "SET_LOCATION"; location: SosLocationValue | null }
  | { type: "SET_MEDIA_FILES"; mediaFiles: File[] }
  | { type: "SET_FIELD_ERRORS"; fieldErrors: Record<string, string> }
  | { type: "SET_SUBMIT_ERROR"; submitError: string }
  | { type: "SET_SUBMITTING"; submitting: boolean }
  | { type: "DECREMENT_COUNTDOWN" }
  | { type: "SET_COUNTDOWN"; dispatchCountdown: number }
