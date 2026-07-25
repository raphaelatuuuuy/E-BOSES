"use client"

import * as React from "react"
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs"
import { DateCalendar } from "@mui/x-date-pickers/DateCalendar"
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import { type Dayjs } from "dayjs"

import dayjs from "dayjs"

import { getLatestAllowedBirthDate } from "@/features/auth/schemas/sign-up-schema"

const BRAND = "#ff8133"
const BRAND_HOVER = "#e6732e"
const HOVER_SURFACE = "#f5f5f5"
export const CAL_WIDTH = 320

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

interface DateCalendarViewProps {
  draft: Dayjs | null
  view: "year" | "month" | "day"
  isMobile: boolean
  onViewChange: (view: "year" | "month" | "day") => void
  onChange: (date: Dayjs | null) => void
  onClear: () => void
  onOk: () => void
}

export function DateCalendarView({
  draft,
  view,
  isMobile,
  onViewChange,
  onChange,
  onClear,
  onOk,
}: DateCalendarViewProps) {
  const maxDate = React.useMemo(() => dayjs(getLatestAllowedBirthDate()), [])
  const minDate = React.useMemo(() => dayjs("1900-01-01"), [])

  return (
    <ThemeProvider theme={calendarTheme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <div className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-white px-2 pt-1">
            <DateCalendar
              value={draft}
              views={["year", "month", "day"]}
              view={view}
              onViewChange={(next) => onViewChange(next)}
              openTo="year"
              yearsOrder="desc"
              minDate={minDate}
              maxDate={maxDate}
              reduceAnimations
              onChange={(next) => onChange(next)}
              sx={{
                width: CAL_WIDTH,
                maxWidth: "100%",
                backgroundColor: "#ffffff",
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
                  "&:focus, &:focus-visible, &.Mui-focusVisible": {
                    backgroundColor: "transparent",
                    outline: "none",
                    boxShadow: "none",
                  },
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
              onClick={onClear}
              className="rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-[#ff8133]"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onOk}
              className="rounded-full px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-[#ff8133]"
            >
              OK
            </button>
          </div>
        </div>
      </LocalizationProvider>
    </ThemeProvider>
  )
}
