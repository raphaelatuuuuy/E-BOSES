import {
  LeafIcon,
  SearchIcon,
  ShieldCheckIcon,
  TrafficConeIcon,
} from "lucide-react"

import type {
  ConcernCategory,
  ConcernStatus,
  ConcernValidationStatus,
} from "@/features/dashboard/api"
import { ACTIVE_CONCERN_STATUSES } from "@/features/dashboard/components/record/status"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"
import { useMinWidth } from "@/features/dashboard/lib/shell"

export { useMinWidth }

export const filters = [
  "All",
  "Active",
  "Resolved",
  "Rejected",
  "Appealed",
] as const

export const activeStatuses: ConcernStatus[] = [...ACTIVE_CONCERN_STATUSES]

export const validationLabels: Record<ConcernValidationStatus, string> = {
  pending: "Pending validation",
  accepted: "Validated",
  rejected: "Rejected",
}

export function concernCategoryLabel(concern: {
  category: string
  category_ref?: { name: string } | null
}): string {
  return (
    concern.category_ref?.name ??
    categoryLabels[concern.category as ConcernCategory] ??
    concern.category
  )
}

export const categoryLabels: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

export const categoryStyles: Record<
  ConcernCategory,
  { icon: typeof TrafficConeIcon; bg: string; text: string; sub: string }
> = {
  infrastructure: {
    icon: TrafficConeIcon,
    bg: "bg-tint",
    text: "text-brand-blue",
    sub: "Roads & utilities",
  },
  environment: {
    icon: LeafIcon,
    bg: "bg-tint",
    text: "text-brand-blue",
    sub: "Garbage Collection",
  },
  public_safety: {
    icon: ShieldCheckIcon,
    bg: "bg-brand-orange-soft",
    text: "text-accent",
    sub: "Safety & response",
  },
  others: {
    icon: SearchIcon,
    bg: "bg-tint",
    text: "text-brand-blue",
    sub: "General concern",
  },
}

export function statusGroup(status: ConcernStatus): (typeof filters)[number] {
  if (activeStatuses.includes(status)) return "Active"
  if (isResolvedRecord({ status })) return "Resolved"
  if (status === "rejected") return "Rejected"
  if (status === "appealed") return "Appealed"
  return "Active"
}

export function unitShortTag(
  unit: { short_name?: string; code?: string; name?: string } | null | undefined
): string {
  if (!unit) return ""
  const raw = (unit.short_name || unit.code || unit.name || "").trim()
  if (!raw) return ""
  const paren = raw.match(/\(([^)]+)\)/)
  if (paren)
    return paren[1]
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 6)
      .toUpperCase()
  if (/[^A-Za-z0-9]/.test(raw)) {
    const words = raw.split(/\s+/).filter(Boolean)
    if (words.length > 1 && words.length <= 5) {
      const letters = words.map((word) => word[0]).join("")
      if (letters.length >= 2 && letters.length <= 5)
        return letters.toUpperCase()
    }
  }
  return raw
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase()
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
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

export function truncateDescription(text: string, max = 72): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return "No description"
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 28 ? atWord : slice.trim()
  return `${base}...`
}

const flagReasonLabels: Record<string, string> = {
  suspicious_text: "suspicious text",
  irrelevant_text: "irrelevant text",
  possible_duplicate: "possible duplicate",
}

export function humanizeFlagReason(code: string): string {
  return flagReasonLabels[code] ?? code.replace(/_/g, " ")
}
