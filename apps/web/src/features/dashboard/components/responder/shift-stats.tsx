import { CheckCheckIcon, TriangleAlertIcon } from "lucide-react"

import { MetricTile } from "@/features/dashboard/components/responder/dispatch-surface"

export interface ShiftLiveStats {
  active: number
  resolved: number
  routed: number
  enRoute: number
}

export function ShiftStats({ loading, stats }: { loading: boolean; stats: ShiftLiveStats }) {
  const value = (n: number) => (loading ? "—" : String(n))

  return (
    <section
      aria-busy={loading}
      aria-label="Shift figures"
      className="grid grid-cols-2 gap-3"
    >
      <MetricTile
        icon={TriangleAlertIcon}
        value={value(stats.active)}
        label="Active dispatches"
        tone={!loading && stats.active > 0 ? "alarm" : "ice"}
      />
      <MetricTile
        icon={CheckCheckIcon}
        value={value(stats.resolved)}
        label="Resolved"
        tone="settled"
      />
    </section>
  )
}
