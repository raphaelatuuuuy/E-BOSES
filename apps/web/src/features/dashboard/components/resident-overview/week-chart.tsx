import { useEffect, useRef, useState } from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type {
  ResidentReportOverview,
  ResidentReportPeriod,
} from "@/features/dashboard/api"
import {
  barHeights,
  formatCount,
  weekdayLabel,
} from "@/features/dashboard/lib/overview-chart"

const periodOptions: { value: ResidentReportPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
]

function periodLabel(period: ResidentReportPeriod) {
  return (
    periodOptions.find((option) => option.value === period)?.label ??
    "This week"
  )
}

function dateForLabel(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function shortDateLabel(isoDate: string) {
  const date = dateForLabel(isoDate)
  return date
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(date)
    : isoDate
}

function monthRangeLabel(startDate: string, endDate: string) {
  const start = dateForLabel(startDate)
  const end = dateForLabel(endDate)
  if (!start || !end)
    return `${shortDateLabel(startDate)}–${shortDateLabel(endDate)}`
  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  const endLabel = sameMonth ? String(end.getDate()) : shortDateLabel(endDate)
  return `${shortDateLabel(startDate)}–${endLabel}`
}

function dayLabel(isoDate: string, period: ResidentReportPeriod) {
  if (period === "today") return "Today"
  if (period === "month") {
    const date = dateForLabel(isoDate)
    return date
      ? new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
        }).format(date)
      : ""
  }
  return weekdayLabel(isoDate)
}

function dayAriaLabel(
  isoDate: string,
  submitted: number,
  resolved: number,
  critical: number,
  verb: string,
) {
  const date = dateForLabel(isoDate)
  const dateLabel = date
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(date)
    : isoDate
  const filed = `${submitted} ${submitted === 1 ? "report" : "reports"} ${verb}`
  const resolvedText = resolved > 0 ? `, ${resolved} resolved` : ""
  const criticalText = critical > 0 ? `, ${critical} critical` : ""
  return `${dateLabel}: ${filed}${resolvedText}${criticalText}`
}

function activityFeedback(count: number) {
  if (count <= 0) return "Quiet for now"
  if (count === 1) return "Good start"
  if (count <= 3) return "Looking good"
  return "Staying involved"
}

function chartStackFor(day: ResidentReportOverview["days"][number]) {
  // Critical reports are part of the filed count, so split them out of the
  // orange segment instead of counting them twice in the same daily bar.
  const filed = Math.max(0, day.submitted - day.critical)
  const resolved = Math.max(0, day.resolved)
  const critical = Math.max(0, day.critical)
  return {
    filed,
    resolved,
    critical,
    total: filed + resolved + critical,
  }
}

type ChartDay = ResidentReportOverview["days"][number] & {
  label: string
  ariaLabel: string
}

function chartDaysFor(
  days: ResidentReportOverview["days"],
  period: ResidentReportPeriod,
  verb: string,
): ChartDay[] {
  if (period !== "month") {
    return days.map((day) => ({
      ...day,
      label: dayLabel(day.date, period),
       ariaLabel: dayAriaLabel(
         day.date,
         day.submitted,
         day.resolved,
         day.critical,
         verb,
       ),
    }))
  }

  // A month can contain 31 daily bars, which makes the labels unreadable on a
  // phone. Keep the total monthly count, but group the visual into calendar
  // weeks so the trend remains scannable.
  const groups: ChartDay[] = []
  for (let index = 0; index < days.length; index += 7) {
    const slice = days.slice(index, index + 7)
    const first = slice[0]
    const last = slice[slice.length - 1]
    if (!first || !last) continue
    const label = monthRangeLabel(first.date, last.date)
    groups.push({
      date: first.date,
      label,
       ariaLabel: `${label}: ${slice.reduce((sum, day) => sum + day.submitted, 0)} reports ${verb}${slice.reduce((sum, day) => sum + day.resolved, 0) > 0 ? `, ${slice.reduce((sum, day) => sum + day.resolved, 0)} resolved` : ""}${slice.some((day) => day.critical > 0) ? ", including a critical report" : ""}`,
      submitted: slice.reduce((sum, day) => sum + day.submitted, 0),
      resolved: slice.reduce((sum, day) => sum + day.resolved, 0),
      critical: slice.reduce((sum, day) => sum + day.critical, 0),
    })
  }
  return groups
}

