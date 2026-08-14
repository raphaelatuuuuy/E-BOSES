import { useMemo, useState } from "react"
import { ShieldAlertIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { reviewContentFlag, type ContentFlag } from "@/features/dashboard/api"
import { StateMarker, type StateTone } from "@/components/ui/state-marker"

type FlagTab = "pending" | "decided"

/**
 * The reason a resident gave is a fact, not a severity — it used to carry five
 * different hues, so a queue of flags read as a colour chart. Only the review
 * state gets a marker, because only that changes what the official does next.
 */
const STATUS_TONE: Record<ContentFlag["status"], StateTone> = {
  submitted: "open",
  reviewed: "active",
  dismissed: "closed",
  action_taken: "alarm",
}

export function FlagsQueue({
  flags,
  onFlagsChange,
}: {
  flags: ContentFlag[]
  onFlagsChange: (next: ContentFlag[]) => void
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<FlagTab>("pending")
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState("")

  const pending = useMemo(() => flags.filter((flag) => flag.status === "submitted"), [flags])
  const decided = useMemo(() => flags.filter((flag) => flag.status !== "submitted"), [flags])
  const visible = tab === "pending" ? pending : decided

  async function decide(flag: ContentFlag, status: "reviewed" | "dismissed" | "action_taken") {
    const note = (notes[flag.id] || "").trim()
    if (note.length < 5) {
      toast.error("Add a decision note with at least 5 characters.")
      return
    }
    setBusy(`flag-${flag.id}`)
    try {
      const next = await reviewContentFlag(flag.id, { status, staff_note: note })
      onFlagsChange(flags.map((item) => (item.id === next.id ? next : item)))
      setNotes((current) => ({ ...current, [flag.id]: "" }))
      toast.success("Content report reviewed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review content report.")
    } finally {
      setBusy("")
    }
  }

  return (
    <section className="rounded-2xl border border-line-tint bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
            <ShieldAlertIcon className="size-5" strokeWidth={1.8} />
            {pending.length > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-sos text-[10px] font-bold text-white">
                {pending.length}
              </span>
            ) : null}
          </span>
          <div>
            <h2 className="text-section text-brand-navy">Community content reports</h2>
            <p className="mt-1 text-meta text-neutral-500">
              Review resident-submitted flags without mixing moderation into User management.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-canvas p-1">
          {(
            [
              { key: "pending", label: `Pending (${pending.length})` },
              { key: "decided", label: `Decided (${decided.length})` },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTab(option.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                tab === option.key ? "bg-white text-brand-navy shadow-sm" : "text-navy-muted hover:text-brand-navy",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-line-tint p-6 text-center text-sm font-semibold text-subtle-foreground">
          {tab === "pending"
            ? "No pending content reports. The community looks good."
            : "No decided reports yet."}
        </p>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {visible.map((flag) => (
            <article key={flag.id} className="flex flex-col rounded-xl border border-line-tint p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-row font-semibold capitalize text-brand-navy">
                      {flag.reason.replace(/_/g, " ")}
                    </span>
                    <StateMarker
                      tone={STATUS_TONE[flag.status]}
                      label={flag.status.replace(/_/g, " ")}
                      className="capitalize"
                    />
                  </div>
                  <p className="mt-2 text-xs font-semibold text-subtle-foreground">
                    Report #{flag.concern}
                    {flag.comment ? ` · comment #${flag.comment}` : ""} · by {flag.reporter.full_name}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/dashboard/reports/${flag.concern}`)}
                  className="shrink-0"
                >
                  Open report
                </Button>
              </div>

              <p className="mt-3 rounded-lg bg-canvas p-3 text-xs font-semibold leading-5 text-navy-muted">
                {flag.note || "No additional note supplied."}
              </p>

              {flag.status === "submitted" ? (
                <>
                  <textarea
                    value={notes[flag.id] || ""}
                    onChange={(e) => setNotes((current) => ({ ...current, [flag.id]: e.target.value }))}
                    rows={2}
                    maxLength={255}
                    placeholder="Official decision note"
                    className="mt-3 w-full resize-none rounded-xl border border-line-tint p-3 text-xs font-semibold text-brand-navy outline-none focus:border-brand-orange"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy === `flag-${flag.id}`}
                      onClick={() => void decide(flag, "dismissed")}
                      className="border-neutral-300 text-neutral-600"
                    >
                      Dismiss
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === `flag-${flag.id}`}
                      onClick={() => void decide(flag, "reviewed")}
                      className="bg-brand-blue text-white"
                    >
                      Reviewed
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy === `flag-${flag.id}`}
                      onClick={() => void decide(flag, "action_taken")}
                      className="bg-sos text-white hover:bg-sos/90"
                    >
                      Action taken
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-3 rounded-lg border border-line-tint bg-white p-3 text-xs font-semibold leading-5 text-navy-muted">
                  <span className="font-semibold text-navy-muted">Decision: </span>
                  {flag.staff_note}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
