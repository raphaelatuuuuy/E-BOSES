"use client"

import { type ReactNode } from "react"
import {
  CloudRainIcon,
  CloudSunIcon,
  DropletsIcon,
  LoaderCircleIcon,
  SunIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { isRainCode, useWeather, weatherLabel, type WeatherState } from "@/lib/weather"

export { weatherLabel }
export type MapWeatherState = WeatherState

export function MapWeatherIcon({
  code,
  className = "size-5",
}: {
  code: number | null
  className?: string
}) {
  if (code === 0) return <SunIcon className={className} />
  if (isRainCode(code)) return <CloudRainIcon className={className} />
  return <CloudSunIcon className={className} />
}

/** Kept as a named re-export so the maps read as map code. */
export const useMapWeather = useWeather

export function MapWeatherButton({
  weather,
  open,
  onClick,
  className,
}: {
  weather: MapWeatherState
  open?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open weather"
      aria-expanded={open}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] font-bold text-neutral-900 shadow-md",
        className,
      )}
    >
      {weather.loading ? (
        <LoaderCircleIcon className="size-4 animate-spin text-neutral-400" />
      ) : (
        <MapWeatherIcon code={weather.code} className="size-5 text-neutral-500" />
      )}
      <span>
        {weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}
      </span>
    </button>
  )
}

export function MapControlButton({
  label,
  icon,
  onClick,
  loading = false,
  disabled = false,
  showLabel = true,
  active = false,
  variant = "light",
  className,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  showLabel?: boolean
  active?: boolean
  variant?: "light" | "dark" | "brand"
  className?: string
}) {
  const base = "inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-lg border px-2.5 text-[13px] font-bold shadow-md transition disabled:cursor-not-allowed disabled:opacity-60"
  const variants = {
    light: "border-neutral-200 bg-white text-neutral-900 hover:border-brand-blue/40 hover:bg-tint",
    dark: "border-rail-line bg-nav-glass/90 text-foreground backdrop-blur hover:border-ice/40 hover:bg-nav-raised",
    brand: "border-brand-orange bg-brand-orange-soft text-brand-orange hover:bg-brand-orange/20",
  }
  const activeCls = active && variant !== "dark" ? "border-brand-orange bg-brand-orange-soft text-brand-orange" : ""
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(base, variants[variant], activeCls, className)}
    >
      {loading ? <LoaderCircleIcon className="size-4 animate-spin text-neutral-400" /> : icon}
      {showLabel ? <span className="hidden sm:inline">{label}</span> : null}
    </button>
  )
}

