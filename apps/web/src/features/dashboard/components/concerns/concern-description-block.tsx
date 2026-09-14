import type { ReactNode } from "react"
import { CircleCheck, TriangleAlertIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { concernSummaryText } from "@/features/dashboard/components/feed-post-text"

function cleanCopy(value?: string | null) {
  return (value || "").trim()
}

/**
 * The canonical concern copy layout used by feeds, maps, and report details:
 * the resident's submission first, followed by the generated summary when it
 * adds information that is not already in the submission.
 */
export function ConcernDescriptionBlock({
  title,
  description,
  summary,
  className,
  descriptionClassName,
  summaryClassName,
  summaryTone = "default",
  summaryPlain = false,
  afterDescription,
}: {
  title?: string | null
  description?: string | null
  summary?: string | null
  className?: string
  descriptionClassName?: string
  summaryClassName?: string
  summaryTone?: "default" | "resolved" | "critical"
  summaryPlain?: boolean
  afterDescription?: ReactNode
}) {
  const submitted = cleanCopy(description)
  const generated = summaryPlain
    ? cleanCopy(summary)
    : concernSummaryText({ title, description, summary })
  const resolvedTone = summaryTone === "resolved"
  const criticalTone = summaryTone === "critical"

  return (
    <div className={cn("space-y-1.5", className)}>
      {submitted ? (
        <p
          className={cn(
            "leading-relaxed whitespace-pre-wrap text-neutral-900",
            descriptionClassName
          )}
        >
          {submitted}
        </p>
      ) : null}
      {resolvedTone ? (
        (generated || afterDescription) && (
          <div className="flex w-full items-start gap-1.5 rounded-lg bg-status-closed-surface px-2 py-[7px] text-status-closed-ink">
            <CircleCheck
              className="mt-0.5 size-4 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <div className="min-w-0 flex-1 space-y-1 leading-[1.4]">
              {generated ? (
                <p className={cn("whitespace-pre-wrap", summaryClassName)}>
                  {generated}
                </p>
              ) : null}
              {afterDescription}
            </div>
          </div>
        )
      ) : (
        <>
          {afterDescription}
          {generated ? (
            summaryPlain ? (
              <p
                className={cn(
                  "leading-relaxed whitespace-pre-wrap",
                  summaryClassName
                )}
              >
                {generated}
              </p>
            ) : (
              <div
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-3 py-2.5",
                  criticalTone
                    ? "bg-severity-critical-map-surface text-severity-critical-map-ink"
                    : "bg-brand-orange-soft text-orange-800"
                )}
              >
                <TriangleAlertIcon
                  className="mt-[2px] size-5 shrink-0"
                  strokeWidth={1.9}
                  aria-hidden
                />
                <p
                  className={cn(
                    "min-w-0 flex-1 leading-relaxed whitespace-pre-wrap",
                    summaryClassName
                  )}
                >
                  {generated}
                </p>
              </div>
            )
          ) : null}
        </>
      )}
      {!submitted && !generated ? (
        <p className="text-[13px] leading-relaxed text-neutral-500">
          No description provided.
        </p>
      ) : null}
    </div>
  )
}
