import { useState } from "react"
import { ChevronDownIcon, LoaderCircleIcon, MapPinIcon, PhoneIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { initials } from "@/lib/initials"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { revealReporterContact } from "@/features/dashboard/emergency-api"
import { dispatchState, formatAgo } from "@/features/dashboard/lib/responder-format"
import { DispatchDetails } from "@/features/dashboard/components/responder/dispatch-details"
import { DispatchTimeline } from "@/features/dashboard/components/responder/dispatch-timeline"
import { MetricTiles } from "@/features/dashboard/components/responder/metric-tiles"
import {
  CardHead,
  DispatchCard,
  Segmented,
  State,
} from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * Call flow: the button reveals the number server-side (which also logs the
 * reveal for privacy audit) and then immediately hands the number to the OS
 * dialer via `tel:`. The responder never sees the raw digits in the DOM, and
 * the number never lands in a toast, chat or clipboard.
 */

const VIEWS = [
  { id: "details", label: "Details" },
  { id: "tracking", label: "Tracking" },
] as const

type View = (typeof VIEWS)[number]["id"]

function ReporterPhoneControl({ alert }: { alert: EmergencyAlert }) {
  const [busy, setBusy] = useState(false)

  async function handleCall() {
    if (busy) return
    setBusy(true)
    try {
      // If the alert already carries an unmasked number, skip the reveal call
      // and dial straight away. Otherwise, reveal via API (which logs the
      // access) then invoke the device dialer.
      const raw = alert.reporter_phone?.trim() ?? ""
      const alreadyReadable = /[0-9]/.test(raw) && !/[•*x]/i.test(raw)
      const phone = alreadyReadable
        ? raw
        : (await revealReporterContact(alert.id)).phone_number
      // `tel:` hands off to the OS dialer; the digits never render into the
      // DOM, get copied to the clipboard, or land in a toast.
      window.location.href = `tel:${phone.replace(/\s+/g, "")}`
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the dialer.", {
        id: "call-reporter",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleCall()}
      disabled={busy}
      aria-label="Call the reporter"
      title="Call the reporter"
      className="flex h-9 shrink-0 items-center gap-2 rounded-pill border border-card-line-strong px-3.5 text-label text-ice transition-colors duration-[--duration-micro] hover:bg-card-raised disabled:opacity-60"
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
      ) : (
        <PhoneIcon className="size-4 shrink-0" />
      )}
      {busy ? "Opening…" : "Call reporter"}
    </button>
  )
}

export function DispatchOverviewCard({
  alert,
  viewerId,
  distance,
  now,
  onMinimise,
  className,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  /** Live straight-line distance from the responder's GPS, in km. */
  distance: number | null
  /** Shared clock tick so Elapsed advances with the rest of the screen. */
  now: number
  /**
   * Collapses the whole incident column. Lives on this card rather than on the
   * split divider because this is the card that owns the incident — the same
   * place the reference puts its overflow control.
   */
  onMinimise?: () => void
  className?: string
}) {
  // Tracking first: the responder's own progress is why this screen exists.
  const [view, setView] = useState<View>("tracking")
  const state = dispatchState(alert, viewerId)
  const location = alert.display_location || alert.address || alert.barangay
  // Old rows may carry "Pending" as a legacy default on both the reporter's
  // full_name and their barangay; treat that literal as empty so the UI reads
  // "Resident" / "Marikina Heights" instead of exposing the placeholder.
  const rawName = alert.reporter.full_name?.trim() ?? ""
  const reporterName = rawName && rawName !== "Pending" ? rawName : "Resident"
  const rawBarangay = alert.barangay?.trim() ?? ""
  const reporterBarangay =
    rawBarangay && rawBarangay !== "Pending" ? rawBarangay : "Resident"

  return (
    <DispatchCard className={cn("space-y-5", className)}>
      <CardHead
        title={
          <>
            <span className="capitalize">{alert.type}</span>{" "}
            {/* `public_id` is a full UUID. The first block is enough to read
                one dispatch apart from another over the radio, and the whole
                value only ever truncated to an ellipsis here anyway. */}
            <span className="text-subtle-foreground" title={alert.public_id}>
              #{alert.public_id.split("-")[0]?.toUpperCase() ?? alert.public_id}
            </span>
          </>
        }
        subtitle={
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <State label={state.label} tone={state.tone} />
            <span className="text-body text-subtle-foreground">{formatAgo(alert.created_at)}</span>
          </div>
        }
        action={
          onMinimise ? (
            <button
              type="button"
              onClick={onMinimise}
              aria-label="Minimise incident column"
              title="Minimise"
              className="hidden size-11 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground lg:flex"
            >
              <ChevronDownIcon className="size-5 rotate-90" strokeWidth={2.4} />
            </button>
          ) : undefined
        }
      />

      {/* The person waiting, on the same card as the incident. The raised row
          separates the reporter from the incident content without a second
          bordered card — the hierarchy the two stacked cards used to fake. */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-card-line bg-card-raised px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ice/10 text-[12px] font-black text-ice">
            {initials(reporterName)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-heading text-foreground">{reporterName}</p>
            <p className="truncate text-body text-subtle-foreground">{reporterBarangay}</p>
          </div>
        </div>
        <ReporterPhoneControl alert={alert} />
      </div>

      {location ? (
        <p className="flex items-start gap-2 text-body leading-6 text-muted-foreground">
          <MapPinIcon className="mt-1 size-4 shrink-0 text-subtle-foreground" />
          <span className="min-w-0">{location}</span>
        </p>
      ) : null}

      <MetricTiles alert={alert} distance={distance} now={now} />

      <Segmented options={VIEWS} value={view} onChange={setView} label="Dispatch view" />

      {view === "tracking" ? (
        <DispatchTimeline alert={alert} viewerId={viewerId} />
      ) : (
        <DispatchDetails alert={alert} />
      )}
    </DispatchCard>
  )
}
