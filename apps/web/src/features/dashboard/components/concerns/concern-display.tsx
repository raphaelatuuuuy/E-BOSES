import { useEffect, useState } from "react"
import { toast } from "sonner"
import { LeafIcon, SearchIcon, ShieldCheckIcon, TrafficConeIcon } from "lucide-react"

import { openAuthenticatedMedia } from "@/features/dashboard/lib/authenticated-media"
import type {
  Concern,
  ConcernCategory,
  ConcernStatus,
  ConcernValidationStatus,
} from "@/features/dashboard/api"

/**
 * Shared display helpers for the concerns workspace (`pages/reports.tsx` +
 * `components/concerns/*`). Extracted verbatim from `reports.tsx` — single
 * source of truth so the page and the extracted official panels/sidebar
 * don't duplicate (or drift on) status/category presentation.
 */

/**
 * Local matchMedia hook for the 1280px (xl) three-column threshold — mirrors
 * `components/emergencies/lib.ts`'s `useMinWidth` (same implementation) so the
 * concerns workspace's xl-vs-Sheet gating follows the same established pattern
 * as alerts-map/emergencies. The 1024px (lg) boundary already has `useIsDesktop`
 * in `lib/shell.ts`; this covers the extra tier the concerns workspace needs
 * without touching that shared file.
 */
export function useMinWidth(px: number) {
  const [matches, setMatches] = useState(() => (typeof window !== "undefined" ? window.innerWidth >= px : true))

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`)
    const apply = () => setMatches(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [px])

  return matches
}

/** Resident-facing status filter tabs — also the canonical grouping used by `statusGroup`. */
export const filters = ["All", "Active", "Resolved", "Rejected", "Appealed"] as const

export const activeStatuses: ConcernStatus[] = ["submitted", "under_review", "assigned", "in_progress"]

/** Minimal monochrome status chips — no rainbow "AI slop" badges */
export const statusColors: Record<string, string> = {
  Active: "border-neutral-200 bg-neutral-100 text-neutral-700",
  Resolved: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Rejected: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Appealed: "border-neutral-200 bg-neutral-50 text-neutral-600",
}

export const validationLabels: Record<ConcernValidationStatus, string> = {
  pending: "Pending validation",
  accepted: "Validated",
  rejected: "Rejected",
}

export const validationColors: Record<ConcernValidationStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  accepted: "border-blue-200 bg-blue-50 text-blue-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
}

/**
 * Display name for a concern's category.
 *
 * Prefers the category row, which is what officials can rename, route and add
 * to. `categoryLabels` below is only a fallback for concerns filed before
 * categories were seeded, and for codes deleted since.
 */
export function concernCategoryLabel(concern: {
  category: string
  category_ref?: { name: string } | null
}): string {
  return concern.category_ref?.name ?? categoryLabels[concern.category as ConcernCategory] ?? concern.category
}

export const categoryLabels: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

export const categoryStyles: Record<ConcernCategory, { icon: typeof TrafficConeIcon; bg: string; text: string; sub: string }> = {
  infrastructure: { icon: TrafficConeIcon, bg: "bg-tint", text: "text-brand-blue", sub: "Roads & utilities" },
  environment: { icon: LeafIcon, bg: "bg-tint", text: "text-brand-blue", sub: "Garbage Collection" },
  public_safety: { icon: ShieldCheckIcon, bg: "bg-brand-orange-soft", text: "text-accent", sub: "Safety & response" },
  others: { icon: SearchIcon, bg: "bg-tint", text: "text-brand-blue", sub: "General concern" },
}

export function statusGroup(status: ConcernStatus): (typeof filters)[number] {
  if (activeStatuses.includes(status)) return "Active"
  if (status === "resolved") return "Resolved"
  if (status === "rejected") return "Rejected"
  if (status === "appealed") return "Appealed"
  // Fallback for any unexpected status → treat as active pipeline
  return "Active"
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

export function daysAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  return Math.max(0, Math.floor(diffMs / 86400000))
}

/** Brief list preview — hard ellipsis so rows stay short. */
export function truncateDescription(text: string, max = 72): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return "No description"
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 28 ? atWord : slice.trim()
  return `${base}...`
}

export async function openReportMedia(report: Concern) {
  if (report.media.length === 0) {
    toast.info("No evidence files uploaded.")
    return
  }
  try {
    for (const media of report.media) {
      await openAuthenticatedMedia(media.raw_url, media.original_filename)
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open report evidence.")
  }
}

/** Humanized labels for `concernFlagReasons()` codes (soft-validation queue). */
const flagReasonLabels: Record<string, string> = {
  suspicious_text: "suspicious text",
  irrelevant_text: "irrelevant text",
  category_mismatch: "category mismatch",
  possible_duplicate: "possible duplicate",
}

export function humanizeFlagReason(code: string): string {
  return flagReasonLabels[code] ?? code.replace(/_/g, " ")
}