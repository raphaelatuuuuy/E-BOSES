import { cn } from "@workspace/ui/lib/utils"
import type { SosTriageAnswers } from "@/features/dashboard/components/sos-fallback"

/**
 * Triage questions, asked before location so dispatch knows what it is sending
 * people into. Every question is skippable: a resident under stress must never
 * be blocked from sending help because they could not answer a question.
 */

type Choice = { value: string; label: string }

const PEOPLE_CHOICES: Choice[] = [
  { value: "one", label: "Just 1" },
  { value: "few", label: "2–5" },
  { value: "many", label: "6 or more" },
  { value: "unknown", label: "Not sure" },
]

const INJURY_CHOICES: Choice[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Not sure" },
]

/** Third question, by category code. Categories without one skip it. */
const DETAIL_QUESTIONS: Record<string, { question: string; choices: Choice[] }> = {
  fire: {
    question: "Is the fire still spreading?",
    choices: [
      { value: "spreading", label: "Yes, spreading" },
      { value: "contained", label: "No, contained" },
    ],
  },
  medical: {
    question: "Is the person conscious and breathing?",
    choices: [
      { value: "conscious", label: "Yes" },
      { value: "unconscious", label: "No" },
    ],
  },
  flood: {
    question: "How deep is the water?",
    choices: [
      { value: "ankle", label: "Ankle deep" },
      { value: "knee", label: "Knee deep" },
      { value: "waist", label: "Waist or higher" },
    ],
  },
  crime: {
    question: "Is the person still there?",
    choices: [
      { value: "present", label: "Yes, still there" },
      { value: "gone", label: "No, left" },
    ],
  },
  domestic_violence: {
    question: "Is anyone in immediate danger right now?",
    choices: [
      { value: "immediate_danger", label: "Yes" },
      { value: "no_immediate_danger", label: "No" },
    ],
  },
  child_protection: {
    question: "Is the child in immediate danger right now?",
    choices: [
      { value: "immediate_danger", label: "Yes" },
      { value: "no_immediate_danger", label: "No" },
    ],
  },
  dangerous_animal: {
    question: "Is the animal still loose?",
    choices: [
      { value: "loose", label: "Yes, still loose" },
      { value: "animal_contained", label: "No, contained" },
    ],
  },
  disaster: {
    question: "Is anyone trapped?",
    choices: [
      { value: "trapped", label: "Yes" },
      { value: "not_trapped", label: "No" },
    ],
  },
}

function BigChoiceRow({
  question,
  choices,
  value,
  onSelect,
}: {
  question: string
  choices: Choice[]
  value?: string
  onSelect: (value: string) => void
}) {
  return (
    <fieldset className="mb-6">
      <legend className="mb-3 text-[15px] font-semibold text-white">{question}</legend>
      <div
        className={cn(
          "grid gap-2",
          choices.length >= 4 ? "grid-cols-2" : choices.length === 3 ? "grid-cols-3" : "grid-cols-2",
        )}
      >
        {choices.map((choice) => {
          const selected = value === choice.value
          return (
            <button
              key={choice.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(selected ? "" : choice.value)}
              className={cn(
                "min-h-[3.5rem] rounded-2xl border px-3 py-3 text-[14px] font-semibold transition-colors",
                selected
                  ? "border-brand-orange bg-brand-orange text-white"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/15",
              )}
            >
              {choice.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function SosTriageStep({
  categoryCode,
  value,
  onChange,
}: {
  categoryCode: string
  value: SosTriageAnswers
  onChange: (next: SosTriageAnswers) => void
}) {
  const detail = DETAIL_QUESTIONS[categoryCode]

  function set<K extends keyof SosTriageAnswers>(key: K, next: string) {
    onChange({ ...value, [key]: (next || undefined) as SosTriageAnswers[K] })
  }

  return (
    <div>
      <p className="mb-5 text-[14px] leading-6 text-white/75">
        These help responders bring the right people and equipment. You can skip
        any question.
      </p>

      <BigChoiceRow
        question="How many people are affected?"
        choices={PEOPLE_CHOICES}
        value={value.peopleAffected}
        onSelect={(next) => set("peopleAffected", next)}
      />

      <BigChoiceRow
        question="Is anyone injured or trapped?"
        choices={INJURY_CHOICES}
        value={value.injuries}
        onSelect={(next) => set("injuries", next)}
      />

      {detail ? (
        <BigChoiceRow
          question={detail.question}
          choices={detail.choices}
          value={value.detail}
          onSelect={(next) => set("detail", next)}
        />
      ) : null}
    </div>
  )
}
