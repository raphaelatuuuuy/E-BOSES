import { cn } from "@workspace/ui/lib/utils"
import type {
  EmergencyQuickQuestion,
  EmergencyQuickQuestionChoice,
} from "@/features/dashboard/emergency-api"
import type { SosTriageAnswers } from "@/features/dashboard/components/sos-fallback"
import { defaultQuickQuestionsForCategory } from "@/features/dashboard/components/sos/sos-questions"

function BigChoiceRow({
  question,
  choices,
  value,
  onSelect,
}: {
  question: string
  choices: EmergencyQuickQuestionChoice[]
  value?: string
  onSelect: (value: string) => void
}) {
  return (
    <fieldset className="mb-6">
      <legend className="mb-3 text-[16px] font-semibold text-white">
        {question} <span aria-hidden="true" className="text-brand-orange">*</span>
      </legend>
      <div
        className={cn(
          "grid gap-2",
          choices.length >= 4
            ? "grid-cols-2"
            : choices.length === 3
              ? "grid-cols-3"
              : "grid-cols-2"
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
                "min-h-14 rounded-2xl border px-3 py-3 text-[15px] font-semibold transition-all",
                selected
                  ? "border-transparent bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_8px_20px_rgba(242,84,27,0.45)]"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/15"
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

export function questionsForCategory(
  categoryCode: string,
  configuredQuestions?: EmergencyQuickQuestion[]
) {
  return configuredQuestions?.length
    ? configuredQuestions
    : defaultQuickQuestionsForCategory(categoryCode)
}

export function hasUnansweredQuestions(
  answers: SosTriageAnswers,
  questions: EmergencyQuickQuestion[]
) {
  return questions.some((question) => !answers[question.key])
}

export function hasDetailQuestion(categoryCode: string) {
  return questionsForCategory(categoryCode).some(
    (question) => question.key === "detail"
  )
}

export function SosTriageStep({
  categoryCode,
  questions,
  value,
  onChange,
  error,
}: {
  categoryCode: string
  questions?: EmergencyQuickQuestion[]
  value: SosTriageAnswers
  onChange: (next: SosTriageAnswers) => void
  error?: string
}) {
  const activeQuestions = questionsForCategory(categoryCode, questions)

  function set(key: string, next: string) {
    onChange({ ...value, [key]: next || undefined })
  }

  return (
    <div>
      <p className="mb-5 text-[14px] leading-6 text-white/70">
        Answer each so responders bring the right help. All questions are
        required.
      </p>

      {activeQuestions.map((question) => (
        <BigChoiceRow
          key={question.key}
          question={question.question}
          choices={question.choices}
          value={value[question.key]}
          onSelect={(next) => set(question.key, next)}
        />
      ))}

      {error ? (
        <p
          className="mt-2 text-[13px] font-medium text-sos-bright"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
