import type { ReactNode } from "react"

import type { Concern, PublicUser } from "@/features/dashboard/api"

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
}

function roleLabel(user?: PublicUser | null) {
  if (!user) return "System"
  if (user.role === "resident") return "Resident"
  if (user.role === "barangay_official") return "Official"
  if (user.role === "first_responder") return "Responder"
  return user.role?.replace(/_/g, " ") || "User"
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
  if (status === "submitted") return "New"
  if (status === "under_review") return "Under Review"
  if (status === "assigned") return "Assigned"
  if (status === "in_progress") return "In Progress"
  if (status === "resolved") return "Resolved"
  if (status === "rejected") return "Rejected"
  if (status === "appealed") return "Appealed"
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

function timelineContentForEvent(status: string, note: string, actor: PublicUser | null) {
  if (status === "under_review") {
    return (
      <p className="font-medium text-muted-foreground">
        Your concern is under review. Thanks for your patience.
      </p>
    )
  }

  const message = note.trim() || "Status updated."
  return (
    <div className="space-y-1">
      <p className="font-medium text-muted-foreground">{message}</p>
      {actor?.full_name ? (
        <p className="text-[13px] font-semibold text-subtle-foreground">
          {actor.full_name} <span className="text-subtle-foreground">·</span> {roleLabel(actor)}
        </p>
      ) : null}
    </div>
  )
}

export function buildConcernTimelineEntries(report: Concern): ConcernTimelineEntry[] {
  const events = [...(report.status_events ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  // Annotated so the object literal is checked against the entry type. Without
  // it TS widens `"current" | "done"` to `string` and the array stops being
  // assignable to ConcernTimelineEntry[].
  const entries: ConcernTimelineEntry[] = events.map((event, index, list) => ({
    id: String(event.id),
    badge: concernTimelineStatusLabel(event.status),
    time: event.created_at,
    state: index === list.length - 1 ? "current" : "done",
    accent: concernTimelineStatusAccent(event.status),
    content: timelineContentForEvent(event.status, event.note, event.status === "under_review" ? null : event.actor),
  }))

  if (entries.length > 0) return entries

  return [
    {
      id: "submitted",
      badge: "New",
      time: report.created_at,
      state: "current",
      accent: "danger",
      content: timelineContentForEvent("submitted", "Report submitted.", null),
    },
  ]
}
