import { useMemo, useState } from "react"
import { ClockIcon, MapPinIcon, PlusIcon } from "lucide-react"

import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import type { ActiveResponder } from "@/features/dashboard/api"
import { IncidentMap } from "./incident-board"
import { DispatchPanel } from "./dispatch-panel"
import { SheetDialog, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { readableLocation } from "@/features/dashboard/components/emergencies/lib"
import { EmergencyTimelineCard, type EmergencyTimelineEntry } from "./emergency-timeline-card"

const STATUS_META: Record<string, { label: string; accent: "neutral" | "brand" | "success" | "warning" | "danger" | "info"; icon: "inbox" | "clock" | "network" | "hardhat" | "check" | "x" | "message" }> = {
  received: { label: "Received", accent: "info", icon: "inbox" },
  dispatched: { label: "Dispatched", accent: "info", icon: "network" },
  acknowledged: { label: "Responder confirmed", accent: "brand", icon: "clock" },
  en_route: { label: "Responder en route", accent: "warning", icon: "clock" },
  nearby: { label: "Responder nearby", accent: "warning", icon: "clock" },
  on_scene: { label: "Responder on scene", accent: "brand", icon: "hardhat" },
  assisting: { label: "Assisting", accent: "brand", icon: "hardhat" },
  resolved: { label: "Resolved", accent: "success", icon: "check" },
  false_alarm: { label: "False alarm", accent: "danger", icon: "x" },
  cancelled: { label: "Cancelled", accent: "danger", icon: "x" },
  escalation_required: { label: "Escalation required", accent: "warning", icon: "message" },
}

function buildEmergencyTimeline(alert: EmergencyAlert): EmergencyTimelineEntry[] {
  const events = [...(alert.status_events ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  if (events.length === 0) {
    return []
  }

  return events.map((event, index, list) => {
    const meta = STATUS_META[event.event_key] ?? STATUS_META[event.status] ?? { label: event.label || event.status, accent: "neutral" as const, icon: "clock" as const }
    const isLast = index === list.length - 1

    return {
      id: String(event.id),
      badge: meta.label,
      time: event.created_at,
      state: isLast ? "current" : "done",
      accent: meta.accent,
      icon: meta.icon,
      actor: event.actor?.full_name || "System",
      actorUser: event.actor,
      content: event.note ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-neutral-100 px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-600 whitespace-pre-wrap">
          <span className="min-w-0">{event.note}</span>
        </div>
      ) : null,
    }
  })
}

export function EmergencyInfoPane({
  alert,
  responders,
  onChanged,
}: {
  alert: EmergencyAlert
  responders: ActiveResponder[]
  onChanged: (alert: EmergencyAlert) => void
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const location = readableLocation(
    alert.display_location,
    alert.resolved_location,
    alert.reported_area,
    alert.address,
    alert.barangay,
  )
  const street = streetOnly(location)

  const timeline = useMemo(() => buildEmergencyTimeline(alert), [alert])

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-5 pb-5 pt-5">
      {/* Timeline - Same styling as concern Updates */}
      <section className="flex min-h-0 flex-col rounded-[24px] bg-white p-4 ring-1 ring-neutral-200">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <ClockIcon className="size-4 text-neutral-500" />
            <h3 className="text-[14px] font-medium text-neutral-800">Updates</h3>
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            title="View full details"
            className="flex size-8 items-center justify-center rounded-full text-neutral-500 ring-1 ring-neutral-200 transition-colors hover:bg-neutral-50 hover:text-neutral-800"
          >
            <PlusIcon className="size-4" />
          </button>
        </div>
        <div className="scrollbar-hide mt-3 max-h-[clamp(10rem,35vh,28rem)] overflow-y-auto overscroll-contain pr-1">
          <EmergencyTimelineCard
            key={alert.id}
            items={timeline}
            collapsibleHistory
            emptyLabel="No timeline events have been recorded for this emergency yet."
          />
        </div>
      </section>

      {/* Location - Real-time tracking */}
      <section className="flex min-h-0 flex-[2] flex-col overflow-hidden rounded-[24px] bg-white ring-1 ring-neutral-200">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <MapPinIcon className="size-4 shrink-0 text-neutral-500" />
            <h3 className="shrink-0 text-[14px] font-medium text-neutral-800">Location</h3>
            {street ? (
              <span className="min-w-0 truncate text-[12px] font-normal text-neutral-400">
                {street}
              </span>
            ) : null}
          </div>

        </div>



        <div className="min-h-0 flex-1 p-3">
          <div className="h-full w-full overflow-hidden rounded-[16px] border border-neutral-100">
            <IncidentMap alert={alert} />
          </div>
        </div>
      </section>

      {/* Emergency Details Dialog - Same pattern as concern Updates dialog */}
      <SheetDialog
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Updates"
        description="Full status history for this emergency."
      >
        {/* Full Timeline */}
        <div className="mb-6">
          <p className="mb-3 text-[13px] font-normal text-neutral-500">Timeline</p>
          <EmergencyTimelineCard
            key={`timeline-dialog-${alert.id}`}
            items={timeline}
            collapsibleHistory
            emptyLabel="No timeline events have been recorded for this emergency yet."
          />
        </div>

        {/* Response Team & Actions - Combined */}
        <DispatchPanel alert={alert} responders={responders} onChanged={onChanged} />

        {/* Footer buttons - Same styling as concern Updates dialog */}
        <div className="flex gap-2 pt-4">
          <SheetSecondaryButton
            onClick={() => setDetailsOpen(false)}
            className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]"
          >
            Close
          </SheetSecondaryButton>
        </div>
      </SheetDialog>
    </div>
  )
}
