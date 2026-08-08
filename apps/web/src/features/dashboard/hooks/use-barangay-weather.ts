import { useEffect, useState } from "react"

export type WeatherState = {
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

/** Live Open-Meteo forecast for the barangay map center (Celsius / km/h). */
export function useBarangayWeather(lat: number | null, lng: number | null, placeName: string) {
  const [weather, setWeather] = useState<WeatherState>({
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

  // Flag the widget as loading when the target (coords + place) changes —
  // render-adjust instead of a synchronous setState inside the effect.
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
