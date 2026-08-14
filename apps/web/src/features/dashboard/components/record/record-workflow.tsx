import { UserCheckIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { RecordAction, RecordTrackStep, RecordView } from "./types"

/**
 * Tier 2 — where the record is, who has it, and the one action to take now.
 *
 * `actions[0]` renders as the primary control. Everything else is secondary, so
 * an official under pressure has one obvious next move rather than a row of
 * equally-weighted buttons.
 */

function Track({ steps }: { steps: RecordTrackStep[] }) {
  if (steps.length === 0) return null

  return (
    <ol className="flex items-center gap-0" aria-label="Progress">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        const done = step.state === "done"
        const current = step.state === "current"

        return (
          <li key={step.key} className={isLast ? "flex items-center" : "flex flex-1 items-center"}>
            <div className="flex flex-col items-center gap-1">
              <span
                aria-hidden
                className={
                  current
                    ? "size-3 rounded-full bg-brand-orange ring-4 ring-brand-orange-soft"
                    : done
                      ? "size-3 rounded-full bg-status-closed"
                      : "size-3 rounded-full border-2 border-card-line bg-card"
                }
              />
              <span
                className={
                  current
                    ? "text-[10px] font-bold text-brand-orange-strong"
                    : "text-[10px] font-semibold text-muted-foreground"
                }
              >
                {step.label}
              </span>
              {step.at ? (
                <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                  {step.at}
                </span>
              ) : null}
            </div>
            {!isLast ? (
              <span
                aria-hidden
                className={`mx-1 mb-5 h-0.5 flex-1 ${done ? "bg-status-closed" : "bg-card-line"}`}
              />
            ) : null}
          </li>
        )
      })}
      <span className="sr-only">
        {steps.find((step) => step.state === "current")?.label ?? "No active step"}
      </span>
    </ol>
  )
}

function ActionButton({ action, primary }: { action: RecordAction; primary: boolean }) {
  const tone = action.tone ?? (primary ? "primary" : "default")
  const base =
    "inline-flex items-center justify-center rounded-panel px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-55"
  const styles =
    tone === "primary"
      ? "bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
      : tone === "danger"
        ? "bg-severity-critical-surface text-severity-critical-ink hover:bg-severity-critical/15"
        : "border border-card-line bg-card text-foreground hover:bg-tint"

  return (
    <button
      type="button"
      onClick={action.onSelect}
      disabled={action.disabled}
      // Disabled-with-reason rather than hidden: a missing button reads as a
      // broken screen, while a disabled one teaches the permission model.
      title={action.disabled ? action.disabledReason : undefined}
      aria-describedby={action.disabled && action.disabledReason ? `${action.key}-reason` : undefined}
      className={`${base} ${styles} ${primary ? "flex-1 sm:flex-none" : ""}`}
    >
      {action.label}
    </button>
  )
}

export function RecordWorkflow({
  record,
  showAssignee = true,
  showTrack = true,
  embedded = false,
}: {
  record: RecordView
  /**
   * Emergencies pass `false`: their record has a dedicated response panel that
   * owns the roster, acknowledgement clock and reporter callback. Rendering the
   * assignee here as well made "Jose G. · BDRRMO / awaiting acknowledgement"
   * the third copy of the same fact on one screen.
   */
  showAssignee?: boolean
  showTrack?: boolean
  /** Render as a band inside a unified dossier card, without its own border. */
  embedded?: boolean
}) {
  const [primary, ...rest] = record.actions
  // Nothing to render — don't draw an empty band inside the unified card.
  if (!showTrack && !showAssignee && record.actions.length === 0) return null

  return (
    <section className={cn("space-y-4 bg-card p-4", !embedded && "rounded-panel border border-card-line")}>
      {showTrack ? <Track steps={record.track} /> : null}

      {showAssignee ? (
        record.assigneeLabel ? (
          <div className="flex items-center gap-2 rounded-panel bg-tint px-3 py-2">
            <UserCheckIcon className="size-4 shrink-0 text-brand-navy" aria-hidden />
            <span className="text-sm font-semibold text-brand-navy">{record.assigneeLabel}</span>
            {record.assigneeDetail ? (
              <span className="ml-auto text-xs font-medium tabular-nums text-muted-foreground">
                {record.assigneeDetail}
              </span>
            ) : null}
          </div>
        ) : null
      ) : null}

      {record.actions.length > 0 ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {primary ? <ActionButton action={primary} primary /> : null}
            {rest.map((action) => (
              <ActionButton key={action.key} action={action} primary={false} />
            ))}
          </div>
          {record.actions
            .filter((action) => action.disabled && action.disabledReason)
            .map((action) => (
              <p
                key={`${action.key}-reason`}
                id={`${action.key}-reason`}
                className="text-xs font-medium text-muted-foreground"
              >
                {action.label}: {action.disabledReason}
              </p>
            ))}
        </div>
      ) : null}
    </section>
  )
}
