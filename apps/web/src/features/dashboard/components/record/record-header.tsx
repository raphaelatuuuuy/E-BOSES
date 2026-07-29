import { ClockIcon, MapPinIcon, NavigationIcon } from "lucide-react"

import { SEVERITY_LABEL, type Severity } from "./severity"
import type { RecordFact, RecordView } from "./types"

/**
 * Tier 1 — answers what, where, how bad and how long before anything else.
 *
 * The flat label→value list this replaces gave severity, address, responder and
 * timestamp identical weight, so nothing was scannable. Here severity owns a
 * coloured rule and the largest type, and the rest steps down from it.
 */

const SEVERITY_RULE: Record<Severity, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  moderate: "bg-severity-moderate",
  low: "bg-severity-low",
}

const SEVERITY_BADGE: Record<Severity, string> = {
  critical: "bg-severity-critical-surface text-severity-critical-ink",
  high: "bg-severity-high-surface text-severity-high-ink",
  moderate: "bg-severity-moderate-surface text-severity-moderate-ink",
  low: "bg-severity-low-surface text-severity-low-ink",
}

const STATUS_BADGE = {
  open: "bg-status-open-surface text-status-open-ink",
  active: "bg-status-active-surface text-status-active-ink",
  closed: "bg-status-closed-surface text-status-closed-ink",
} as const

export function SeverityBadge({
  severity,
  assessed = true,
}: {
  severity: Severity
  assessed?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${SEVERITY_BADGE[severity]}`}
    >
      {/* Shape as well as colour: severity must survive greyscale and glare. */}
      <span className={`h-2 w-2 rounded-full ${SEVERITY_RULE[severity]}`} aria-hidden />
      {SEVERITY_LABEL[severity]}
      {!assessed ? <span className="font-semibold opacity-75">· pending</span> : null}
    </span>
  )
}

function Fact({ fact }: { fact: RecordFact }) {
  const missing = fact.value === null || fact.value === ""
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {fact.label}
      </dt>
      <dd
        className={
          missing
            ? "truncate text-sm font-medium italic text-muted-foreground"
            : "truncate text-sm font-semibold text-foreground"
        }
      >
        {missing ? (fact.emptyHint ?? "Not available") : fact.value}
      </dd>
    </div>
  )
}

export function RecordHeader({ record, compact }: { record: RecordView; compact?: boolean }) {
  if (compact) return null

  return (
    <header className="relative overflow-hidden rounded-panel border border-card-line bg-card">
      {/* Fixed-weight severity rule — the second, non-colour encoding. */}
      <span
        className={`absolute inset-y-0 left-0 w-1.5 ${SEVERITY_RULE[record.severity]}`}
        aria-hidden
      />

      <div className="space-y-3 py-4 pl-5 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-control bg-tint px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-brand-navy">
            {record.typeLabel}
          </span>
          <SeverityBadge severity={record.severity} assessed={record.severityAssessed} />
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_BADGE[record.status.group]}`}
          >
            {record.status.label}
          </span>
          {record.elapsedLabel ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              <ClockIcon className="size-3.5" aria-hidden />
              {record.elapsedLabel}
            </span>
          ) : null}
        </div>

        <h2 className="font-heading text-lg leading-tight font-bold text-foreground">
          {record.title}
        </h2>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <MapPinIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{record.address ?? "Location unavailable"}</span>
          </span>
          {record.distanceLabel ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
              <NavigationIcon className="size-4" aria-hidden />
              {record.distanceLabel}
            </span>
          ) : null}
        </div>

        {record.facts.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-card-line pt-3 sm:grid-cols-3">
            {record.facts.map((fact) => (
              <Fact key={fact.label} fact={fact} />
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  )
}
