"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs"
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import dayjs, { type Dayjs } from "dayjs"

import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { getLatestAllowedBirthDate } from "@/features/auth/schemas/sign-up-schema"

const BRAND = "#ff8133"
/** Match primary Continue / OK button hover (clean orange, not muddy brown). */
const BRAND_HOVER = "#e6732e"
/** Match wizard button hover: hover:bg-neutral-100 */
const HOVER_SURFACE = "#f5f5f5"
/** MUI DateCalendar default content width — keep fixed so day columns stay even. */
const CAL_WIDTH = 320

const calendarTheme = createTheme({
  palette: {
    primary: {
      main: BRAND,
      light: BRAND,
      dark: BRAND_HOVER,
      contrastText: "#ffffff",
    },
    background: { default: "#ffffff", paper: "#ffffff" },
  },
  typography: { fontFamily: "inherit" },
})

interface BirthDatePickerProps {
  value: string
  onChange: (isoDate: string) => void
  invalid?: boolean
  className?: string
}

function formatDisplay(iso: string) {
  if (!iso) return ""
  const d = dayjs(iso)
  if (!d.isValid()) return ""
  return d.format("MM/DD/YYYY")
}

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [breakpoint])
  return isMobile
}

/**
 * DOB field uses FloatingLabelInput + portaled MUI DateCalendar.
 * Mobile: bottom sheet with a fixed-width, properly gridded calendar.
 * Desktop: anchored under the field.
 */
