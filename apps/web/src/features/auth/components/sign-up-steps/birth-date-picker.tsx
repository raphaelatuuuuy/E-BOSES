"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import dayjs from "dayjs"

import { cn } from "@workspace/ui/lib/utils"

import { getLatestAllowedBirthDate } from "@/features/auth/schemas/sign-up-schema"

const MIN_YEAR = 1900

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

interface BirthDatePickerProps {
  value: string
  onChange: (isoDate: string) => void
  invalid?: boolean
  className?: string
}

interface DateParts {
  year: string
  month: string
  day: string
}

const EMPTY_PARTS: DateParts = { year: "", month: "", day: "" }

function partsFromIso(iso: string): DateParts {
  if (!iso) return EMPTY_PARTS
  const parsed = dayjs(iso)
  if (!parsed.isValid()) return EMPTY_PARTS
  return {
    year: String(parsed.year()),
    month: String(parsed.month() + 1),
    day: String(parsed.date()),
  }
}

function daysInMonth(year: number, month: number) {
  return dayjs(`${year}-${String(month).padStart(2, "0")}-01`).daysInMonth()
}

function range(from: number, to: number) {
  const values: number[] = []
  for (let value = from; value <= to; value += 1) values.push(value)
  return values
}

function SelectField({
  label,
  value,
  onChange,
  invalid,
  options,
  className,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  invalid?: boolean
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        aria-label={label}
        aria-invalid={Boolean(invalid)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "peer box-border h-[60px] w-full appearance-none truncate rounded-[12px] bg-white pb-2.5 pl-[0.7rem] pr-8 pt-[1.75rem] text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
          "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
          "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute left-[calc(0.7rem+2px)] top-2.5 z-[1] text-[11px] font-medium leading-[14px] text-neutral-800 peer-focus-visible:left-[calc(0.7rem+3px)] peer-aria-invalid:text-destructive"
      >
        {label}
      </span>
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
      />
    </div>
  )
}

export function BirthDatePicker({
  value,
  onChange,
  invalid,
  className,
}: BirthDatePickerProps) {
  const maxDate = React.useMemo(() => dayjs(getLatestAllowedBirthDate()), [])
  const [parts, setParts] = React.useState<DateParts>(() => partsFromIso(value))
  const [syncedValue, setSyncedValue] = React.useState(value)

  if (syncedValue !== value) {
    setSyncedValue(value)
    setParts(partsFromIso(value))
  }

  const year = Number(parts.year) || 0
  const month = Number(parts.month) || 0

  const yearOptions = React.useMemo(
    () =>
      range(MIN_YEAR, maxDate.year())
        .reverse()
        .map((item) => ({ value: String(item), label: String(item) })),
    [maxDate],
  )

  const monthOptions = React.useMemo(() => {
    const last = year === maxDate.year() ? maxDate.month() + 1 : 12
    return range(1, last).map((item) => ({
      value: String(item),
      label: MONTH_NAMES[item - 1] ?? String(item),
    }))
  }, [maxDate, year])

  const dayOptions = React.useMemo(() => {
    if (!year || !month) {
      return range(1, 31).map((item) => ({ value: String(item), label: String(item) }))
    }
    const inMonth = daysInMonth(year, month)
    const last =
      year === maxDate.year() && month === maxDate.month() + 1
        ? Math.min(inMonth, maxDate.date())
        : inMonth
    return range(1, last).map((item) => ({ value: String(item), label: String(item) }))
  }, [maxDate, month, year])

  function commit(next: DateParts) {
    const nextYear = Number(next.year) || 0
    let nextMonth = Number(next.month) || 0
    let nextDay = Number(next.day) || 0

    if (nextYear && nextMonth && nextYear === maxDate.year()) {
      nextMonth = Math.min(nextMonth, maxDate.month() + 1)
    }
    if (nextYear && nextMonth && nextDay) {
      const inMonth = daysInMonth(nextYear, nextMonth)
      const last =
        nextYear === maxDate.year() && nextMonth === maxDate.month() + 1
          ? Math.min(inMonth, maxDate.date())
          : inMonth
      nextDay = Math.min(nextDay, last)
    }

    const clamped: DateParts = {
      year: next.year,
      month: nextMonth ? String(nextMonth) : "",
      day: nextDay ? String(nextDay) : "",
    }
    setParts(clamped)

    if (!clamped.year || !clamped.month || !clamped.day) {
      if (value) {
        setSyncedValue("")
        onChange("")
      }
      return
    }

    const picked = dayjs(
      `${clamped.year}-${clamped.month.padStart(2, "0")}-${clamped.day.padStart(2, "0")}`,
    )
    if (!picked.isValid()) return
    const iso = picked.format("YYYY-MM-DD")
    setSyncedValue(iso)
    onChange(iso)
  }

  return (
    <div className={cn("w-full", className)}>
      <p
        className={cn(
          "mb-2 text-[13px] font-medium leading-4",
          invalid ? "text-destructive" : "text-neutral-600",
        )}
      >
        Date of birth
      </p>
      <div className="grid grid-cols-[1.4fr_0.8fr_1fr] gap-2">
        <SelectField
          label="Month"
          value={parts.month}
          invalid={invalid}
          options={monthOptions}
          onChange={(next) => commit({ ...parts, month: next })}
        />
        <SelectField
          label="Day"
          value={parts.day}
          invalid={invalid}
          options={dayOptions}
          onChange={(next) => commit({ ...parts, day: next })}
        />
        <SelectField
          label="Year"
          value={parts.year}
          invalid={invalid}
          options={yearOptions}
          onChange={(next) => commit({ ...parts, year: next })}
        />
      </div>
    </div>
  )
}
