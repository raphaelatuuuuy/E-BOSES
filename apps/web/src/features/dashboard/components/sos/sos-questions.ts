import type { EmergencyQuickQuestion } from "@/features/dashboard/emergency-api"

const COMMON_QUESTIONS: EmergencyQuickQuestion[] = [
  {
    key: "people_affected",
    question: "How many people are affected?",
    choices: [
      { value: "one", label: "Just 1" },
      { value: "few", label: "2–5" },
      { value: "many", label: "6 or more" },
      { value: "unknown", label: "Not sure" },
    ],
  },
  {
    key: "injuries",
    question: "Is anyone injured or trapped?",
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
      { value: "unknown", label: "Not sure" },
    ],
  },
]

const DETAIL_QUESTIONS: Record<string, EmergencyQuickQuestion> = {
  fire: {
    key: "detail",
    question: "Is the fire still spreading?",
    choices: [
      { value: "spreading", label: "Yes, spreading" },
      { value: "contained", label: "No, contained" },
    ],
  },
  medical: {
    key: "detail",
    question: "Is the person conscious and breathing?",
    choices: [
      { value: "conscious", label: "Yes" },
      { value: "unconscious", label: "No" },
    ],
  },
  flood: {
    key: "detail",
    question: "How deep is the water?",
    choices: [
      { value: "ankle", label: "Ankle deep" },
      { value: "knee", label: "Knee deep" },
      { value: "waist", label: "Waist or higher" },
    ],
  },
  crime: {
    key: "detail",
    question: "Is the person still there?",
    choices: [
      { value: "present", label: "Yes, still there" },
      { value: "gone", label: "No, left" },
    ],
  },
  domestic_violence: {
    key: "detail",
    question: "Is anyone in immediate danger right now?",
    choices: [
      { value: "immediate_danger", label: "Yes" },
      { value: "no_immediate_danger", label: "No" },
    ],
  },
  child_protection: {
    key: "detail",
    question: "Is the child in immediate danger right now?",
    choices: [
      { value: "immediate_danger", label: "Yes" },
      { value: "no_immediate_danger", label: "No" },
    ],
  },
  disaster: {
    key: "detail",
    question: "Is anyone trapped?",
    choices: [
      { value: "trapped", label: "Yes" },
      { value: "not_trapped", label: "No" },
    ],
  },
}

function cloneQuestion(
  question: EmergencyQuickQuestion
): EmergencyQuickQuestion {
  return {
    ...question,
    choices: question.choices.map((choice) => ({ ...choice })),
  }
}

/** Build-time fallback for old cached categories and the bundled offline copy. */
export function defaultQuickQuestionsForCategory(code: string) {
  const questions = COMMON_QUESTIONS.map(cloneQuestion)
  const detail = DETAIL_QUESTIONS[code]
  if (detail) questions.push(cloneQuestion(detail))
  return questions
}

export const DEFAULT_SOS_QUICK_QUESTIONS =
  defaultQuickQuestionsForCategory("other")
