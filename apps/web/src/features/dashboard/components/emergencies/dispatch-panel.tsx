import { useEffect, useState } from "react"
import { AlertTriangleIcon, LoaderCircleIcon, PhoneCallIcon, RefreshCwIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import type { ActiveResponder } from "@/features/dashboard/api"
import {
  getEmergency,
  getEmergencyBackupUnits,
  requestEmergencyBackup,
  setEmergencyDisposition,
  type EmergencyAlert,
  type EmergencyBackupUnit,
} from "@/features/dashboard/emergency-api"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import {
  ResponderAssignment,
  type AssignableResponder,
} from "./responder-assignment"
import { SheetPrimaryButton, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"

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
 * Uses exact colors and styling matching the concerns Updates dialog.
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
  const [backupUnits, setBackupUnits] = useState<EmergencyBackupUnit[]>([])
  const [backupUnitId, setBackupUnitId] = useState<number | null>(null)
  const { busy: dialBusy, call: callResident } = useReporterPhone(alert)
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
    if (!backupUnitId) {
      toast.error("Choose the backup unit.")
      return
    }
    setBusyAction("escalate")
    try {
      const next = await requestEmergencyBackup(alert.id, {
        target_department_id: backupUnitId,
        reason,
        urgency: "high",
        idempotency_key: crypto.randomUUID(),
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
    <div className="space-y-6">
      {/* Response Team Section */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-normal text-neutral-500">Response team</p>
          {alert ? (
            <span
              className="text-[11px] font-semibold tabular-nums text-neutral-400"
              title={`Received ${alert.created_at}`}
            >
              {elapsedLabel(alert.created_at, now)}
            </span>
          ) : null}
        </div>
        <ResponderAssignment
          alert={alert}
          responders={responders.map(toAssignable)}
          onChanged={onChanged}
        />
      </div>

      {/* Actions Section */}
      <div>
        <p className="mb-3 text-[13px] font-normal text-neutral-500">Actions</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void callResident()}
            disabled={!alert || dialBusy}
            className="flex h-11 items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-neutral-300 bg-white px-4 text-[14px] font-normal text-neutral-900 outline-none transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus:border-neutral-500 disabled:opacity-50 disabled:bg-neutral-50"
          >
            <PhoneCallIcon className="size-4" />
            {dialBusy ? "Opening…" : "Call resident"}
          </button>
          <button
            type="button"
            onClick={() => void refreshTeam()}
            disabled={!alert || Boolean(busyAction)}
            className="flex h-11 items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-neutral-300 bg-white px-4 text-[14px] font-normal text-neutral-900 outline-none transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus:border-neutral-500 disabled:opacity-50 disabled:bg-neutral-50"
          >
            <RefreshCwIcon className={cn("size-4", busyAction === "refresh-team" && "animate-spin")} />
            {busyAction === "refresh-team" ? "Refreshing" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuickAction({ kind: "escalate" })
              setQuickReason("")
              if (alert) {
                void getEmergencyBackupUnits(alert.id)
                  .then((items) => {
                    setBackupUnits(items)
                    setBackupUnitId(items[0]?.id ?? null)
                  })
                  .catch(() => setBackupUnits([]))
              }
            }}
            disabled={!alert || Boolean(busyAction)}
            className="flex h-11 items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-neutral-300 bg-white px-4 text-[14px] font-normal text-neutral-900 outline-none transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus:border-neutral-500 disabled:opacity-50 disabled:bg-neutral-50"
          >
            <AlertTriangleIcon className="size-4" />
            {busyAction === "escalate" ? "Escalating" : "Escalate"}
          </button>
          <button
            type="button"
            onClick={() => {
              setQuickAction({ kind: "false-alarm" })
              setQuickReason("")
            }}
            disabled={!alert || Boolean(busyAction)}
            className="flex h-11 items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-neutral-300 bg-white px-4 text-[14px] font-normal text-neutral-900 outline-none transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus:border-neutral-500 disabled:opacity-50 disabled:bg-neutral-50"
          >
            <ShieldCheckIcon className="size-4" />
            {busyAction === "false-alarm" ? "Recording" : "False alarm"}
          </button>
        </div>

        {/* Quick Action Form */}
        {quickAction ? (
          <div className="mt-4 rounded-[14px] border-[1.5px] border-neutral-200 bg-neutral-50 p-4">
            <p className="text-[13px] font-normal text-neutral-600">
              {quickAction.kind === "escalate"
                ? "Escalate this incident — the next available responder is routed in as backup support."
                : "Record this as a false alarm — the response team is stood down and the disposition is written to the record."}
            </p>

            {quickAction.kind === "escalate" ? (
              <label className="mt-3 block">
                <span className="text-[13px] font-normal text-neutral-500">Backup unit</span>
                <select
                  value={backupUnitId ?? ""}
                  onChange={(event) => setBackupUnitId(Number(event.target.value))}
                  className="mt-1.5 flex h-11 w-full items-center gap-3 rounded-[12px] border-[1.5px] border-neutral-300 bg-white px-4 text-[14px] font-normal text-neutral-900 outline-none transition-colors hover:border-neutral-400 focus:border-neutral-500"
                >
                  <option value="">Choose a unit</option>
                  {backupUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>{unit.name}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="mt-3 block">
              <span className="text-[13px] font-normal text-neutral-500">
                {quickAction.kind === "escalate" ? "Escalation reason" : "Why this is not an emergency"}
              </span>
              <textarea
                value={quickReason}
                onChange={(event) => setQuickReason(event.target.value)}
                rows={3}
                maxLength={255}
                placeholder={quickAction.kind === "escalate" ? "Explain why backup support is needed" : "Explain why this is not a real emergency"}
                className="mt-1.5 w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[15px] font-normal text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-500"
              />
            </label>

            <div className="mt-4 flex gap-2">
              <SheetSecondaryButton
                onClick={() => {
                  setQuickAction(null)
                  setQuickReason("")
                }}
                className="mt-0 h-[44px] w-[30%] flex-shrink-0 text-[15px]"
              >
                Cancel
              </SheetSecondaryButton>
              <SheetPrimaryButton
                tone="accent"
                disabled={Boolean(busyAction) || quickReason.trim().length < 5}
                onClick={() => void (quickAction.kind === "escalate" ? confirmEscalate() : confirmFalseAlarm())}
                className="h-[44px] text-[15px]"
              >
                {busyAction === "escalate" || busyAction === "false-alarm" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    {busyAction === "escalate" ? "Escalating" : "Recording"}
                  </span>
                ) : quickAction.kind === "escalate" ? (
                  "Escalate incident"
                ) : (
                  "Record false alarm"
                )}
              </SheetPrimaryButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
