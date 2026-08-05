import { useState } from "react"
import {
  LocateFixedIcon,
  NavigationIcon,
  PhoneCallIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  UserPlusIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  markEmergencyArrived,
  requestEmergencyBackup,
  resolveEmergency,
  respondToEmergency,
  revealReporterContact,
  sendEmergencyLocationPing,
  unableToRespond,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"

const BACKUP_TYPES = [
  { value: "tanod", label: "Additional Barangay Tanod" },
  { value: "medical", label: "Medical Assistance" },
  { value: "fire", label: "Fire Assistance" },
  { value: "disaster", label: "Disaster Response" },
  { value: "traffic", label: "Traffic Control" },
  { value: "vawc", label: "VAWC / Protection Support" },
  { value: "other", label: "Other Authorized Support" },
]

const URGENCY = [
  { value: "immediate", label: "Immediate" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
]

const ACKNOWLEDGED_STATUSES = ["en_route", "nearby", "arrived", "backup_requested", "backup_assigned", "in_progress"]

/**
 * Field responder controls.
 *
 * No "accept" gate: the emergency is already assigned by the time a responder
 * sees this. "Responding" confirms acknowledgement; it does not claim the job.
 * Every action that closes a door — unable, unable to locate, resolved —
 * requires a short operational note, because those decisions are read back
 * later by whoever reviews the incident.
 */
export function ResponderActions({
  alert,
  onChanged,
}: {
  alert: EmergencyAlert
  onChanged: (alert: EmergencyAlert) => void
}) {
  const [busy, setBusy] = useState("")
  const [form, setForm] = useState<"unable" | "backup" | "resolve" | "locate" | null>(null)
  const [note, setNote] = useState("")
  const [backupType, setBackupType] = useState("tanod")
  const [urgency, setUrgency] = useState("high")
  const [revealed, setRevealed] = useState("")

  const acknowledged = ACKNOWLEDGED_STATUSES.includes(alert.status)

  async function run(label: string, fn: () => Promise<EmergencyAlert>, success: string) {
    setBusy(label)
    try {
      onChanged(await fn())
      toast.success(success)
      setForm(null)
      setNote("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the emergency.")
    } finally {
      setBusy("")
    }
  }

  async function contactReporter() {
    if (revealed) {
      window.location.href = `tel:${revealed}`
      return
    }
    setBusy("contact")
    try {
      const result = await revealReporterContact(alert.id)
      setRevealed(result.phone_number)
      toast.info(`Reporter: ${result.phone_number}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reveal the contact number.")
    } finally {
      setBusy("")
    }
  }

  function openNavigation() {
    if (!alert.latitude || !alert.longitude) {
      toast.info("This emergency has no map pin yet. Use the reported area or call the reporter.")
      return
    }
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${alert.latitude},${alert.longitude}`,
      "_blank",
      "noopener",
    )
  }

  const noteTooShort = note.trim().length < 5

  return (
    <div className="space-y-3">
      <section className="rounded-panel border border-card-line bg-card p-4">
        <p className="text-sm font-semibold text-brand-navy">
          {acknowledged ? "You are responding" : "Assigned to you"}
        </p>
        <p className="mt-1 text-xs font-semibold text-subtle-foreground">
          {acknowledged
            ? "Update the incident as the situation changes."
            : "This emergency is already assigned to you. Confirm so dispatch knows you are moving."}
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {!acknowledged ? (
            <>
              <Button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => run("respond", () => respondToEmergency(alert.id), "Marked as responding")}
                className="bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
              >
                <NavigationIcon className="size-4" />
                {busy === "respond" ? "Confirming" : "Responding"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => { setForm("unable"); setNote("") }}
                className="border-severity-critical/40 text-severity-critical-ink"
              >
                <TriangleAlertIcon className="size-4" />
                Unable to respond
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                disabled={Boolean(busy) || alert.status === "arrived"}
                onClick={() => run("arrived", () => markEmergencyArrived(alert.id), "Marked as at scene")}
                className="bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
              >
                <LocateFixedIcon className="size-4" />
                {busy === "arrived" ? "Updating" : "Arrived at scene"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => { setForm("resolve"); setNote("") }}
              >
                <ShieldCheckIcon className="size-4" />
                Resolved
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => { setForm("backup"); setNote("") }}
              >
                <UserPlusIcon className="size-4" />
                Request backup
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy)}
                onClick={() => { setForm("locate"); setNote("") }}
                className="border-severity-moderate/40 text-severity-moderate-ink"
              >
                <TriangleAlertIcon className="size-4" />
                Unable to locate
              </Button>
            </>
          )}
        </div>

        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" disabled={busy === "contact"} onClick={() => void contactReporter()}>
            <PhoneCallIcon className="size-4" />
            {revealed || (busy === "contact" ? "Revealing" : "Contact reporter")}
          </Button>
          <Button type="button" variant="outline" onClick={openNavigation}>
            <NavigationIcon className="size-4" />
            Open navigation
          </Button>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={Boolean(busy)}
          onClick={() => {
            if (!navigator.geolocation) {
              toast.error("GPS is not available on this device.")
              return
            }
            setBusy("ping")
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const { latitude, longitude, accuracy } = position.coords
                void run("ping", () => sendEmergencyLocationPing(alert.id, { latitude, longitude, accuracy }), "Location shared")
              },
              () => {
                setBusy("")
                toast.error("Allow location access so dispatch can see you moving.")
              },
              { enableHighAccuracy: true, timeout: 10000 },
            )
          }}
          className="mt-2 w-full"
        >
          <LocateFixedIcon className="size-4" />
          {busy === "ping" ? "Sharing GPS" : "Share my location"}
        </Button>
      </section>

      {form ? (
        <section className={cn("rounded-panel border p-4", form === "backup" ? "border-severity-moderate/40 bg-severity-moderate-surface" : "border-severity-critical/40 bg-severity-critical-surface")}>
          <p className="text-sm font-semibold text-brand-navy">
            {form === "unable" && "Why can you not respond?"}
            {form === "backup" && "What support do you need?"}
            {form === "resolve" && "Closing note"}
            {form === "locate" && "What did you find?"}
          </p>

          {form === "backup" ? (
            <div className="mt-3 grid gap-2">
              <select
                value={backupType}
                onChange={(event) => setBackupType(event.target.value)}
                className="h-10 rounded-control border border-card-line bg-card px-2 text-xs font-semibold text-brand-navy"
                aria-label="Backup type"
              >
                {BACKUP_TYPES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={urgency}
                onChange={(event) => setUrgency(event.target.value)}
                className="h-10 rounded-control border border-card-line bg-card px-2 text-xs font-semibold text-brand-navy"
                aria-label="Urgency"
              >
                {URGENCY.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={255}
            placeholder="Short operational note"
            className="mt-2 w-full resize-none rounded-panel border border-card-line bg-card px-3 py-2 text-xs text-brand-navy outline-none focus:border-brand-orange"
          />

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => { setForm(null); setNote("") }}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={Boolean(busy) || noteTooShort}
              onClick={() => {
                if (form === "unable") {
                  void run("unable", () => unableToRespond(alert.id, note.trim()), "Dispatch is assigning someone else")
                } else if (form === "backup") {
                  void run("backup", () => requestEmergencyBackup(alert.id, { backup_type: backupType, reason: note.trim(), urgency }), "Backup requested")
                } else if (form === "resolve") {
                  void run("resolve", () => resolveEmergency(alert.id, note.trim()), "Incident resolved")
                } else {
                  void run("locate", () => resolveEmergency(alert.id, `Unable to locate: ${note.trim()}`), "Recorded")
                }
              }}
              className="bg-brand-navy text-white hover:bg-brand-navy"
            >
              {busy ? "Sending" : "Confirm"}
            </Button>
          </div>
          {noteTooShort ? (
            <p className="mt-1 text-[11px] font-semibold text-subtle-foreground">
              A short note is required so the incident record explains itself later.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
