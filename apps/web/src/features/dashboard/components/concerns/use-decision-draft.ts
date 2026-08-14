import { useState } from "react"

import type { Concern } from "@/features/dashboard/api"

/**
 * The official's unsaved decision about a report.
 *
 * Lifted out of `OfficialStatusPanel` so the report information pane and the
 * update form stay in step, and so the draft survives report switches without
 * a remount flicker: switching reports is a render-adjust keyed on report id
 * rather than an effect, so a new report never renders once holding the
 * previous one's values.
 */

/**
 * Wording an official (and the resident who sees the update) can act on.
 *
 * These describe what is happening to the resident's report, not the internal
 * state machine, and match the resident-facing vocabulary in plain-language.ts
 * so both sides of the report read the same word for the same state.
 */
const STATUS_CHOICE_LABEL: Record<string, string> = {
  submitted: "Received",
  under_review: "Being checked",
  assigned: "Reassigned to another unit",
  in_progress: "Being worked on",
  resolved: "Resolved",
  rejected: "Denied appeal",
  appealed: "Under appeal",
}

/** Every status an official may move a report to. */
export const ALL_STATUSES = [
  "submitted",
  "under_review",
  "assigned",
  "in_progress",
  "resolved",
  "rejected",
  "appealed",
] as const

/**
 * Which statuses the dropdown offers, in order.
 *
 * Every status, not just the legal next moves: the backend enforces
 * transitions on save, but officials asked to see the whole lifecycle so they
 * can pick what the report is actually heading for instead of what the map
 * happens to permit. A custom status is offered separately by the panel.
 */
export function statusOptionsFor(): string[] {
  return [...ALL_STATUSES]
}

export function statusLabel(status: string) {
  return (
    STATUS_CHOICE_LABEL[status] ??
    status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  )
}

/**
 * Turn a typed custom status into the stored slug form.
 *
 * "Schedule", "on hold", "Awaiting Parts" all become lowercase underscore
 * slugs ("schedule", "on_hold", "awaiting_parts") — the same shape as the
 * enum values, so filtering, badges and the timeline treat them uniformly.
 */
export function slugifyStatus(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
}

export interface DecisionDraft {
  status: string
  setStatus: (next: string) => void
  note: string
  setNote: (next: string) => void
  internalNote: string
  setInternalNote: (next: string) => void
  resolutionFiles: File[]
  setResolutionFiles: (next: File[]) => void
}

/**
 * `report` is nullable because the hook has to run before a concern is picked —
 * the queue pane renders with nothing selected, and hooks cannot be conditional.
 * With no report the draft is inert: empty values.
 */
export function useDecisionDraft(report: Concern | null | undefined): DecisionDraft {
  const initialStatus: string =
    !report || report.status === "submitted" ? "under_review" : report.status
  const [status, setStatus] = useState<string>(initialStatus)
  const [note, setNote] = useState(report?.update_text || "")
  const [internalNote, setInternalNote] = useState("")
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([])

  // Switching reports discards the draft. Render-adjust rather than an effect,
  // so the new report never renders once holding the previous one's values.
  const [prevReportId, setPrevReportId] = useState(report?.id ?? null)
  if (prevReportId !== (report?.id ?? null)) {
    setPrevReportId(report?.id ?? null)
    setStatus(initialStatus)
    setNote(report?.update_text || "")
    setInternalNote("")
    setResolutionFiles([])
  }

  return {
    status,
    setStatus,
    note,
    setNote,
    internalNote,
    setInternalNote,
    resolutionFiles,
    setResolutionFiles,
  }
}
