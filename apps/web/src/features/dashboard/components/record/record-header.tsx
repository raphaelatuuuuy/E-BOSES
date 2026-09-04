import { ClockIcon, MapPinIcon, NavigationIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { RecordFact, RecordView } from "./types"

/**
 * Tier 1 — answers what, where, how bad and how long before anything else.
 *
 * The badges are gone: no severity strip, no severity chip, no status chip and
 * no type eyebrow. The title leads, the elapsed time sits beside it, and the
 * location and facts follow.
 */

function Fact({ fact }: { fact: RecordFact }) {
  const missing = fact.value === null || fact.value === ""
  const isDescription = fact.label.trim().toLowerCase() === "description"
  if (isDescription) {
    return (
      <div className="col-span-full min-w-0">
        <dd
          className={
            missing
              ? "text-sm font-medium italic text-muted-foreground"
              : "text-sm font-semibold leading-relaxed text-foreground"
          }
        >
          {missing ? (fact.emptyHint ?? "Not available") : fact.value}
        </dd>
      </div>
    )
  }
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-muted-foreground">
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

export function RecordHeader({
  record,
  compact,
  embedded = false,
}: {
  record: RecordView
  compact?: boolean
  /** Render as a band inside a unified dossier card, without its own border. */
  embedded?: boolean
}) {
  if (compact) return null

  return (
    <header className={cn("relative overflow-hidden bg-card", !embedded && "rounded-panel border border-card-line")}>
      <div className="space-y-3 py-4 pl-5 pr-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 font-heading text-lg leading-tight font-bold text-foreground">
            {record.title}
          </h2>
          {record.elapsedLabel ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
              <ClockIcon className="size-3.5" aria-hidden />
              {record.elapsedLabel}
            </span>
          ) : null}
        </div>

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
