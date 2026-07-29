import { cn } from "@workspace/ui/lib/utils"

/**
 * Live shift figures.
 *
 * Plain numbers on one bounded strip rather than four bordered cards each
 * holding a tinted chip: at these magnitudes the number is the whole message,
 * and the chips were doing nothing but adding colour. The accent survives as a
 * dot beside the label, so "active dispatches" still reads as the urgent one.
 *
 * Two across on a phone, four from 768px.
 */
type Tone = "alarm" | "warm" | "live" | "settled"

const dotClass: Record<Tone, string> = {
  alarm: "bg-sos",
  warm: "bg-brand-orange",
  live: "bg-ice",
  settled: "bg-status-closed",
}

function Stat({
  label,
  value,
  tone,
  loading,
}: {
  label: string
  value: number
  tone: Tone
  loading: boolean
}) {
  return (
    <div className="min-w-0 px-4 py-4">
      <p className="flex items-center gap-1.5 text-micro uppercase tracking-wide text-nav-muted">
        <span className={cn("size-1.5 shrink-0 rounded-full", dotClass[tone])} aria-hidden />
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-2 text-3xl font-bold leading-none tabular-nums text-foreground">
        {loading ? "0" : value}
      </p>
    </div>
  )
}

export interface ShiftLiveStats {
  active: number
  resolved: number
  routed: number
  enRoute: number
}

export function ShiftStats({ loading, stats }: { loading: boolean; stats: ShiftLiveStats }) {
  return (
    <section
      aria-busy={loading}
      className="grid grid-cols-2 divide-x divide-y divide-card-line overflow-hidden rounded-2xl border border-card-line bg-card md:grid-cols-4 md:divide-y-0"
    >
      <Stat label="Active dispatches" value={stats.active} tone="alarm" loading={loading} />
      <Stat label="Automatically routed" value={stats.routed} tone="warm" loading={loading} />
      <Stat label="En route" value={stats.enRoute} tone="live" loading={loading} />
      <Stat label="Resolved" value={stats.resolved} tone="settled" loading={loading} />
    </section>
  )
}
