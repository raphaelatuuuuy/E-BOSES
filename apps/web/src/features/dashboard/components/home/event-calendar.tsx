import { useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { BarangayEvent } from "@/features/dashboard/api"

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]

function dayKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`
}

function buildGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

export function EventCalendar({ events }: { events: BarangayEvent[] }) {
  const today = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<string>(() => dayKey(today))

  const byDay = useMemo(() => {
    const map = new Map<string, BarangayEvent[]>()
    for (const event of events) {
      const when = new Date(event.starts_at)
      if (!Number.isFinite(when.getTime())) continue
      const key = dayKey(when)
      map.set(key, [...(map.get(key) ?? []), event])
    }
    return map
  }, [events])

  const grid = useMemo(() => buildGrid(month), [month])
  const selectedEvents = byDay.get(selected) ?? []

  const selectedLabel = useMemo(() => {
    const match = grid.find((day) => dayKey(day) === selected)
    return (match ?? today).toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
  }, [grid, selected, today])

  const upcoming = useMemo(() => {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    return events
      .filter((event) => {
        const when = new Date(event.starts_at)
        return when >= startOfToday && dayKey(when) !== selected
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
      .slice(0, 3)
  }, [events, selected, today])

  function shift(delta: number) {
    setMonth((value) => new Date(value.getFullYear(), value.getMonth() + delta, 1))
  }

  return (
    <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-brand-navy">
          {month.toLocaleDateString([], { month: "long", year: "numeric" })}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => shift(-1)}
            aria-label="Previous month"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
          >
            <ChevronLeftIcon className="size-4" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            aria-label="Next month"
            className="flex size-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
          >
            <ChevronRightIcon className="size-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((label, index) => (
          <span key={index} className="text-[11px] font-semibold text-neutral-400">
            {label}
          </span>
        ))}
        {grid.map((day) => {
          const key = dayKey(day)
          const inMonth = day.getMonth() === month.getMonth()
          const hasEvents = byDay.has(key)
          const isToday = key === dayKey(today)

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelected(key)}
              aria-label={day.toDateString()}
              aria-pressed={key === selected}
              className={cn(
                "relative mx-auto flex size-8 items-center justify-center rounded-full text-[12px] transition-colors",
                inMonth ? "text-neutral-800" : "text-neutral-300",
                key === selected && "bg-brand-navy font-bold text-white",
                key !== selected && isToday && "font-bold text-brand-orange",
                key !== selected && "hover:bg-neutral-100",
              )}
            >
              {day.getDate()}
              {hasEvents ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1 size-1 rounded-full",
                    key === selected ? "bg-white" : "bg-brand-orange",
                  )}
                />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="mt-3 border-t border-neutral-200 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[12px] font-bold text-neutral-500">
            {selected === dayKey(today) ? "Today" : selectedLabel}
          </p>
          {selectedEvents.length ? (
            <span className="text-[11px] font-semibold tabular-nums text-neutral-400">
              {selectedEvents.length} {selectedEvents.length === 1 ? "event" : "events"}
            </span>
          ) : null}
        </div>

        {selectedEvents.length ? (
          <ul className="mt-2 space-y-2">
            {selectedEvents.map((event) => {
              const start = new Date(event.starts_at)
              return (
                <li
                  key={event.id}
                  className="flex gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5"
                >
                  <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-md bg-white py-1 ring-1 ring-neutral-200">
                    <span className="text-[13px] font-bold leading-none tabular-nums text-brand-navy">
                      {start.toLocaleTimeString([], { hour: "numeric" }).replace(/\s?[AP]M/i, "")}
                    </span>
                    <span className="mt-0.5 text-[10px] font-semibold text-neutral-500">
                      {start.getHours() >= 12 ? "PM" : "AM"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold leading-snug text-neutral-900">
                      {event.title}
                    </p>
                    {event.detail ? (
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-neutral-600">
                        {event.detail}
                      </p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-[12px] text-neutral-500">
            Nothing scheduled for this day.
          </p>
        )}

        {upcoming.length ? (
          <div className="mt-3 border-t border-neutral-200 pt-2.5">
            <p className="text-[12px] font-bold text-neutral-500">
              Coming up
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {upcoming.map((event) => (
                <li key={event.id} className="flex items-baseline gap-2">
                  <span className="w-14 shrink-0 text-[11px] font-semibold tabular-nums text-neutral-500">
                    {new Date(event.starts_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-700">
                    {event.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
