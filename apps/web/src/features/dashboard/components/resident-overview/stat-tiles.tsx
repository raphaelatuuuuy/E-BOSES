import { useNavigate } from "react-router-dom"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { formatCount } from "@/features/dashboard/lib/overview-chart"

const defaultTiles = [
  {
    key: "total",
    label: "Total reports",
    caption: "Everything you filed",
    tone: "bg-brand-orange-soft",
  },
  {
    key: "active",
    label: "Active issues",
    caption: "Still being handled",
    tone: "bg-overview-tile-active",
  },
  {
    key: "resolved",
    label: "Resolved",
    caption: "Marked as closed",
    tone: "bg-emerald-50",
  },
] as const

export type StatTileKey = (typeof defaultTiles)[number]["key"]

export type StatTileCopy = Partial<
  Record<StatTileKey, { label: string; caption: string }>
>

export function StatTiles({
  total,
  active,
  resolved,
  onOpenReports,
  copy,
}: {
  total: number
  active: number
  resolved: number
  onOpenReports?: () => void
  copy?: StatTileCopy
}) {
  const navigate = useNavigate()
  const values = { total, active, resolved } as const
  const openReports = onOpenReports ?? (() => navigate("/dashboard/reports"))
  return (
    <div className="flex gap-2.5">
      {defaultTiles.map((tile) => {
        const tileCopy = copy?.[tile.key]
        return (
          <div
            key={tile.key}
            className={cn(
              "relative min-h-[104px] min-w-0 flex-1 rounded-2xl p-3 pb-12",
              tile.tone,
            )}
          >
            <p className="text-[12.5px] font-bold text-neutral-900">
              {tileCopy?.label ?? tile.label}
            </p>
            <p className="text-[10.5px] text-neutral-500">
              {tileCopy?.caption ?? tile.caption}
            </p>
            <div className="absolute right-3 bottom-3 left-3 flex items-end justify-between gap-2">
              <p className="text-[23px] font-bold leading-none tracking-tight text-neutral-900 tabular-nums">
                {formatCount(values[tile.key])}
              </p>
              <button
                type="button"
                onClick={openReports}
                aria-label={`Open ${tileCopy?.label ?? tile.label}`}
                className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-transform active:scale-95"
              >
                <ArrowUpRight className="size-3.5" strokeWidth={2.6} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
