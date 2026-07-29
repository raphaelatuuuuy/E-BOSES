/**
 * Status vocabulary shared by concerns and emergencies.
 *
 * Fifteen backend statuses collapse into three presentational groups. The group
 * drives colour and sort order; the specific status still prints as the label.
 * An official scanning a queue needs "does this need me?" answered before "what
 * exact state is this in".
 *
 * The map is a lookup with a fallback, deliberately not an exhaustive union.
 * The barangay's real concern process — mediation under RA 7160 (Captain, then
 * Lupon Tagapamayapa, then Certificate to File Action) and referral to City Hall
 * or hotline 161 — is not modelled yet. When those statuses land, they must not
 * break this module, so anything unrecognised degrades to `open` with its raw
 * label rather than throwing or rendering blank.
 */

export type StatusGroup = "open" | "active" | "closed"

export interface StatusView {
  group: StatusGroup
  label: string
}

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  open: "Needs attention",
  active: "In progress",
  closed: "Closed",
}

const GROUP_BY_STATUS: Record<string, StatusGroup> = {
  // needs someone
  submitted: "open",
  routed: "open",
  under_review: "open",
  appealed: "open",
  // someone has it
  acknowledged: "active",
  en_route: "active",
  nearby: "active",
  arrived: "active",
  assigned: "active",
  in_progress: "active",
  assisting: "active",
  // done
  resolved: "closed",
  cancelled: "closed",
  rejected: "closed",
}

const LABEL_BY_STATUS: Record<string, string> = {
  submitted: "Submitted",
  routed: "Routed",
  under_review: "Under review",
  appealed: "Appealed",
  acknowledged: "Acknowledged",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  assigned: "Assigned",
  in_progress: "In progress",
  assisting: "Assisting",
  resolved: "Resolved",
  cancelled: "Cancelled",
  rejected: "Rejected",
}

/** Turn a raw backend status into something displayable, never throwing. */
export function toStatusView(status: string | null | undefined): StatusView {
  const key = (status ?? "").trim()
  if (!key) return { group: "open", label: "Unknown" }

  return {
    group: GROUP_BY_STATUS[key] ?? "open",
    label: LABEL_BY_STATUS[key] ?? humanise(key),
  }
}

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** True when the record still needs an official to do something. */
export function needsAttention(status: string | null | undefined): boolean {
  return toStatusView(status).group === "open"
}
