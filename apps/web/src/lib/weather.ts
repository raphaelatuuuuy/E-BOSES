import { useEffect, useState } from "react"

import { apiRequest } from "@/lib/api"

/**
 * The one place the barangay asks Open-Meteo for a forecast.
 *
 * This fetch used to exist three times — the official map, the resident map and
 * the sign-up preview — each with its own parameter list, its own parsing and
 * its own slightly different labels for the same WMO code. They are one hook
 * now, so a change to the forecast reaches every screen that shows it.
 *
 * Open-Meteo is called straight from the browser and needs no API key, which
 * means the server never learns whether it worked. Each result is reported back
 * so the Configuration status page can show what people actually saw.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/forecast"

export interface WeatherDay {
  day: string
  high: number
  low: number
  code: number
  rain: number
}

export interface WeatherState {
  temperature: number | null
  feelsLike: number | null
  code: number | null
  precipitation: number | null
  wind: number | null
  humidity: number | null
  daily: WeatherDay[]
  loading: boolean
  error: string | null
  placeName: string
}

/** WMO weather codes → one short label, shared by every weather surface. */
export function weatherLabel(code: number | null | undefined): string {
  if (code == null || Number.isNaN(code)) return "Local weather"
  if (code === 0) return "Clear sky"
  if (code <= 3) return "Partly cloudy"
  if (code <= 48) return "Foggy"
  if (code <= 57) return "Drizzle"
  if (code <= 67) return "Rainy"
  if (code <= 77) return "Snow"
  if (code <= 82) return "Showers"
  if (code <= 99) return "Thunderstorms"
  return "Local weather"
}

export function isRainCode(code: number | null | undefined): boolean {
  return code != null && code >= 51 && code <= 99
}

/**
 * Tell the server what this browser saw.
 *
 * Reports only on a change of outcome, so a map left open all day does not
 * flood the endpoint. A failure here is ignored: health reporting must never
 * become its own source of errors.
 */
let lastReported: boolean | null = null

function reportWeatherHealth(ok: boolean) {
  if (lastReported === ok) return
  lastReported = ok
  void apiRequest(
    "/config/weather-health/",
    { method: "POST", body: JSON.stringify({ ok }) },
    // The sign-up preview shows weather before anyone signs in, so this must
    // never try to refresh a session that does not exist.
    { auth: false, refreshOnUnauthorized: false },
  ).catch(() => {})
}

const EMPTY: Omit<WeatherState, "placeName"> = {
  temperature: null,
  feelsLike: null,
  code: null,
  precipitation: null,
  wind: null,
  humidity: null,
  daily: [],
  loading: true,
  error: null,
}

export function useWeather(
  lat: number | null,
  lng: number | null,
  placeName: string,
): WeatherState {
  const [weather, setWeather] = useState<WeatherState>({ ...EMPTY, placeName })

  // Mark as loading when the target changes — a render-time adjustment rather
  // than a synchronous setState inside the effect.
  const targetKey = `${lat ?? ""}/${lng ?? ""}/${placeName}`
  const [prevTarget, setPrevTarget] = useState(targetKey)
  if (prevTarget !== targetKey) {
    setPrevTarget(targetKey)
    setWeather((prev) => ({ ...prev, loading: true, error: null, placeName }))
  }

  useEffect(() => {
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return

    let cancelled = false

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      current:
        "temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m,relative_humidity_2m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "Asia/Manila",
      temperature_unit: "celsius",
      wind_speed_unit: "kmh",
      forecast_days: "5",
    })

    void (async () => {
      try {
        const response = await fetch(`${ENDPOINT}?${params}`)
        if (!response.ok) throw new Error("weather failed")
        const data = (await response.json()) as {
          current?: Record<string, number>
          daily?: Record<string, Array<number | string>>
        }
        reportWeatherHealth(true)
        if (cancelled) return

        const current = data.current ?? {}
        const daily = data.daily ?? {}
        const dates = (daily.time ?? []) as string[]
        const num = (value: unknown) => (typeof value === "number" ? value : null)

        setWeather({
          temperature: num(current.temperature_2m),
          feelsLike: num(current.apparent_temperature),
          code: num(current.weather_code),
          precipitation: num(current.precipitation),
          wind: num(current.wind_speed_10m),
          humidity: num(current.relative_humidity_2m),
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
        reportWeatherHealth(false)
        if (cancelled) return
        setWeather((prev) => ({ ...prev, loading: false, error: "Weather unavailable", placeName }))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [lat, lng, placeName])

  return weather
}
