import type { ReactNode } from "react"

import type { Concern, PublicUser } from "@/features/dashboard/api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import {
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { roleLabel } from "@/features/dashboard/lib/people"

/**
 * Timeline vocabulary: types, accent styling and entry building.
 *
 * Split from the `ConcernTimeline` component so that file exports a component
 * and nothing else. A module mixing the two is not a Fast Refresh boundary, so
 * editing any helper here used to force a full reload of whichever concern the
 * official had open.
 */

export type ConcernTimelineState = "done" | "current" | "pending" | "cancelled"
export type ConcernTimelineAccent =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "cyan"
  | "violet"

export type ConcernTimelineEntry = {
  id: string
  badge: string
  time: string | null
  content: ReactNode
  state?: ConcernTimelineState
  accent?: ConcernTimelineAccent
  actor?: string | null
}

/**
 * Timeline accents, on semantic tokens.
 *
 * This component renders in both shells — the official record and the resident
 * detail sidebar — so it cannot hardcode colour: the same badge has to read on
 * white and on #0e1424. Every pair below resolves through tokens that are
 * defined in both themes, and each was chosen so the light rendering stays
 * within a shade of what it replaced.
 *
 * `brand` maps to tint/brand-navy rather than brand orange on purpose: orange
 * text on the orange tint is roughly 2.6:1 in light mode, which is unreadable.
 */
const accentStyles: Record<ConcernTimelineAccent, { badge: string; dot: string }> = {
  neutral: { badge: "border-card-line bg-card-raised text-muted-foreground", dot: "border-subtle-foreground bg-card" },
  brand: { badge: "border-card-line-strong bg-tint text-brand-navy", dot: "border-brand-navy bg-card" },
  success: { badge: "border-status-closed/35 bg-status-closed-surface text-status-closed-ink", dot: "border-status-closed bg-card" },
  warning: { badge: "border-severity-moderate/35 bg-severity-moderate-surface text-severity-moderate-ink", dot: "border-severity-moderate bg-card" },
  danger: { badge: "border-severity-critical/35 bg-severity-critical-surface text-severity-critical-ink", dot: "border-severity-critical bg-card" },
  info: { badge: "border-status-active/35 bg-status-active-surface text-status-active-ink", dot: "border-status-active bg-card" },
  cyan: { badge: "border-ice-dim/40 bg-ice-soft text-ice", dot: "border-ice-dim bg-card" },
  violet: { badge: "border-chart-3/35 bg-chart-3/12 text-chart-3", dot: "border-chart-3 bg-card" },
}

export function formatTimelineTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function concernTimelineBadgeTone(accent: ConcernTimelineAccent = "neutral") {
  return accentStyles[accent].badge
}

export function concernTimelineDotTone(accent: ConcernTimelineAccent = "neutral") {
  return accentStyles[accent].dot
}

export function concernTimelineStatusLabel(status: string) {
  if (status === "submitted") return "Your concern is now under review"
  if (status === "under_review") return "Update"
  if (status === "assigned") return "Reassigned to another unit"
  if (status === "in_progress") return "Being worked on"
  if (status === "resolved") return "Resolved"
  if (status === "rejected") return "Denied appeal"
  if (status === "appealed") return "Under appeal"
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

export function concernTimelineStatusAccent(status: string): ConcernTimelineAccent {
  if (status === "submitted") return "info"
  if (status === "under_review") return "neutral"
  if (status === "assigned") return "brand"
  if (status === "in_progress") return "info"
  if (status === "resolved") return "success"
  if (status === "rejected") return "danger"
  if (status === "appealed") return "violet"
  return "neutral"
}

const SUBMITTED_WELCOME_NOTES = new Set([
  "Report submitted.",
  "Received. A barangay officer will review this shortly.",
  "Received. We're confirming the location before routing this.",
])

const AUTO_UNDER_REVIEW_NOTES = new Set([
  "An officer is checking the details of this report.",
  "Report submitted and accepted for routing.",
])

function actorLabel(actor: PublicUser | null): string | null {
  if (!actor?.full_name) return null
  return `${actor.full_name} · ${roleLabel(actor) || "System"}`
}

function timelineContentForEvent(status: string, note: string, _actor: PublicUser | null, departmentName: string) {
  const text = note.trim()
  if (status === "submitted" && SUBMITTED_WELCOME_NOTES.has(text)) {
    return (
      <div className="space-y-1">
        <p className="text-[13px] text-neutral-700">Thank you for your patience.</p>
      </div>
    )
  }
  if (status === "assigned") {
    const autoAssigned = /^(Assigned to |Reassigned to another unit)/.test(text)
    return (
      <div className="space-y-1">
        {text && !autoAssigned ? <p className="text-[13px] text-neutral-700">{text}</p> : null}
        {departmentName ? <p className="text-[13px] text-neutral-700">{departmentName}</p> : null}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-[13px] text-neutral-700">{text || "Status updated."}</p>
    </div>
  )
}

export function buildConcernTimelineEntries(
  report: Concern,
  onOpenProof?: (items: MediaPreviewItem[], index: number) => void,
): ConcernTimelineEntry[] {
  const events = [...(report.status_events ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const departmentName = report.assigned_department?.name ?? ""
  const visibleEvents = events.filter(
    (event) =>
      !(event.status === "under_review" && AUTO_UNDER_REVIEW_NOTES.has(event.note.trim())),
  )

  const proof = (report.resolution_evidence ?? []).filter((item) =>
    item.mime_type.startsWith("image/"),
  )
  const proofPreview = proof.map((item) =>
    toMediaPreviewItem(item.preview_url || item.raw_url, item.original_filename, item.mime_type),
  )

  const entries: ConcernTimelineEntry[] = visibleEvents.map((event, index, list) => ({
    id: String(event.id),
    badge: concernTimelineStatusLabel(event.status),
    time: event.created_at,
    state: index === list.length - 1 ? "current" : "done",
    accent: concernTimelineStatusAccent(event.status),
    actor: actorLabel(event.actor),
    content: (
      <div className="space-y-2">
        {timelineContentForEvent(event.status, event.note, event.actor, departmentName)}
        {event.status === "resolved" && proof.length ? (
          <div className="grid grid-cols-2 gap-2">
            {proof.map((item, proofIndex) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenProof?.(proofPreview, proofIndex)}
                className="overflow-hidden rounded-control border border-card-line bg-canvas text-left"
                title={item.original_filename}
              >
                <AuthenticatedMediaImage
                  src={item.preview_url || item.raw_url}
                  alt={item.original_filename}
                  className="h-24 w-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ),
  }))

  if (entries.length > 0) return entries

  return [
    {
      id: "submitted",
      badge: "Your concern is now under review",
      time: report.created_at,
      state: "current",
      accent: "info",
      content: timelineContentForEvent("submitted", "Report submitted.", null, ""),
    },
  ]
}
