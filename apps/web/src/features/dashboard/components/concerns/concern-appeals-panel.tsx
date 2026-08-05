import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"

import { reviewConcernAppeal, type Concern, type ConcernAppeal } from "@/features/dashboard/api"
import { formatEventTime } from "@/features/dashboard/components/concerns/concern-display"

/**
 * Appeal review for one concern, in the tab beside Details, Photos and Chat.
 *
 * This replaced a queue-wide panel that listed every pending appeal in the
 * barangay, matched each one back to a report by id, and offered an "Open
 * report" button to get there. It was never rendered anywhere, which meant the
 * only caller of `reviewConcernAppeal` in the whole app was dead code and no
 * official could actually decide an appeal.
 *
 * Scoping it to the open concern removes the whole matching problem: the report
 * is the one already on screen, so there is nothing to look up and nowhere to
 * navigate. The queue-wide view of "which reports have appeals" already exists
 * as the Appealed filter and the appeals counter in the command bar.
 */
export function ConcernAppealsPanel({
  report,
  onRefresh,
}: {
  report: Concern
  /** Reloads the queue; the decided appeal comes back on `report.appeals`. */
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})

  const appeals = report.appeals ?? []
  const pending = appeals.filter((appeal) => appeal.status === "submitted")

  async function decide(appeal: ConcernAppeal, status: "approved" | "denied") {
    const note =
      notes[appeal.id]?.trim() ||
      (status === "approved"
        ? "Appeal approved after official review."
        : "Appeal denied after official review.")
    setBusy(`${appeal.id}-${status}`)
    try {
      await reviewConcernAppeal(appeal.id, { status, decision_note: note })
      setNotes((current) => {
        const copy = { ...current }
        delete copy[appeal.id]
        return copy
      })
      await onRefresh()
      toast.success(status === "approved" ? "Appeal approved" : "Appeal denied")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Appeal decision could not be saved.")
    } finally {
      setBusy(null)
    }
  }

  if (!appeals.length) {
    return (
      <div className="rounded-panel border border-card-line bg-card p-4">
        <h3 className="text-heading text-foreground">Appeals</h3>
        <p className="mt-3 rounded-control border border-dashed border-card-line bg-card-raised p-5 text-center text-body text-subtle-foreground">
          The resident has not objected to any decision on this report.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-heading text-foreground">Appeals</h3>
          <p className="mt-1 text-body text-muted-foreground">
            The resident asked you to look at a decision again.
          </p>
        </div>
        {pending.length ? (
          <span className="shrink-0 rounded-pill bg-severity-moderate-surface px-2.5 py-1 text-[11px] font-semibold text-severity-moderate-ink">
            {pending.length} awaiting a decision
          </span>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {appeals.map((appeal) => {
          const editable = appeal.status === "submitted"
          return (
            <article key={appeal.id} className="rounded-control border border-card-line bg-card-raised p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-foreground">
                  {appeal.appellant.full_name}
                </p>
                <span className="shrink-0 rounded-pill bg-card px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                  {appeal.status}
                </span>
              </div>
              <p className="mt-0.5 text-micro text-subtle-foreground">
                Filed {formatEventTime(appeal.created_at)}
              </p>

              <p className="mt-3 break-words text-body leading-6 text-foreground">{appeal.reason}</p>

              {editable ? (
                <>
                  <label className="mt-3 block">
                    <span className="text-micro uppercase tracking-wide text-subtle-foreground">
                      Reason for your decision
                    </span>
                    <textarea
                      value={notes[appeal.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [appeal.id]: event.target.value }))
                      }
                      rows={2}
                      placeholder="The resident sees this, and it is kept in the record."
                      className="mt-1 w-full resize-y rounded-control border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
                    />
                  </label>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-status-closed text-white hover:bg-status-closed"
                      disabled={busy === `${appeal.id}-approved`}
                      onClick={() => void decide(appeal, "approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy === `${appeal.id}-denied`}
                      onClick={() => void decide(appeal, "denied")}
                    >
                      Deny
                    </Button>
                  </div>
                </>
              ) : appeal.decision_note ? (
                <p className="mt-3 rounded-control bg-card p-3 text-body text-muted-foreground">
                  Decision: {appeal.decision_note}
                </p>
              ) : null}
            </article>
          )
        })}
      </div>
    </div>
  )
}
