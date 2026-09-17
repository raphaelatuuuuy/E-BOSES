"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
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
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const selectedLabel = options.find((o) => o.value === value)?.label ?? ""

  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-invalid={Boolean(invalid)}
        className={cn(
          "flex w-full items-center gap-2 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-3 py-3 text-left text-sm text-neutral-900 outline-none transition-colors",
          "hover:border-neutral-400 focus:border-neutral-500",
          "aria-invalid:border-destructive aria-invalid:focus:border-destructive",
          open && "border-neutral-400",
        )}
      >
        <span className={cn("flex-1 truncate font-medium", !selectedLabel && "text-neutral-400")}>
          {selectedLabel || label}
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '180px', overflowY: 'auto' }}>
          <div className="py-1">
            {options.map((option) => {
              const isSelected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { onChange(option.value); setOpen(false) }}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50",
                    isSelected ? "font-medium text-neutral-900" : "text-neutral-700",
                  )}
                >
                  <span className="flex-1 min-w-0">{option.label}</span>
                  {isSelected && <CheckIcon className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
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
      <div className="grid grid-cols-[1fr_0.6fr_0.9fr] gap-2">
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