export function MapWeatherCard({
  weather,
  framed = true,
}: {
  weather: MapWeatherState
  framed?: boolean
}) {
  const today = weather.daily[0]
  return (
    <div
      className={cn(
        "w-full text-neutral-900",
        framed && "rounded-xl bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,.16)]",
      )}
    >

      {weather.error ? (
        <p className="py-6 text-center text-[13px] text-neutral-500">{weather.error}</p>
      ) : weather.loading && weather.temperature == null ? (
        <div className="flex items-center justify-center py-10">
          <LoaderCircleIcon className="size-7 animate-spin text-neutral-400" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-[14px] font-semibold">{weatherLabel(weather.code)}</p>
            <MapWeatherIcon code={weather.code} className="size-5 shrink-0" />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <p className="text-[32px] font-bold leading-none tracking-tight tabular-nums">
                {weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}
              </p>
              {weather.feelsLike != null ? (
                <>
                  <p className="mt-3 text-[12px] text-neutral-500">Feels like</p>
                  <p className="text-[20px] font-semibold leading-tight tabular-nums">
                    {Math.round(weather.feelsLike)}°
                  </p>
                </>
              ) : null}
              {weather.precipitation != null ? (
                <>
                  <p className="mt-3 text-[12px] text-neutral-500">Precipitation</p>
                  <p className="text-[20px] font-semibold leading-tight tabular-nums">
                    {weather.precipitation} mm
                  </p>
                </>
              ) : null}
            </div>
            <div className="pt-1">
              {today ? (
                <>
                  <p className="text-[12px] text-neutral-500">Day</p>
                  <p className="text-[20px] font-semibold leading-tight tabular-nums">
                    {Math.round(today.high)}°
                  </p>
                  <p className="mt-3 text-[12px] text-neutral-500">Night</p>
                  <p className="text-[20px] font-semibold leading-tight tabular-nums">
                    {Math.round(today.low)}°
                  </p>
                </>
              ) : null}
              {weather.wind != null ? (
                <>
                  <p className="mt-3 text-[12px] text-neutral-500">Wind</p>
                  <p className="text-[20px] font-semibold leading-tight tabular-nums">
                    {Math.round(weather.wind)} km/h
                  </p>
                </>
              ) : null}
            </div>
          </div>

          {weather.humidity != null ? (
            <p className="mt-3 text-[12.5px] text-neutral-500">
              Humidity {Math.round(weather.humidity)}%
            </p>
          ) : null}

          {weather.daily.length > 0 ? (
            <ul className={cn("mt-3", framed && "border-t border-neutral-100 pt-2")}>
              {weather.daily.slice(0, 7).map((day) => (
                <li key={day.day} className="flex items-center gap-2 py-1.5">
                  <span className="w-9 shrink-0 truncate text-[13px] font-bold">{day.day}</span>
                  <MapWeatherIcon code={day.code} className="size-4 shrink-0 text-neutral-500" />
                  <span className="text-[13px] font-semibold tabular-nums">
                    {Math.round(day.high)}°
                  </span>
                  <span className="text-[13px] font-medium text-neutral-400 tabular-nums">
                    {Math.round(day.low)}°
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[12px] text-neutral-500 tabular-nums">
                    <DropletsIcon className="size-3.5" />
                    {day.rain}%
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}

export function MapWeatherDetails({ weather }: { weather: MapWeatherState }) {
  if (weather.error) {
    return <p className="py-6 text-center text-sm text-neutral-500">{weather.error}</p>
  }
  if (weather.loading && weather.temperature == null) {
    return (
      <div className="flex items-center justify-center py-10">
        <LoaderCircleIcon className="size-7 animate-spin text-neutral-400" />
      </div>
    )
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-2 py-4 sm:gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-neutral-500">{weatherLabel(weather.code)}</p>
          <p className="mt-1 text-2xl font-bold sm:text-3xl">
            {weather.temperature != null ? `${Math.round(weather.temperature)}°` : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">Feels like</p>
          <p className="mt-1 text-lg font-bold sm:text-xl">
            {weather.feelsLike != null ? `${Math.round(weather.feelsLike)}°` : "—"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">Wind</p>
          <p className="mt-1 text-lg font-bold sm:text-xl">
            {weather.wind != null ? `${Math.round(weather.wind)} km/h` : "—"}
          </p>
        </div>
      </div>
      {weather.humidity != null ? (
        <p className="pb-2 text-xs text-neutral-500">
          Humidity {Math.round(weather.humidity)}%
          {weather.precipitation != null && weather.precipitation > 0
            ? ` · Precip ${weather.precipitation} mm`
            : ""}
        </p>
      ) : null}
      {weather.daily.length > 0 ? (
        <div className="space-y-2 border-t border-neutral-100 pt-3">
          {weather.daily.map((day) => (
            <div
              key={day.day}
              className="grid grid-cols-[40px_minmax(0,1fr)_auto_36px] items-center gap-2 text-sm"
            >
              <span className="font-bold text-neutral-800">{day.day}</span>
              <MapWeatherIcon code={day.code} className="size-5 text-neutral-500" />
              <span className="font-bold text-neutral-800">
                {Math.round(day.high)}°{" "}
                <span className="font-medium text-neutral-400">{Math.round(day.low)}°</span>
              </span>
              <span className="text-right text-neutral-600">{day.rain}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
