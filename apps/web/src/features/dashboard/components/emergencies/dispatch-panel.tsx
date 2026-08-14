import { useEffect, useState } from "react"
import { AlertTriangleIcon, LoaderCircleIcon, PhoneCallIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Band, Surface } from "@/features/dashboard/components/workspace/band"
import type { ActiveResponder } from "@/features/dashboard/api"
import {
  getEmergency,
  requestEmergencyBackup,
  setEmergencyDisposition,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import {
  ResponderAssignment,
  type AssignableResponder,
} from "./responder-assignment"

/**
 * A dispatch action.
 *
 * These were 64px-tall bordered tiles in a 2×2 grid — four boxes inside a box,
 * taking a quarter of the pane to offer four verbs. A verb needs a row, not a
 * card.
 */
function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: "default" | "danger"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 items-center justify-center gap-1.5 rounded-control border border-card-line px-2 text-[12px] font-semibold transition-colors disabled:opacity-50",
        tone === "danger"
          ? "text-severity-critical-ink hover:border-severity-critical/40 hover:bg-severity-critical-surface"
          : "text-brand-navy hover:border-brand-orange hover:text-brand-orange",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** How long the incident has been open, in a compact "198h 31m" form. */
function elapsedLabel(createdAt: string, now: number): string {
  const ms = now - new Date(createdAt).getTime()
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 60_000) : 0
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function toAssignable(responder: ActiveResponder): AssignableResponder {
  return {
    id: responder.id,
    full_name: responder.full_name || "Responder",
    responder_unit: responder.responder_unit || null,
    is_on_duty: responder.is_on_duty,
    initials: responder.initials,
    latitude: responder.current_latitude,
    longitude: responder.current_longitude,
  }
}

type QuickAction = { kind: "escalate" } | { kind: "false-alarm" } | null

/**
 * Official dispatch console: response team, responder assignment, and quick actions.
 *
 * Escalate and False alarm both require a stated reason — escalation routes a
 * backup responder onto this incident (never a queue-wide sweep), and a false
 * alarm is a final disposition recorded on the record, not a resolve.
 */
export function DispatchPanel({
  alert,
  responders,
  onChanged,
}: {
  alert: EmergencyAlert | null
  responders: ActiveResponder[]
  onChanged: (alert: EmergencyAlert) => void
}) {
  const [busyAction, setBusyAction] = useState("")
  const [quickAction, setQuickAction] = useState<QuickAction>(null)
  const [quickReason, setQuickReason] = useState("")
  // Reveal-on-demand only: officials keep the number masked until they dial,
  // so the privacy audit records one reveal per call, not one per view.
  const { busy: dialBusy, call: callResident } = useReporterPhone(alert)
  // The open duration lives on the Response team band's right side, so the
  // dispatch pane no longer needs its own pinned header row.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  async function confirmEscalate() {
    if (!alert) return
    const reason = quickReason.trim()
    if (reason.length < 5) {
      toast.error("Say briefly why this incident needs escalation.")
      return
    }
    setBusyAction("escalate")
    try {
      const next = await requestEmergencyBackup(alert.id, {
        backup_type: "other",
        reason,
        urgency: "high",
      })
      onChanged(next)
      toast.success("Backup support escalated for this incident")
      setQuickAction(null)
      setQuickReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not escalate this incident.")
    } finally {
      setBusyAction("")
    }
  }

  async function confirmFalseAlarm() {
    if (!alert) return
    const note = quickReason.trim()
    if (note.length < 5) {
      toast.error("Say briefly why this is not a real emergency.")
      return
    }
    setBusyAction("false-alarm")
    try {
      const next = await setEmergencyDisposition(alert.id, "false_alarm", note, alert.status_version)
      onChanged(next)
      toast.success("Emergency recorded as a false alarm")
      setQuickAction(null)
      setQuickReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the false alarm.")
    } finally {
      setBusyAction("")
    }
  }

  async function refreshTeam() {
    if (!alert) return
    setBusyAction("refresh-team")
    try {
      onChanged(await getEmergency(alert.id))
      toast.success("Team status refreshed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not refresh team status.")
    } finally {
      setBusyAction("")
    }
  }

  return (
    <Surface>
      <Band
        label="Response team"
        action={
          alert ? (
            <span
              className="text-[11px] font-semibold tabular-nums text-subtle-foreground"
              title={`Received ${alert.created_at}`}
            >
              {elapsedLabel(alert.created_at, now)}
            </span>
          ) : undefined
        }
      >
        <ResponderAssignment
          alert={alert}
          responders={responders.map(toAssignable)}
          onChanged={onChanged}
        />
      </Band>

      <Band label="Actions">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton icon={<PhoneCallIcon className="size-4" />} label={dialBusy ? "Opening…" : "Call resident"} onClick={() => void callResident()} disabled={!alert || dialBusy} />
          <ActionButton icon={<RefreshCwIcon className="size-4" />} label={busyAction === "refresh-team" ? "Refreshing" : "Refresh"} onClick={() => void refreshTeam()} disabled={!alert || Boolean(busyAction)} />
          <ActionButton icon={<AlertTriangleIcon className="size-4" />} label={busyAction === "escalate" ? "Escalating" : "Escalate"} onClick={() => { setQuickAction({ kind: "escalate" }); setQuickReason("") }} disabled={!alert || Boolean(busyAction)} />
          <ActionButton tone="danger" icon={<ShieldCheckIcon className="size-4" />} label={busyAction === "false-alarm" ? "Recording" : "False alarm"} onClick={() => { setQuickAction({ kind: "false-alarm" }); setQuickReason("") }} disabled={!alert || Boolean(busyAction)} />
        </div>

        {quickAction ? (
          <div className="mt-3 rounded-control border border-severity-moderate/40 bg-severity-moderate-surface p-3">
            <p className="text-xs font-semibold text-severity-moderate-ink">
              {quickAction.kind === "escalate"
                ? "Escalate this incident — the next available on-duty responder is routed in as backup support."
                : "Record this as a false alarm — the response team is stood down and the disposition is written to the record."}
            </p>
            <label htmlFor={`dispatch-reason-${alert?.id ?? "none"}`} className="mt-2 block text-[11px] font-bold text-severity-moderate-ink">
              {quickAction.kind === "escalate" ? "Escalation reason" : "Why this is not an emergency"}
            </label>
            <textarea
              id={`dispatch-reason-${alert?.id ?? "none"}`}
              value={quickReason}
              onChange={(event) => setQuickReason(event.target.value)}
              rows={2}
              maxLength={255}
              placeholder={quickAction.kind === "escalate" ? "Explain why backup support is needed" : "Explain why this is not a real emergency"}
              className="mt-1 w-full resize-none rounded-panel border border-severity-moderate/40 bg-card px-3 py-2 text-xs text-brand-navy outline-none focus:border-brand-orange"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button type="button" size="sm" variant="outline" disabled={Boolean(busyAction)} onClick={() => { setQuickAction(null); setQuickReason("") }}>Cancel</Button>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(busyAction) || quickReason.trim().length < 5}
                onClick={() => void (quickAction.kind === "escalate" ? confirmEscalate() : confirmFalseAlarm())}
                className="bg-brand-navy text-white hover:bg-brand-navy"
              >
                {busyAction === "escalate" || busyAction === "false-alarm"
                  ? <span className="inline-flex items-center gap-1.5"><LoaderCircleIcon className="size-3.5 animate-spin" />{busyAction === "escalate" ? "Escalating" : "Recording"}</span>
                  : quickAction.kind === "escalate" ? "Escalate incident" : "Record false alarm"}
              </Button>
            </div>
          </div>
        ) : null}
      </Band>

      {/* The "Incident summary" band that used to close this pane is gone. It
          reported Active 1, Responders N, Auto route Yes/No and "Dispatch rule:
          Official config" — four values that never changed what a dispatcher
          would do next, in a fifth bordered box. */}
    </Surface>
  )
}
