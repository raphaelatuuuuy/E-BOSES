import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { formatDayTime } from "@/features/dashboard/lib/responder-format"
import { Empty } from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * The "Details" half of the dispatch card — everything the responder needs to
 * know before moving that is not progress.
 *
 * A label/value list rather than a stack of sub-cards: the reference's detail
 * pane is flat, and nesting bordered boxes inside a bordered card is how the
 * old panel ended up reading as chrome rather than content.
 */

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-card-line py-3 first:border-t-0 first:pt-0">
      <dt className="text-micro text-subtle-foreground">{label}</dt>
      <dd className="min-w-0 max-w-[65%] text-right text-body text-foreground">{value}</dd>
    </div>
  )
}

export function DispatchDetails({ alert }: { alert: EmergencyAlert }) {
  const triage = Object.entries(alert.triage ?? {}).filter(([, value]) => Boolean(value))
  const location = alert.display_location || alert.address || alert.barangay

  return (
    <div className="min-w-0">
      {alert.note ? (
        <p className="mb-4 text-body leading-6 text-muted-foreground">{alert.note}</p>
      ) : (
        <p className="mb-4 text-body leading-6 text-subtle-foreground">
          The reporter did not leave a description.
        </p>
      )}

      <dl className="min-w-0">
        <Row label="Type" value={<span className="capitalize">{alert.type}</span>} />
        <Row label="Reported" value={formatDayTime(alert.created_at)} />
        {location ? <Row label="Location" value={location} /> : null}
        {alert.location_accuracy != null ? (
          <Row label="Accuracy" value={`±${Math.round(alert.location_accuracy)} m`} />
        ) : null}
        {alert.media.length > 0 ? (
          <Row
            label="Evidence"
            value={`${alert.media.length} file${alert.media.length === 1 ? "" : "s"}`}
          />
        ) : null}
        {triage.map(([key, value]) => {
          const display =
            typeof value === "string" && value.length > 0
              ? value.charAt(0).toUpperCase() + value.slice(1)
              : value
          return <Row key={key} label={key.replace(/_/g, " ")} value={display} />
        })}
      </dl>

      {alert.category_needs_confirmation ? (
        <p className="mt-4 rounded-2xl border border-severity-moderate/40 bg-severity-moderate-surface p-3 text-body leading-6 text-severity-moderate-ink">
          The emergency type was inferred and has not been confirmed. Verify it on scene.
        </p>
      ) : null}

      {alert.unresolved_fields.length > 0 ? (
        <div className="mt-4">
          <p className="text-micro text-subtle-foreground">Missing information</p>
          <p className="mt-1 text-body leading-6 text-muted-foreground">
            {alert.unresolved_fields.map((field) => field.replace(/_/g, " ")).join(", ")}
          </p>
        </div>
      ) : null}

      {!alert.note && triage.length === 0 && !location ? (
        <Empty>Nothing else was recorded for this dispatch.</Empty>
      ) : null}
    </div>
  )
}
