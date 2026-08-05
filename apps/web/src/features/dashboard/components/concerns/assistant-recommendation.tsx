import { SparklesIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import type { Concern } from "@/features/dashboard/api"
import { recommendedAction } from "@/features/dashboard/lib/plain-language"

/**
 * The assistant's suggestion, sitting directly above the controls it fills in.
 *
 * Two sentences and a button. The full findings live in the Review Assistant on
 * the Details tab; repeating them here would put the same text on screen twice
 * and make the pane that is supposed to be *for deciding* mostly about reading.
 *
 * Apply Suggestion writes to the form and nothing else. It does not save,
 * approve, reject, assign, or finalize — an official still has to read what was
 * filled in and press Save Update, and they are free to change or ignore any of
 * it. That separation is the whole point: the model advises, the person decides.
 */
export function AssistantRecommendation({
  report,
  categoryLabel,
  onApply,
  applied,
}: {
  report: Concern
  /** Resolves a category key to the name officials see. */
  categoryLabel: (key: string) => string
  onApply: () => void
  applied: boolean
}) {
  const ai = report.ai_assessment
  if (!ai || ai.status === "failed" || ai.status === "not_configured") return null

  const suggestedCategory = ai.suggested_category || ""
  const action = recommendedAction(ai.recommended_action || "manual_review")
  if (!suggestedCategory && !ai.recommended_action) return null

  return (
    <div className="rounded-xl border border-card-line bg-card p-3">
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-3.5 shrink-0 text-brand-orange" />
        <p className="text-xs font-semibold text-brand-navy">Assistant recommendation</p>
      </div>

      <dl className="mt-2.5 space-y-2">
        {suggestedCategory ? (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
              Suggested category
            </dt>
            <dd className="mt-0.5 text-sm font-semibold text-foreground">{categoryLabel(suggestedCategory)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
            Suggested next step
          </dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-foreground">{action.label}</dd>
        </div>
      </dl>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onApply}
        className="mt-3 w-full"
      >
        {applied ? "Suggestion applied" : "Apply suggestion"}
      </Button>
      <p className="mt-2 text-[11px] font-medium leading-4 text-subtle-foreground">
        This fills in the form below. Nothing is saved until you press Save update.
      </p>
    </div>
  )
}
