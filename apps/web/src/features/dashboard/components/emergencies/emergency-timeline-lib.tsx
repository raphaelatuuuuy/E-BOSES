import type {
  EmergencyAlert,
  EmergencyStatusEvent,
} from "@/features/dashboard/emergency-api"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import type { EmergencyTimelineEntry } from "./emergency-timeline-card"

const STATUS_META: Record<string, {
  label: string
  accent: "neutral" | "brand" | "success" | "warning" | "danger" | "info"
  icon: "inbox" | "clock" | "network" | "hardhat" | "check" | "x" | "message"
}> = {
  received: { label: "Received", accent: "info", icon: "inbox" },
  dispatched: { label: "Dispatched", accent: "info", icon: "network" },
  acknowledged: { label: "Responder preparing", accent: "brand", icon: "clock" },
  en_route: { label: "Responder en route", accent: "warning", icon: "clock" },
  nearby: { label: "Responder nearby", accent: "warning", icon: "clock" },
  on_scene: { label: "Responder on scene", accent: "brand", icon: "hardhat" },
  assisting: { label: "Assisting", accent: "brand", icon: "hardhat" },
  resolved: { label: "Resolved", accent: "success", icon: "check" },
  false_alarm: { label: "False alarm", accent: "danger", icon: "x" },
  cancelled: { label: "Cancelled", accent: "danger", icon: "x" },
  escalation_required: { label: "Escalation required", accent: "warning", icon: "message" },
}

export function buildEmergencyTimeline(alert: EmergencyAlert): EmergencyTimelineEntry[] {
  const events = [...(alert.status_events ?? [])].filter((event) => !/ai_assist|ai_|description_generated/.test(event.event_key)).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  if (events.length === 0) return []

  return events.map((event, index, list) => {
    const meta = STATUS_META[event.event_key] ?? STATUS_META[event.status] ?? {
      label: event.label || event.status,
      accent: "neutral" as const,
      icon: "clock" as const,
    }
    const isLast = index === list.length - 1

    // Some legacy resolved/closed events were written without an actor. The
    // audit log still records who performed the status change (or the
    // responder whose assignment was resolved), so keep the timeline useful
    // without changing the historical event row in the database.
    const actor = event.actor ?? legacyResolvedActor(alert, event)

    return {
      id: String(event.id),
      badge: event.label || meta.label,
      time: event.created_at,
      state: isLast ? "current" : "done",
      accent: meta.accent,
      icon: meta.icon,
      actor: actor?.full_name || "System",
      actorUser: actor,
      content: event.note ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-neutral-100 px-2.5 py-1.5 text-[11px] leading-relaxed text-neutral-600 whitespace-pre-wrap">
          <span className="min-w-0">{event.note}</span>
        </div>
      ) : null,
    }
  })
}

function legacyResolvedActor(alert: EmergencyAlert, event: EmergencyStatusEvent) {
  if (isEmergencyActive(event.status) && isEmergencyActive(alert.status)) {
    return null
  }

  const eventAt = new Date(event.created_at).getTime()
  const logs = (alert.assignment_logs ?? [])
    .filter((log) => {
      if (isEmergencyActive(log.new_status) && log.action !== "disposition") return false
      const createdAt = new Date(log.created_at).getTime()
      return !Number.isFinite(eventAt) || !Number.isFinite(createdAt) || createdAt <= eventAt + 60_000
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Disposition/status-change actor is the person who clicked Resolve. If an
  // old log has no actor, the responder on that log is the next best source.
  return logs[0]?.actor ?? logs[0]?.responder ??
    (alert.assignments ?? [])
      .filter((assignment) => !isEmergencyActive(assignment.status))
      .sort((a, b) => new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime())[0]
      ?.responder ?? null
}