function ReportPeriodDropdown({
  period,
  onChange,
}: {
  period: ResidentReportPeriod
  onChange: (period: ResidentReportPeriod) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = periodOptions.find((option) => option.value === period)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Report activity period"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 min-w-[104px] items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-left text-[13px] font-semibold text-neutral-700 shadow-[0_2px_8px_rgba(255,106,26,0.08)] transition-colors outline-none hover:border-neutral-300 hover:bg-neutral-50 focus-visible:border-brand-orange focus-visible:ring-2 focus-visible:ring-brand-orange/25"
      >
        <span>{selected?.label ?? "This week"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 text-neutral-500 transition-transform",
            open && "rotate-180"
          )}
          strokeWidth={1.9}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Report activity period"
          className="absolute top-full right-0 z-40 mt-2 min-w-[166px] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
        >
          {periodOptions.map((option) => {
            const active = option.value === period
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none",
                  active ? "font-semibold text-neutral-900" : "text-neutral-700"
                )}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {active ? (
                  <CheckIcon
                    className="size-4 shrink-0 text-brand-orange"
                    strokeWidth={2.3}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function UnitDropdown({
  options,
  selectedId,
  onChange,
}: {
  options: { id: number | null; label: string }[]
  selectedId: number | null | undefined
  onChange: (unitId: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.id === selectedId)

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [])

  if (options.length === 0) return null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Report activity unit"
        onClick={() => setOpen((current) => !current)}
        className="flex h-9 min-w-[104px] max-w-[150px] items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-left text-[13px] font-semibold text-neutral-700 shadow-[0_2px_8px_rgba(255,106,26,0.08)] transition-colors outline-none hover:border-neutral-300 hover:bg-neutral-50 focus-visible:border-brand-orange focus-visible:ring-2 focus-visible:ring-brand-orange/25"
      >
        <span className="truncate">{selected?.label ?? "Unit"}</span>
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 text-neutral-500 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={1.9}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Report activity unit"
          className="absolute top-full right-0 z-40 mt-2 min-w-[166px] overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-[0_18px_45px_rgba(15,23,42,0.14)]"
        >
          {options.map((option) => {
            const active = option.id === selectedId
            return (
              <button
                key={option.id ?? "all"}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none",
                  active ? "font-semibold text-neutral-900" : "text-neutral-700",
                )}
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {active ? (
                  <CheckIcon
                    className="size-4 shrink-0 text-brand-orange"
                    strokeWidth={2.3}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function EmptyChart({ loading }: { loading: boolean }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-xl bg-neutral-50 text-[13px] text-neutral-500">
      {loading
        ? "Loading your report activity…"
        : "No report activity in this period"}
    </div>
  )
}

export function WeekChart({
  overview,
  period,
  loading = false,
  error = null,
  onPeriodChange,
  subtitle = "reports you filed",
  activityLabel = "Your activity",
  activityVerb = "filed",
  unitOptions,
  selectedUnitId,
  onUnitChange,
}: {
  overview: ResidentReportOverview | null
  period: ResidentReportPeriod
  loading?: boolean
  error?: string | null
  onPeriodChange: (period: ResidentReportPeriod) => void
  subtitle?: string
  activityLabel?: string
  activityVerb?: string
  unitOptions?: { id: number | null; label: string }[]
  selectedUnitId?: number | null
  onUnitChange?: (unitId: number | null) => void
}) {
  const activeOverview = overview?.period === period ? overview : null
  const days = activeOverview?.days ?? []
  const chartDays = chartDaysFor(days, period, activityVerb)
  const chartStacks = chartDays.map(chartStackFor)
  const heights = barHeights(chartStacks.map((stack) => stack.total))
  const compact = chartDays.length > 14
  const hasCritical = chartDays.some((day) => day.critical > 0)

  return (
    <section
      className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-neutral-100"
      aria-busy={loading}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[19px] font-bold tracking-tight text-neutral-900">
            Reports overview
          </h2>
          <p className="mt-1 text-[12.5px] text-neutral-500">
            {activeOverview?.label ?? periodLabel(period)} · {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ReportPeriodDropdown period={period} onChange={onPeriodChange} />
          {unitOptions && onUnitChange ? (
            <UnitDropdown
              options={unitOptions}
              selectedId={selectedUnitId}
              onChange={onUnitChange}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-brand-orange-soft px-3.5 py-3 ring-1 ring-brand-orange/10">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold tracking-[0.1em] text-brand-orange-strong uppercase">
            {activityLabel}
          </p>
          <p className="text-[12px] font-semibold text-brand-orange-strong">
            {activeOverview
              ? activityFeedback(activeOverview.total)
              : "Updating…"}
          </p>
        </div>
        <p className="mt-2 text-center text-[40px] leading-none font-bold tracking-[-0.04em] text-neutral-900 tabular-nums">
          {formatCount(activeOverview?.total ?? 0)}
        </p>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg bg-severity-critical-surface px-3 py-2 text-[12px] font-medium text-severity-critical-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-neutral-500">
          {period === "month" ? "Weekly activity" : "Daily activity"}
        </p>
        <div className="flex items-center gap-3 text-[11px] font-medium text-neutral-500">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-[3px] bg-overview-bar"
              aria-hidden="true"
            />
            Filed
          </span>
          <span className="inline-flex items-center gap-1.5 text-status-closed">
            <span
              className="size-2 rounded-full bg-status-closed"
              aria-hidden="true"
            />
            Resolved
          </span>
          {hasCritical ? (
            <span className="inline-flex items-center gap-1.5 text-severity-critical-ink">
              <span
                className="size-2 rounded-[3px] bg-severity-critical"
                aria-hidden="true"
              />
              Critical
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="mt-2"
        role="img"
        aria-label={`${formatCount(activeOverview?.total ?? 0)} reports ${activityVerb} ${activeOverview?.label.toLowerCase() ?? periodLabel(period).toLowerCase()}`}
      >
        {chartDays.length === 0 ? (
          <EmptyChart loading={loading} />
        ) : (
          <>
            <div className="overflow-x-auto pb-1">
              <div
                className={cn(
                  "relative flex h-40 items-end gap-2 px-1",
                  compact ? "min-w-[720px] gap-1.5" : "min-w-0"
                )}
              >
                <div
                  className="pointer-events-none absolute inset-x-1 bottom-0 h-px bg-neutral-200"
                  aria-hidden="true"
                />
                {chartDays.map((day, index) => {
                  const stack = chartStacks[index]
                  const stackHeight = heights[index] ?? 0
                  const barWidth = chartDays.length === 1 ? "mx-auto max-w-[72px]" : ""
                  const segmentHeight = (value: number) =>
                    stack && stack.total > 0
                      ? `${(value / stack.total) * 100}%`
                      : "0%"
                  return (
                    <div
                      key={day.date}
                      className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                      aria-label={day.ariaLabel}
                    >
                      <div
                        className={cn(
                          "flex w-full min-w-0 flex-col overflow-hidden rounded-t-[6px] transition-[height] duration-300",
                          barWidth,
                        )}
                        style={{ height: `${stackHeight}%` }}
                        title={
                          stack
                            ? `${day.label}: ${stack.total} report${stack.total === 1 ? "" : "s"}\nFiled: ${day.submitted}\nResolved: ${day.resolved}\nCritical: ${day.critical}`
                            : undefined
                        }
                      >
                        {stack?.filed ? (
                          <div
                            className="min-h-0 w-full bg-overview-bar"
                            style={{ height: segmentHeight(stack.filed) }}
                          />
                        ) : null}
                        {stack?.resolved ? (
                          <div
                            className="min-h-0 w-full bg-status-closed"
                            style={{ height: segmentHeight(stack.resolved) }}
                          />
                        ) : null}
                        {stack?.critical ? (
                          <div
                            className="min-h-0 w-full bg-severity-critical"
                            style={{ height: segmentHeight(stack.critical) }}
                          />
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div
                className={cn(
                  "mt-2 flex min-w-0 gap-2 px-1",
                  compact ? "min-w-[720px] gap-1.5" : "min-w-0"
                )}
              >
                {chartDays.map((day) => (
                  <span
                    key={day.date}
                    className={cn(
                      "min-w-0 flex-1 text-center font-medium text-neutral-500",
                      compact ? "text-[10px]" : "text-[12px]"
                    )}
                  >
                    {day.label}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
