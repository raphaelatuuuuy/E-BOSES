"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  CloudRainIcon,
  CloudSunIcon,
  LoaderCircleIcon,
  SunIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export type MapWeatherState = {
  temperature: number | null
  feelsLike: number | null
  code: number | null
  precipitation: number | null
  wind: number | null
  humidity: number | null
  daily: Array<{ day: string; high: number; low: number; code: number; rain: number }>
  loading: boolean
  error: string | null
  placeName: string
}

export function weatherLabel(code: number | null) {
  if (code == null) return "Local weather"
  if (code === 0) return "Clear sky"
  if ([1, 2, 3].includes(code)) return "Partly cloudy"
  if ([45, 48].includes(code)) return "Foggy"
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle"
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rainy"
  if ([95, 96, 99].includes(code)) return "Thunderstorms"
  return "Cloudy"
}

export function MapWeatherIcon({
  code,
  className = "size-5",
}: {
  code: number | null
  className?: string
}) {
  if (code === 0) return <SunIcon className={className} />
  if (
    code != null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)
  ) {
    return <CloudRainIcon className={className} />
  }
  return <CloudSunIcon className={className} />
}

export function useMapWeather(lat: number | null, lng: number | null, placeName: string) {
  const [weather, setWeather] = useState<MapWeatherState>({
    temperature: null,
    feelsLike: null,
    code: null,
    precipitation: null,
    wind: null,
    humidity: null,
    daily: [],
    loading: true,
    error: null,
    placeName,
  })

  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return

    let cancelled = false
    setWeather((prev) => ({ ...prev, loading: true, error: null, placeName }))

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current:
        "temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m,relative_humidity_2m",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Manila",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      forecast_days: "5",
    })

    void (async () => {
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
        if (!response.ok) throw new Error("weather failed")
        const data = (await response.json()) as {
          current?: Record<string, number>
          daily?: Record<string, Array<number | string>>
        }
        if (cancelled) return

        const current = data.current ?? {}
        const daily = data.daily ?? {}
        const dates = (daily.time ?? []) as string[]
        setWeather({
          temperature: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
          feelsLike:
            typeof current.apparent_temperature === "number" ? current.apparent_temperature : null,
          code: typeof current.weather_code === "number" ? current.weather_code : null,
          precipitation:
            typeof current.precipitation === "number" ? current.precipitation : null,
          wind: typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null,
          humidity:
            typeof current.relative_humidity_2m === "number" ? current.relative_humidity_2m : null,
          daily: dates.map((date, index) => ({
            day: new Intl.DateTimeFormat("en", { weekday: "short" }).format(
              new Date(`${date}T12:00:00`),
            ),
            high: Number(daily.temperature_2m_max?.[index] ?? 0),
            low: Number(daily.temperature_2m_min?.[index] ?? 0),
            code: Number(daily.weather_code?.[index] ?? 0),
            rain: Number(daily.precipitation_probability_max?.[index] ?? 0),
          })),
          loading: false,
          error: null,
          placeName,
        })
      } catch {
        if (!cancelled) {
          setWeather((prev) => ({
            ...prev,
            loading: false,
            error: "Weather unavailable",
            placeName,
          }))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [lat, lng, placeName])

  return weather
}

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
        <MapWeatherIcon code={weather.code} className="size-5 text-amber-500" />
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
    light: "border-neutral-200 bg-white text-neutral-900 hover:border-[#2447b3]/40 hover:bg-[#f8fbff]",
    dark: "border-rail-line bg-nav-glass/90 text-foreground backdrop-blur hover:border-ice/40 hover:bg-nav-raised",
    brand: "border-brand-orange bg-brand-orange-soft text-brand-orange hover:bg-brand-orange/20",
  }
  const activeCls = active && variant !== "dark" ? "border-[#ff6a1a] bg-[#fff6f0] text-[#ff6a1a]" : ""
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
              <MapWeatherIcon code={day.code} className="size-5 text-amber-500" />
              <span className="font-bold text-neutral-800">
                {Math.round(day.high)}°{" "}
                <span className="font-medium text-neutral-400">{Math.round(day.low)}°</span>
              </span>
              <span className="text-right text-sky-600">{day.rain}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
