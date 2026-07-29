import type { BarPoint } from "@/features/dashboard/components/charts"
import type { Concern } from "@/features/dashboard/api"

/**
 * Series derivation for the official overview.
 *
 * The official summary endpoint returns 13 plain integers with no time
 * dimension, so every chart on the overview is bucketed here from the managed
 * concern list the page already fetches. Kept out of the component files so
 * they stay component-only (react-refresh).
 */

const DAY_MS = 86400000
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

/** Bucket a concern list into the last `days` days, oldest first. */
export function dailyCounts(concerns: readonly Concern[], days: number): BarPoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (days - 1) * DAY_MS

  const buckets = new Array<number>(days).fill(0)
  concerns.forEach((concern) => {
    const created = new Date(concern.created_at).getTime()
    if (!Number.isFinite(created) || created < start) return
    const index = Math.floor((created - start) / DAY_MS)
    if (index >= 0 && index < days) buckets[index] += 1
  })

  return buckets.map((value, index) => {
    const date = new Date(start + index * DAY_MS)
    return {
      label: DAY_LETTERS[date.getDay()],
      value,
      caption: new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date),
    }
  })
}
