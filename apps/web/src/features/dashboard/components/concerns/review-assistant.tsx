import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronDownIcon,
  CopyIcon,
  EyeOffIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { Concern } from "@/features/dashboard/api"
import {
  PHOTO_STATE,
  PHOTO_STATE_BADGE,
  PRIVACY_STATE,
  PRIVACY_STATE_BADGE,
  PRIVACY_UNCHECKED,
  observedObjectLabel,
  photoStateOf,
  recommendedAction,
} from "@/features/dashboard/lib/plain-language"
import { concernFlagReasons } from "@/features/dashboard/lib/concern-signals"

/**
 * The one place AI findings are shown.
 *
 * This replaced `AiGuidancePanel`, which reported four disconnected numbers —
 * "Image Detection (YOLO)", a percentage nobody could calibrate, a model
 * version string — and sat beside a separate flag-chip block and a separate
 * evidence card that restated the same finding in different words. A report
 * with a photo could read "No supported object" in one card and "Photo doesn't
 * match category" in the next.
 *
 * The rule here: the assistant summarises the automatic review **once**. The
 * Update Report panel holds the controls and a one-line recommendation, and
 * nothing else repeats it.
 *
 * It reads as a short written note because that is what it is — an assistant's
 * opinion, offered to someone who will decide for themselves. It is not a chat:
 * there is no input box and no conversation history, because there is nothing
 * to reply to.
 */

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "good" | "alert" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold",
        tone === "good" && "bg-status-closed-surface text-status-closed-ink",
        tone === "warn" && "bg-severity-moderate-surface text-severity-moderate-ink",
        tone === "alert" && "bg-severity-critical-surface text-severity-critical-ink",
        tone === "neutral" && "bg-card-raised text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-wide text-subtle-foreground">{title}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-body leading-6 text-foreground">
          <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-subtle-foreground" />
          {/* break-words so a long model sentence cannot push the pane wide */}
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** The photo whose privacy state the assistant reports on — the first image. */
function primaryImage(report: Concern) {
  return report.media?.find((item) => item.mime_type.startsWith("image/")) ?? null
}