export function BirthDatePicker({
  value,
  onChange,
  invalid,
  className,
}: BirthDatePickerProps) {
  const maxDate = React.useMemo(() => dayjs(getLatestAllowedBirthDate()), [])
  const minDate = React.useMemo(() => dayjs("1900-01-01"), [])
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Dayjs | null>(null)
  const [view, setView] = React.useState<"year" | "month" | "day">("year")
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [coords, setCoords] = React.useState<{
    top: number
    left: number
    maxHeight: number
  } | null>(null)
  const [mounted, setMounted] = React.useState(false)

  const parsed: Dayjs | null = React.useMemo(() => {
    if (!value) return null
    const d = dayjs(value)
    return d.isValid() ? d : null
  }, [value])

  React.useEffect(() => {
    setMounted(true)
  }, [])

  React.useEffect(() => {
    if (open) {
      setDraft(parsed ?? maxDate)
      setView("year")
    }
  }, [open, parsed, maxDate])

  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const updatePosition = React.useCallback(() => {
    if (isMobile) {
      setCoords({ top: 0, left: 0, maxHeight: window.innerHeight })
      return
    }
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const gap = 8
    const panelWidth = Math.min(CAL_WIDTH + 16, window.innerWidth - 24)
    let left = rect.left
    left = Math.max(12, Math.min(left, window.innerWidth - panelWidth - 12))

    const panelH = panelRef.current?.offsetHeight || 420
    const spaceBelow = window.innerHeight - rect.bottom - gap - 12
    let top = rect.bottom + gap
    if (panelH > spaceBelow) {
      top = Math.max(12, window.innerHeight - panelH - 12)
    }
    const maxHeight = Math.min(panelH, window.innerHeight - 24)
    setCoords({ top, left, maxHeight })
  }, [isMobile])

  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    const t = window.setTimeout(updatePosition, 40)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, updatePosition, view])

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown)
      document.addEventListener("keydown", onKey)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function applyDraft() {
    if (draft?.isValid()) {
      onChange(draft.format("YYYY-MM-DD"))
    }
    setOpen(false)
  }

  function clearDraft() {
    setDraft(null)
    onChange("")
    setOpen(false)
  }

  const displayValue = formatDisplay(value)

  const calendar = (
    <ThemeProvider theme={calendarTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          {/* Fixed width + centered so MUI’s 7-column day grid stays even */}
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-white px-2 pt-1">
            <DateCalendar
              value={draft}
              views={["year", "month", "day"]}
              view={view}
              onViewChange={(next) => setView(next)}
              openTo="year"
              yearsOrder="desc"
              minDate={minDate}
              maxDate={maxDate}
              reduceAnimations
              onChange={(next) => {
                setDraft(next)
                if (view === "year") setView("month")
                else if (view === "month") setView("day")
              }}
              sx={{
                width: CAL_WIDTH,
                maxWidth: "100%",
                backgroundColor: "#ffffff",
                // Soft button-like hover; selected day always solid brand orange.
                "& .MuiTouchRipple-root": {
                  display: "none",
                },
                "& .MuiPickersDay-root": {
                  width: 36,
                  height: 36,
                  margin: "0 auto",
                  fontSize: "0.875rem",
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  border: "none",
                  outline: "none",
                  boxShadow: "none",
                  backgroundColor: "transparent",
                  transition: "background-color 150ms ease-out, color 150ms ease-out",
                  // Focus alone must NOT look hovered (MUI leaves focus on click).
                  "&:focus, &:focus-visible, &.Mui-focusVisible": {
                    backgroundColor: "transparent",
                    outline: "none",
                    boxShadow: "none",
                  },
                  // Gray wash only while the pointer is actually over the day.
                  "&:not(.Mui-selected):hover": {
                    backgroundColor: HOVER_SURFACE,
                  },
                  "&.MuiPickersDay-today:not(.Mui-selected)": {
                    border: "none",
                    backgroundColor: "transparent",
                  },
                  "&.MuiPickersDay-today:not(.Mui-selected):hover": {
                    backgroundColor: HOVER_SURFACE,
                  },
                  // Selected — solid brand orange; only darken on real hover.
                  "&.Mui-selected": {
                    backgroundColor: `${BRAND} !important`,
                    color: "#ffffff !important",
                    fontWeight: 600,
                  },
                  "&.Mui-selected:focus, &.Mui-selected:focus-visible, &.Mui-selected.Mui-focusVisible":
                    {
                      backgroundColor: `${BRAND} !important`,
                      color: "#ffffff !important",
                    },
                  "&.Mui-selected:hover": {
                    backgroundColor: `${BRAND_HOVER} !important`,
                    color: "#ffffff !important",
                  },
                  "&.Mui-selected.MuiPickersDay-today": {
                    backgroundColor: `${BRAND} !important`,
                    color: "#ffffff !important",
                  },
                  "&.Mui-disabled": {
                    backgroundColor: "transparent !important",
                  },
                },
                "& .MuiPickersYear-yearButton, & .MuiPickersMonth-monthButton": {
                  backgroundColor: "transparent",
                  transition: "background-color 150ms ease-out, color 150ms ease-out",
                  boxShadow: "none",
                  // Don't paint focus as hover.
                  "&:focus, &:focus-visible, &.Mui-focusVisible": {
                    backgroundColor: "transparent",
                    outline: "none",
                    boxShadow: "none",
                  },
                  "&:not(.Mui-selected):hover": {
                    backgroundColor: HOVER_SURFACE,
                  },
                  "&.Mui-selected": {
                    backgroundColor: `${BRAND} !important`,
                    color: "#ffffff !important",
                  },
                  "&.Mui-selected:focus, &.Mui-selected:focus-visible, &.Mui-selected.Mui-focusVisible":
                    {
                      backgroundColor: `${BRAND} !important`,
                      color: "#ffffff !important",
                    },
                  "&.Mui-selected:hover": {
                    backgroundColor: `${BRAND_HOVER} !important`,
                    color: "#ffffff !important",
                  },
                },
                "& .MuiIconButton-root": {
                  transition: "background-color 150ms ease-out",
                  "&:focus, &:focus-visible, &.Mui-focusVisible": {
                    backgroundColor: "transparent",
                  },
                  "&:hover": {
                    backgroundColor: HOVER_SURFACE,
                  },
                },
                "& .MuiPickersCalendarHeader-root": {
                  backgroundColor: "#ffffff",
                  paddingLeft: 0,
                  paddingRight: 0,
                  marginTop: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                },
                "& .MuiPickersCalendarHeader-labelContainer": {
                  margin: "0 auto",
                  order: 0,
                },
                "& .MuiPickersCalendarHeader-label": {
                  margin: 0,
                },
                "& .MuiDayCalendar-root": {
                  width: "100%",
                },
                "& .MuiDayCalendar-header": {
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: 0,
                  margin: 0,
                },
                "& .MuiDayCalendar-weekDayLabel": {
                  width: `${100 / 7}%`,
                  margin: 0,
                  height: 36,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                },
                "& .MuiDayCalendar-weekContainer": {
                  display: "flex",
                  justifyContent: "space-between",
                  width: "100%",
                  margin: 0,
                  marginTop: "2px",
                },
                "& .MuiDayCalendar-weekContainer > *": {
                  width: `${100 / 7}%`,
                  display: "flex",
                  justifyContent: "center",
                  margin: 0,
                },
                "& .MuiYearCalendar-root": {
                  width: "100%",
                  maxHeight: isMobile ? "min(40vh, 260px)" : 240,
                  overflowY: "auto",
                  scrollbarWidth: "none",
                  msOverflowStyle: "none",
                  "&::-webkit-scrollbar": { display: "none" },
                },
                "& .MuiMonthCalendar-root": {
                  width: "100%",
                },
                "& .MuiPickersSlideTransition-root": {
                  minHeight: isMobile ? 220 : 240,
                },
              }}
            />
          </div>
          <div className="flex shrink-0 items-center justify-end gap-1 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
            <button
              type="button"
              onClick={clearDraft}
              className="rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-[#ff8133]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={applyDraft}
              className="rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-[#ff8133]"
            >
              OK
            </button>
          </div>
        </div>
      </LocalizationProvider>
    </ThemeProvider>
  )

  const panel =
    open && mounted
      ? createPortal(
          isMobile ? (
            <>
              <div
                className="fixed inset-0 z-[1390] bg-black/40"
                aria-hidden
                onClick={() => setOpen(false)}
              />
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Choose date of birth"
                className="fixed inset-x-0 bottom-0 z-[1400] flex max-h-[min(88vh,560px)] flex-col overflow-hidden rounded-t-3xl border-0 bg-white shadow-[0_-8px_32px_rgba(15,23,42,0.18)]"
              >
                <div className="flex shrink-0 justify-center bg-white pb-1 pt-3">
                  <span className="h-1 w-10 rounded-full bg-neutral-200" aria-hidden />
                </div>
                {calendar}
              </div>
            </>
          ) : coords ? (
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Choose date of birth"
              className="fixed z-[1400] flex w-[min(336px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border-0 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.16)]"
              style={{
                top: coords.top,
                left: coords.left,
                maxHeight: coords.maxHeight,
              }}
            >
              {calendar}
            </div>
          ) : null,
          document.body,
        )
      : null

  return (
    <div className={cn("w-full", className)}>
      <div ref={triggerRef} className="relative">
        <FloatingLabelInput
          id="dateOfBirth"
          type="text"
          readOnly
          label="Date of birth"
          value={displayValue}
          aria-invalid={Boolean(invalid)}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          className="cursor-pointer"
        />
      </div>
      {panel}
    </div>
  )
}
