import { type ReactNode } from "react"
import { XIcon } from "lucide-react"

import { SeverityBadge } from "@/features/dashboard/components/record/record-header"
import type { Severity } from "@/features/dashboard/components/record/severity"
import { toStatusView } from "@/features/dashboard/components/record/status"

/**
 * Shell for the alert-map detail panel.
 *
 * This previously carried its own palette of hardcoded hexes (#dfe7f5, #2447b3,
 * #43507f, #68739c) that existed nowhere in the token system, which is why the
 * panel read as belonging to a different application. Everything here now comes
 * from tokens, and severity/status use the shared record vocabulary so this
 * panel agrees with the rest of the official side.
 */

const STATUS_BADGE = {
  open: "bg-status-open-surface text-status-open-ink",
  active: "bg-status-active-surface text-status-active-ink",
  closed: "bg-status-closed-surface text-status-closed-ink",
} as const

const SEVERITY_RULE: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  moderate: "bg-severity-moderate",
  low: "bg-severity-low",
}

export function PanelShell({
  title,
  badge,
  status,
  severity,
  severityAssessed = true,
  onClose,
  children,
}: {
  title: string
  badge: string
  /** Raw backend status; grouped and labelled by the shared vocabulary. */
  status?: string
  severity?: Severity
  severityAssessed?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const statusView = status ? toStatusView(status) : null

  return (
    <section className="relative overflow-hidden rounded-panel border border-card-line bg-card">
      {/* Fixed-weight severity rule: the non-colour encoding, so severity
          survives colour blindness, greyscale and outdoor glare. */}
      {severity ? (
        <span className={`absolute inset-y-0 left-0 w-1.5 ${SEVERITY_RULE[severity]}`} aria-hidden />
      ) : null}

      <div className={severity ? "p-4 pl-5" : "p-4"}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {badge}
            </p>
            <h2 className="mt-1 font-heading text-base font-bold capitalize text-foreground">
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {severity ? <SeverityBadge severity={severity} assessed={severityAssessed} /> : null}
            {statusView ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[statusView.group]}`}
              >
                {statusView.label}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-control p-1 text-muted-foreground transition hover:bg-tint"
              aria-label="Close details"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>
        <div className="grid gap-3">{children}</div>
      </div>
    </section>
  )
}

export function InfoRow({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: ReactNode
  label: string
  value: string | null
  /** Lifts a row out of the list for the one or two facts that drive the
   *  decision, so not every fact carries identical weight. */
  emphasis?: boolean
}) {
  const missing = value === null || value.trim() === ""

  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-24 font-semibold text-muted-foreground">{label}</span>
      <span
        className={
          missing
            ? "flex-1 font-medium italic text-muted-foreground"
            : emphasis
              ? "flex-1 text-sm font-bold text-foreground"
              : "flex-1 font-semibold text-foreground"
        }
      >
        {/* Explicit known-unknown: blank space reads as a rendering bug. */}
        {missing ? "Not available" : value}
      </span>
    </div>
  )
}
