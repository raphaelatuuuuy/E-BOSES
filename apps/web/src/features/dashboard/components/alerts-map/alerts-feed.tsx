import { memo, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"
import {
  MapWeatherCard,
  type MapWeatherState,
} from "@/features/dashboard/components/map-weather"
import type { MapFilterChip } from "@/features/dashboard/components/map/filter-chips"
import { AlertCard, type AlertCardModel } from "./alert-card"
import type { Selection } from "./lib"

export const ALERT_FEED_CHIPS: MapFilterChip[] = [
  { key: "all", label: "All" },
  { key: "concerns", label: "Concerns" },
  { key: "announcements", label: "Announcements" },
]

export type AlertFeedRow = {
  key: string
  selection?: Selection
  model: AlertCardModel
  icon: ReactNode
  onAction?: () => void
}

export const AlertsFeed = memo(function AlertsFeed({
  areaName,
  total,
  rows,
  onSelect,
  weatherMode = false,
  weatherToggle,
  weather,
}: {
  areaName: string
  total: number
  rows: AlertFeedRow[]
  onSelect: (selection: Selection) => void
  weatherMode?: boolean
  weatherToggle?: ReactNode
  weather?: MapWeatherState
}) {
  const asOf = new Date().toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <>
      <div className="shrink-0 bg-white px-4 pt-3 pb-2 sm:pt-4">
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <h1 className="text-[18px] leading-tight font-bold tracking-tight text-neutral-900 sm:text-[20px]">
              {weatherMode ? "Weather in" : "Alerts in"}{" "}
              <span
                className="text-brand-orange"
                style={{ color: "var(--color-brand-orange)" }}
              >
                {areaName}
              </span>
            </h1>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              {weatherMode ? `As of ${asOf}` : `${total} on the map`}
            </p>
          </div>
          {!weatherMode && weatherToggle}
        </div>
      </div>

      <div
        className={cn(
          "scrollbar-hide relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4",
          weatherMode ? "px-4" : "px-3"
        )}
      >
        {weatherMode && weather ? (
          <MapWeatherCard weather={weather} framed={false} />
        ) : rows.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-[14px] font-semibold text-neutral-800 sm:text-[15px]">
              Nothing active right now
            </p>
            <p className="mt-1 text-[12px] text-neutral-500 sm:text-[13px]">
              New concerns and emergencies appear here the moment they are
              filed.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.key}>
                <AlertCard
                  model={row.model}
                  icon={row.icon}
                  expanded={false}
                  onOpen={() =>
                    row.selection ? onSelect(row.selection) : row.onAction?.()
                  }
                  onAction={row.onAction}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
})
