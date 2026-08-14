import { useEffect, useState } from "react"
import { ChevronDownIcon, LoaderCircleIcon, MapPinIcon, PhoneIcon, UsersIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { initials } from "@/lib/initials"
import type {
  EmergencyAlert,
  EmergencyRoute,
  TravelProfile,
} from "@/features/dashboard/emergency-api"
import { listEmergencyChat } from "@/features/dashboard/emergency-api"
import { useReporterPhone } from "@/features/dashboard/lib/use-reporter-phone"
import { RouteSteps } from "@/features/dashboard/components/responder/route-steps"
import type { StepProgress } from "@/features/dashboard/lib/route-progress"
import { dispatchState, formatAgo } from "@/features/dashboard/lib/responder-format"
import { DispatchDetails } from "@/features/dashboard/components/responder/dispatch-details"
import { DispatchTimeline } from "@/features/dashboard/components/responder/dispatch-timeline"
import { OpsContrastToggle } from "@/features/dashboard/components/responder/ops-contrast-toggle"
import { DutyToggle } from "@/features/dashboard/components/responder/duty-toggle"
import { MetricTiles } from "@/features/dashboard/components/responder/metric-tiles"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import {
  CardHead,
  DispatchCard,
  Segmented,
  State,
} from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * Call flow: the button reveals the number server-side (which also logs the
 * reveal for privacy audit) and then immediately hands the number to the OS
 * dialer via `tel:`. The same reveal feeds the resident row, so the digits
 * appear once — on screen under the name, and in the dialer.
 */

function ResidentCallButton({ busy, onCall }: { busy: boolean; onCall: () => void }) {
  return (
    <button
      type="button"
      onClick={onCall}
      disabled={busy}
      aria-label="Call the resident"
      title="Call the resident"
      className="flex h-10 shrink-0 items-center gap-2 rounded-pill border border-card-line-strong px-3.5 text-label text-ice transition-colors duration-[--duration-micro] hover:bg-card-raised disabled:opacity-60"
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
      ) : (
        <PhoneIcon className="size-4 shrink-0" />
      )}
      {busy ? "Opening…" : "Call resident"}
    </button>
  )
}
  const VIEWS = [
  { id: "details", label: "Details" },
  { id: "tracking", label: "Tracking" },
  { id: "route", label: "Route" },
  { id: "chat", label: "Chat" },
] as const

type View = (typeof VIEWS)[number]["id"]

/** Assignment statuses that mean a unit is still working the incident. */
const SUPPORTED_ACTIVE = new Set([
  "assigned",
  "acknowledged",
  "en_route",
  "nearby",
  "arrived",
  "assisting",
  "in_progress",
])

const SUPPORT_STATUS_WORDS: Record<string, string> = {
  assigned: "Assigned",
  acknowledged: "Responding",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "On scene",
  assisting: "Assisting",
  in_progress: "In progress",
}

/** How often the Chat tab watches for a resident message while it is closed. */
const CHAT_UNREAD_POLL_MS = 20_000