export function ReviewAssistant({ report }: { report: Concern }) {
  const navigate = useNavigate()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const ai = report.ai_assessment
  const status = ai?.status ?? "not_configured"
  const image = primaryImage(report)
  const hasPhoto = Boolean(image)

  // Nothing to summarise. One block, no empty sections pretending to be
  // findings, and an explicit statement that the report is unaffected.
  if (!ai || status === "failed" || status === "not_configured") {
    return (
      <section className="rounded-panel border border-severity-moderate/40 bg-severity-moderate-surface p-4">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-severity-moderate-ink" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-severity-moderate-ink">AI Review Temporarily Unavailable</p>
            <p className="mt-1 text-body leading-6 text-severity-moderate-ink">
              The report could not be analyzed automatically at this time. Continue with the normal manual-review
              process. The report remains available and unaffected.
            </p>
          </div>
        </div>
      </section>
    )
  }

  /**
   * Not finished yet — so there are no findings, and we must not invent any.
   *
   * A pending assessment is a row of unset defaults: `category_match` is null,
   * `urgent_attention` is false, `privacy_state` is the column default. Reading
   * those as results produced a card that confidently announced "The report may
   * not match the category the resident selected", "No immediate danger was
   * identified" and "No sensitive details requiring automatic protection were
   * identified" about a report nothing had looked at yet — three claims, none
   * of them earned, next to a "Photo Review in Progress" badge saying so.
   *
   * Reports submitted before the review pipeline existed sit here permanently
   * until someone re-runs them, which is exactly when a confident-looking card
   * is most misleading.
   */
  if (status === "pending") {
    return (
      <section className="rounded-panel border border-status-active/40 bg-status-active-surface p-4">
        <div className="flex items-start gap-3">
          <SparklesIcon className="mt-0.5 size-4 shrink-0 text-status-active-ink" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-status-active-ink">Automatic review has not finished</p>
            <p className="mt-1 text-body leading-6 text-status-active-ink">
              This report has not been checked automatically yet, so there is nothing to report on the description,
              the photo, or privacy. You can review and act on it now — the check is not required.
            </p>
          </div>
        </div>
      </section>
    )
  }

  const photoState = photoStateOf({
    hasPhoto,
    assessmentStatus: status,
    imageReviewSucceeded: ai.image_review_succeeded,
    evidenceRelationship: ai.evidence_relationship,
  })

  const objects = (ai.detected_objects ?? []).filter(Boolean).map(observedObjectLabel)
  const missing = ai.missing_information ?? []
  const action = recommendedAction(ai.recommended_action || "manual_review")

  // "What Was Found" is assembled here rather than in the markup so the bullets
  // stay a list of statements — each one either true and shown, or absent.
  const findings: string[] = []
  if (ai.text_assessment) findings.push(ai.text_assessment)
  // `category_match` is a nullable boolean. Only `false` is a mismatch — `null`
  // means it was never decided, and reading that as "may not match" invents a
  // problem the review never reported.
  if (ai.category_match === true) {
    findings.push("The selected category matches the concern.")
  } else if (ai.category_match === false) {
    findings.push("The report may not match the category the resident selected.")
  }
  if (hasPhoto) findings.push(PHOTO_STATE[photoState].label)
  // Past the pending guard the review has completed, so "no danger" is a
  // finding the model actually reported rather than an unset default.
  findings.push(
    ai.urgent_attention
      ? "This may describe immediate danger."
      : "No immediate danger was identified.",
  )
  if (ai.possible_duplicate) findings.push("A very similar report was filed nearby.")

  /**
   * Privacy wording comes from the privacy pipeline's own state, not from
   * whether Gemma managed to describe the photo.
   *
   * Those are two different systems and they fail independently: the photo can
   * be unreadable to the review model while SAM3 scans it and blurs a face
   * perfectly well. Deriving this from `image_review_succeeded` produced
   * "the image could not be checked for sensitive details" printed directly
   * above a visibly blurred face.
   *
   * The one case where the review's failure does decide it is `not_required` —
   * that state only means "no scan was asked for", so with no successful read
   * behind it there is nothing to base a reassurance on.
   */
  const privacyState = image?.privacy_state ?? "not_required"
  const privacyUnearned = privacyState === "not_required" && ai.image_review_succeeded === false
  const privacyMessage = !hasPhoto
    ? ""
    : privacyUnearned
      ? PRIVACY_UNCHECKED
      : (PRIVACY_STATE[privacyState]?.label ?? "")
  const protectedClasses = privacyUnearned ? [] : (image?.privacy_detected_classes ?? ai.suspected_sensitive_classes ?? [])
  const privacyBadge = !hasPhoto
    ? ""
    : privacyUnearned
      ? "Photo Review Unavailable"
      : (PRIVACY_STATE_BADGE[privacyState] ?? "")

  const flagReasons = concernFlagReasons(report)

  return (
    <section className="rounded-panel border border-card-line bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-card-line px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-control bg-brand-orange-soft">
          <SparklesIcon className="size-3.5 text-brand-orange" />
        </span>
        <h3 className="mr-auto text-heading text-foreground">E-Boses Review Assistant</h3>
        <Badge tone={photoState === "supports" ? "good" : photoState === "mismatch" ? "warn" : "neutral"}>
          {PHOTO_STATE_BADGE[photoState]}
        </Badge>
        {ai.urgent_attention ? <Badge tone="alert">Urgent Attention</Badge> : null}
        {privacyBadge ? (
          <Badge tone={image?.privacy_state === "protected" ? "good" : image?.public_visible ? "neutral" : "warn"}>
            {privacyBadge}
          </Badge>
        ) : null}
      </header>

      <div className="space-y-4 p-4">
        {ai.explanation ? (
          <p className="break-words text-body leading-6 text-foreground">{ai.explanation}</p>
        ) : null}

        <Section title="What was found">
          <BulletList items={findings} />
        </Section>

        {objects.length ? (
          <Section title="Observed in the photo">
            <div className="flex flex-wrap gap-1.5">
              {objects.map((object) => (
                <span
                  key={object}
                  className="rounded-pill bg-card-raised px-2.5 py-0.5 text-[12px] font-medium text-muted-foreground"
                >
                  {object}
                </span>
              ))}
            </div>
          </Section>
        ) : null}

        {privacyMessage ? (
          <Section title="Privacy protection">
            <div className="flex gap-2">
              <EyeOffIcon className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
              <div className="min-w-0">
                <p className="break-words text-body leading-6 text-foreground">{privacyMessage}</p>
                {protectedClasses.length && privacyState === "protected" ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {protectedClasses.map((item) => (
                      <span
                        key={item}
                        className="rounded-pill bg-status-closed-surface px-2.5 py-0.5 text-[12px] font-medium capitalize text-status-closed-ink"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </Section>
        ) : null}

        {missing.length ? (
          <Section title="Additional information needed">
            <BulletList items={missing} />
          </Section>
        ) : null}

        {ai.possible_duplicate && ai.duplicate_match ? (
          <div className="rounded-control border border-severity-moderate/40 bg-severity-moderate-surface p-3">
            <div className="flex items-center gap-2">
              <CopyIcon className="size-4 shrink-0 text-severity-moderate-ink" />
              <p className="min-w-0 truncate text-sm font-semibold text-severity-moderate-ink">
                {ai.duplicate_match.title}
              </p>
            </div>
            <p className="mt-1 text-body text-severity-moderate-ink">
              {ai.duplicate_match.status.replace(/_/g, " ")}
              {ai.duplicate_distance_meters != null ? ` · ${ai.duplicate_distance_meters} m away` : ""}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full border-severity-moderate/40 bg-card text-severity-moderate-ink hover:bg-severity-moderate-surface"
              onClick={() => navigate(`/dashboard/reports/${ai.duplicate_match?.public_id}`)}
            >
              Open the other report
            </Button>
          </div>
        ) : null}

        <Section title="Recommended next step">
          <p className="text-body font-semibold text-foreground">{action.label}</p>
          {action.help ? <p className="mt-0.5 text-body text-muted-foreground">{action.help}</p> : null}
        </Section>

        <div className="rounded-control bg-card-raised px-3 py-2">
          <p className="text-[12px] font-medium text-muted-foreground">
            This review is advisory. Authorized officials make the final decision.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="flex items-center gap-1 text-label text-brand-orange transition-colors duration-[--duration-micro] hover:text-brand-orange-strong"
          >
            <ChevronDownIcon className={cn("size-4 transition-transform", detailsOpen && "rotate-180")} />
            View review details
          </button>
          {detailsOpen ? (
            <dl className="mt-3 space-y-3 border-t border-card-line pt-3">
              <div>
                <dt className="text-micro uppercase text-subtle-foreground">Report understanding</dt>
                <dd className="mt-0.5 break-words text-body leading-6 text-foreground">
                  {ai.text_assessment || "The description was read but produced no specific notes."}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase text-subtle-foreground">Photo observations</dt>
                <dd className="mt-0.5 break-words text-body leading-6 text-foreground">
                  {hasPhoto ? ai.photo_assessment || PHOTO_STATE[photoState].label : PHOTO_STATE.none.label}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase text-subtle-foreground">Privacy protection</dt>
                <dd className="mt-0.5 break-words text-body leading-6 text-foreground">
                  {privacyMessage || "No photo was submitted, so no privacy check was needed."}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase text-subtle-foreground">Missing information</dt>
                <dd className="mt-0.5 break-words text-body leading-6 text-foreground">
                  {missing.length ? missing.join(" · ") : "Nothing else was identified as missing."}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase text-subtle-foreground">Reason for the recommendation</dt>
                <dd className="mt-0.5 break-words text-body leading-6 text-foreground">
                  {ai.explanation || action.help}
                  {flagReasons.length ? ` Flagged for: ${flagReasons.map((code) => code.replace(/_/g, " ")).join(", ")}.` : ""}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  )
}
