import { useState } from "react"
import { SirenIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { reviewEmergencyAppeal, type EmergencyAlert, type EmergencyAppeal } from "@/features/dashboard/emergency-api"
import { formatTime, responderName, statusClass, statusLabel } from "./lib"

export function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-panel bg-card-raised p-3">
      <p className="text-[10px] font-semibold text-subtle-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-brand-navy">{value}</p>
    </div>
  )
}

export function QueueCard({
  alert,
  active,
  onClick,
}: {
  alert: EmergencyAlert
  active: boolean
  onClick: () => void
}) {
  const assigned = alert.current_assignment?.responder
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-panel border bg-card p-4 text-left transition-colors hover:border-brand-orange",
        active ? "border-brand-orange shadow-sm ring-2 ring-brand-orange/10" : "border-card-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-severity-critical-surface text-severity-critical-ink">
            <SirenIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold capitalize text-brand-navy">{alert.type} emergency</p>
            <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">{alert.address || alert.barangay}</p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold", statusClass(alert.status))}>
          {statusLabel[alert.status]}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-subtle-foreground">{alert.note || "No note provided."}</p>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-bold text-subtle-foreground">
        <span>#{alert.id} · {formatTime(alert.created_at)}</span>
        <span className="truncate text-brand-navy">{assigned ? responderName(assigned) : "Unassigned"}</span>
      </div>
    </button>
  )
}

export function EmergencyAppealsPanel({ appeals, onUpdated }: { appeals: EmergencyAppeal[]; onUpdated: (appeal: EmergencyAppeal) => void }) {
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<number | null>(null)

  async function decide(appeal: EmergencyAppeal, status: "approved" | "denied") {
    const decisionNote = (notes[appeal.id] || "").trim()
    if (decisionNote.length < 5) {
      toast.error("Add a clear decision note before completing the review.")
      return
    }
    setBusy(appeal.id)
    try {
      onUpdated(await reviewEmergencyAppeal(appeal.id, { status, decision_note: decisionNote }))
      toast.success(`Emergency review request ${status}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review this emergency request.")
    } finally {
      setBusy(null)
    }
  }

  if (appeals.length === 0) return null
  return (
    <section className="rounded-panel border border-severity-moderate/40 bg-severity-moderate-surface/50 p-5">
      <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-brand-navy">Emergency review requests</p><p className="mt-1 text-xs font-semibold text-subtle-foreground">Decide resident requests from cancelled or disputed incidents with an auditable note.</p></div><span className="rounded-control bg-card px-2.5 py-1 text-xs font-semibold text-severity-moderate-ink">{appeals.filter((item) => item.status === "submitted").length} pending</span></div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {appeals.map((appeal) => <article key={appeal.id} className="rounded-panel border border-severity-moderate/40 bg-card p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold capitalize text-brand-navy">{appeal.alert_type || "Emergency"} incident</p><p className="mt-1 text-xs font-semibold text-subtle-foreground">{appeal.appellant.full_name} · {formatTime(appeal.created_at)}</p></div><span className="rounded-control border border-card-line px-2 py-1 text-[10px] font-semibold text-muted-foreground">{appeal.status}</span></div><p className="mt-3 text-xs font-semibold leading-5 text-muted-foreground">{appeal.reason}</p>{appeal.status === "submitted" ? <><textarea rows={2} maxLength={255} value={notes[appeal.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [appeal.id]: event.target.value }))} placeholder="Decision note" className="mt-3 w-full resize-none rounded-panel border border-card-line-strong p-3 text-xs font-semibold text-brand-navy outline-none focus:border-brand-orange" /><div className="mt-2 grid grid-cols-2 gap-2"><Button type="button" size="sm" variant="outline" disabled={busy === appeal.id} onClick={() => void decide(appeal, "denied")} className="border-severity-critical/40 text-severity-critical-ink">Deny</Button><Button type="button" size="sm" disabled={busy === appeal.id} onClick={() => void decide(appeal, "approved")} className="bg-status-closed text-white">Approve</Button></div></> : appeal.decision_note ? <p className="mt-3 rounded-control bg-card-raised p-3 text-xs font-semibold text-muted-foreground">Decision: {appeal.decision_note}</p> : null}</article>)}
      </div>
    </section>
  )
}