export function DispatchOverviewCard({
  alert,
  viewerId,
  distance,
  now,
  route,
  progress,
  travelProfile,
  onTravelProfileChange,
  travelProfileBusy = false,
  onMinimise,
  showDutyToggle,
  className,
}: {
  alert: EmergencyAlert
  viewerId: number | null
  /** Live straight-line distance from the responder's GPS, in km. */
  distance: number | null
  /** Shared clock tick so Elapsed advances with the rest of the screen. */
  now: number
  route: EmergencyRoute | null
  progress: StepProgress | null
  travelProfile: TravelProfile
  onTravelProfileChange: (next: TravelProfile) => void
  travelProfileBusy?: boolean
  /**
   * Collapses the whole incident column. Lives on this card rather than on the
   * split divider because this is the card that owns the incident — the same
   * place the reference puts its overflow control.
   */
  onMinimise?: () => void
  showDutyToggle?: boolean
  className?: string
}) {
  // Tracking first: the responder's own progress is why this screen exists.
  const [view, setView] = useState<View>("tracking")
  const state = dispatchState(alert, viewerId)
  const location = alert.display_location || alert.address || alert.barangay
  const { phone, busy, call } = useReporterPhone(alert, { autoReveal: true })

  // While the Chat tab is open, everything on it counts as seen.
  const [chatSeenAt, setChatSeenAt] = useState<number | null>(null)
  const [chatUnread, setChatUnread] = useState(false)
  useEffect(() => {
    if (view !== "chat") return
    const id = window.setInterval(() => setChatSeenAt(Date.now()), 4000)
    return () => window.clearInterval(id)
  }, [view])

  // While it is closed, keep an eye on the thread: a resident message that
  // lands on Tracking or Details gets a small dot on the Chat tab instead of
  // arriving invisibly.
  useEffect(() => {
    if (view === "chat") return
    let cancelled = false
    const check = async () => {
      try {
        const messages = await listEmergencyChat(alert.id)
        const last = messages.at(-1)
        if (cancelled || !last) return
        setChatUnread(chatSeenAt != null && new Date(last.created_at).getTime() > chatSeenAt)
      } catch {
        // Offline: keep the current badge instead of flapping it.
      }
    }
    void check()
    const id = window.setInterval(() => void check(), CHAT_UNREAD_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [view, alert.id, chatSeenAt])

  const views: Array<{ id: View; label: string; badge?: boolean }> = VIEWS.map((entry) =>
    entry.id === "chat" ? { ...entry, badge: chatUnread } : entry,
  )

  const support = alert.assignments.filter(
    (assignment) =>
      assignment.responder.id !== viewerId && SUPPORTED_ACTIVE.has(assignment.status),
  )
  // Old rows may carry "Pending" as a legacy default on both the reporter's
  // full_name and their barangay; treat that literal as empty so the UI reads
  // "Resident" / "Marikina Heights" instead of exposing the placeholder.
  const rawName = alert.reporter.full_name?.trim() ?? ""
  const reporterName = rawName && rawName !== "Pending" ? rawName : "Resident"
  const rawBarangay = alert.barangay?.trim() ?? ""
  const reporterBarangay =
    rawBarangay && rawBarangay !== "Pending" ? rawBarangay : "Marikina Heights"


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
          <div className="hidden items-center gap-1 lg:flex">
            {showDutyToggle !== false ? <DutyToggle /> : null}
            <OpsContrastToggle />
            {onMinimise ? (
              <button
                type="button"
                onClick={onMinimise}
                aria-label="Minimise incident column"
                title="Minimise"
                className="flex size-11 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground"
              >
                <ChevronDownIcon className="size-5 rotate-90" strokeWidth={2.4} />
              </button>
            ) : null}
          </div>
        }
      />

      {/* Resident, location and readouts — one cell instead of the two cards
          and a stray paragraph this used to be. The name identifies the
          resident; the number sits under it and falls back to the barangay
          while the audited reveal is still in flight. */}
      <div className="overflow-hidden rounded-2xl border border-card-line bg-card-raised">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ice/10 text-[12px] font-semibold text-ice">
              {initials(reporterName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-heading text-foreground">{reporterName}</p>
              <p className="truncate text-body tabular-nums text-subtle-foreground">
                {phone ?? reporterBarangay}
              </p>
            </div>
          </div>
          <ResidentCallButton busy={busy} onCall={() => void call()} />
        </div>

        {location ? (
          <div className="flex items-start gap-2 border-t border-card-line px-3 py-3 text-body leading-6 text-muted-foreground">
            <MapPinIcon className="mt-1 size-4 shrink-0 text-subtle-foreground" />
            <span className="min-w-0">{location}</span>
          </div>
        ) : null}

        {/* Backup and support units that joined this incident — the primary
            responder should see who is coming without digging through the
            timeline. */}
        {support.length > 0 ? (
          <div className="border-t border-card-line px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-micro text-subtle-foreground">
              <UsersIcon className="size-3" /> Supporting units
            </p>
            <ul className="mt-1.5 space-y-1">
              {support.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0 truncate text-body text-foreground">
                    {assignment.responder.full_name || "Responder"}
                  </span>
                  <span className="shrink-0 text-micro text-subtle-foreground">
                    {SUPPORT_STATUS_WORDS[assignment.status] ??
                      assignment.status.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <MetricTiles bare alert={alert} distance={distance} now={now} />
      </div>

      <Segmented
        options={views}
        value={view}
        onChange={(next) => {
          if (next === "chat") setChatUnread(false)
          setView(next)
        }}
        label="Dispatch view"
      />

      {view === "tracking" ? (
        <DispatchTimeline alert={alert} viewerId={viewerId} />
      ) : view === "route" ? (
        <RouteSteps
          route={route}
          progress={progress}
          profile={travelProfile}
          onProfileChange={onTravelProfileChange}
          busy={travelProfileBusy}
        />
      ) : view === "chat" ? (
        <div className="-mx-5 -mb-5 mt-4 border-t border-card-line lg:-mx-6 lg:-mb-6">
          <EmergencyChatPanel
            alertId={alert.id}
            open
            theme="dark"
            bare
            disabled={["resolved", "cancelled"].includes(alert.status)}
            className="h-[400px] lg:h-[min(52svh,500px)]"
          />
        </div>
      ) : (
        <DispatchDetails alert={alert} />
      )}
    </DispatchCard>
  )
}
