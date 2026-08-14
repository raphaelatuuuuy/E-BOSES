import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  listMergeHistory,
  setConcernPrimary,
  unmergeConcern,
  type Concern,
  type MergeEvent,
} from "@/features/dashboard/api"
import { Band, Surface } from "@/features/dashboard/components/workspace/band"

const ACTION_LABEL: Record<string, string> = {
  auto_merged: "Merged automatically",
  merged: "Merged by an official",
  unmerged: "Separated by an official",
  primary_changed: "Primary report changed",
  suggestion_rejected: "Suggestion rejected",
}

function formatMoment(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function ConcernMergeControls({
  report,
  onChanged,
}: {
  report: Concern
  onChanged: () => void
}) {
  const incident = report.community_incident
  const [history, setHistory] = useState<MergeEvent[]>([])
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    listMergeHistory(report.id)
      .then((events) => {
        if (!cancelled) setHistory(events)
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
    return () => {
      cancelled = true
    }
  }, [report.id])

  const members = incident?.reports ?? []
  const isChild = Boolean(incident && incident.primary_id !== report.id)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      setReason("")
      onChanged()
      setHistory(await listMergeHistory(report.id).catch(() => []))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That change could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface>
      <Band label="This incident">
        {members.length > 1 ? (
          <ul className="divide-y divide-card-line">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm font-semibold text-foreground">{member.tracking_id}</span>
                {member.is_primary ? (
                  <span className="rounded-pill bg-status-closed-surface px-2 py-0.5 text-[11px] font-semibold text-status-closed-ink">
                    Primary
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => setConcernPrimary(member.id),
                        `${member.tracking_id} is now the primary report.`,
                      )
                    }
                    className="text-label text-brand-orange transition-colors hover:text-brand-orange-strong disabled:opacity-60"
                  >
                    Make primary
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                  {member.reporter_name}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">
            This concern stands on its own. Nothing has been merged into it.
          </p>
        )}
      </Band>

      {isChild ? (
        <Band label="Separate this report">
          <p className="text-body leading-6 text-muted-foreground">
            If this is actually a different incident, separate it. It becomes its own concern again
            and keeps everything it came with.
          </p>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are these separate?"
            className="mt-2 h-10 w-full rounded-control border border-card-line bg-canvas px-3 text-label text-foreground outline-none placeholder:text-faint-foreground focus:border-brand-orange"
          />
          <button
            type="button"
            disabled={busy || reason.trim().length < 5}
            onClick={() =>
              void run(
                () => unmergeConcern(report.id, reason.trim()),
                `${report.tracking_id} is now a separate concern.`,
              )
            }
            className="mt-2 inline-flex h-9 items-center rounded-control border border-severity-critical/40 bg-severity-critical-surface px-3 text-label font-semibold text-severity-critical-ink transition-colors hover:bg-severity-critical-surface/80 disabled:opacity-50"
          >
            Separate from this incident
          </button>
        </Band>
      ) : null}

      <Band label="Merge history">
        {history.length ? (
          <ul className="space-y-2">
            {history.map((event) => (
              <li key={event.id} className="text-[12px] leading-5 text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {ACTION_LABEL[event.action] ?? event.action}
                </span>
                {" — "}
                {event.concern_tracking_id}
                {event.primary_tracking_id ? ` → ${event.primary_tracking_id}` : ""}
                {event.confidence != null ? ` · ${Math.round(event.confidence * 100)}% match` : ""}
                <span className="block text-subtle-foreground">
                  {event.actor_name} · {formatMoment(event.created_at)}
                  {event.reason ? ` · ${event.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted-foreground">No merge activity on this incident.</p>
        )}
      </Band>
    </Surface>
  )
}
