import * as React from "react"
import { CloudSunIcon, LoaderCircleIcon } from "lucide-react"
import type leaflet from "leaflet"

import { StepContinueButton, StepTitle } from "@/features/auth/components/sign-up-shell"
import {
  geocodeMarikinaStreet,
  MARIKINA_HEIGHTS_CENTER,
} from "@/features/auth/lib/forward-geocode"
import { apiRequest } from "@/lib/api"

interface VerifiedPeekStepProps {
  street: string
  houseNumber?: string
  onContinue: () => void
}

function pinLabel(street: string, houseNumber?: string) {
  const house = houseNumber?.trim()
  if (house && street) return `${house} ${street}`
  if (street) return street
  return "Marikina Heights"
}

function formatNeighborCount(n: number) {
  if (!Number.isFinite(n) || n < 0) return "—"
  if (n >= 1000) {
    const k = n / 1000
    const rounded = k >= 10 ? Math.round(k) : Math.round(k * 10) / 10
    return `${rounded}k+`
  }
  return String(n)
}

/** WMO weather codes → short label (Open-Meteo). */
function weatherLabel(code: number | null | undefined) {
  if (code == null || Number.isNaN(code)) return "Local weather"
  if (code === 0) return "Clear"
  if (code <= 3) return "Partly cloudy"
  if (code <= 48) return "Foggy"
  if (code <= 57) return "Drizzle"
  if (code <= 67) return "Rain"
  if (code <= 77) return "Snow"
  if (code <= 82) return "Showers"
  if (code <= 99) return "Thunderstorm"
  return "Local weather"
}

export function NeighborhoodPeekCards({
  street,
  houseNumber,
}: {
  street: string
  houseNumber?: string
}) {
  const label = pinLabel(street, houseNumber)
  const mapRef = React.useRef<HTMLDivElement>(null)
  const leafletMapRef = React.useRef<leaflet.Map | null>(null)
  const markerRef = React.useRef<leaflet.Marker | null>(null)

  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null)
  const [mapReady, setMapReady] = React.useState(false)
  const [neighbors, setNeighbors] = React.useState<number>(0)
  const [weather, setWeather] = React.useState<{ tempC: number | null; label: string }>({
    tempC: null,
    label: "…",
  })

  // Geocode street → pin on the actual road
  React.useEffect(() => {
    let cancelled = false
    setCoords(null)
    void (async () => {
      const hit = await geocodeMarikinaStreet(street, houseNumber)
      if (cancelled) return
      if (hit) {
        setCoords({ lat: hit.lat, lng: hit.lng })
      } else {
        setCoords({
          lat: MARIKINA_HEIGHTS_CENTER.lat,
          lng: MARIKINA_HEIGHTS_CENTER.lng,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [street, houseNumber])

  // Leaflet map — no OSM embed chrome / green default marker
  React.useEffect(() => {
    if (!coords || !mapRef.current) return
    let cancelled = false
    let map: leaflet.Map | null = null

    void (async () => {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !mapRef.current) return

      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
        markerRef.current = null
      }

      map = L.map(mapRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 17,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      })

      // Light grey basemap (no OSM iframe “Report a problem / Donate” chrome)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map)

      const pinHtml = `
        <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-8px)">
          <div style="display:inline-flex;max-width:220px;align-items:center;gap:6px;border-radius:9999px;background:#171717;padding:8px 14px;box-shadow:0 8px 20px rgba(0,0,0,.22)">
            <span style="display:flex;width:16px;height:16px;flex-shrink:0;align-items:center;justify-content:center;border-radius:9999px;background:#fff">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#171717" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:#fff;font-family:system-ui,sans-serif">${label.replace(/[<>&"]/g, "")}</span>
          </div>
          <div style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-top:8px solid #171717;margin-top:-1px"></div>
        </div>
      `

      const icon = L.divIcon({
        className: "verified-peek-pin",
        html: pinHtml,
        iconSize: [220, 48],
        iconAnchor: [110, 48],
      })

      markerRef.current = L.marker([coords.lat, coords.lng], {
        icon,
        interactive: false,
        keyboard: false,
      }).addTo(map)

      leafletMapRef.current = map
      setMapReady(true)
      // Ensure tiles render after container is laid out
      window.setTimeout(() => map?.invalidateSize(), 80)
    })()

    return () => {
      cancelled = true
      setMapReady(false)
      if (leafletMapRef.current) {
        leafletMapRef.current.remove()
        leafletMapRef.current = null
        markerRef.current = null
      }
    }
  }, [coords, label])

  // Neighbor count = registered users with role=resident
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await apiRequest<{ neighbors?: number }>(
          "/auth/register/community-preview/",
          {},
          { auth: false },
        )
        if (!cancelled) {
          setNeighbors(typeof data.neighbors === "number" ? data.neighbors : 0)
        }
      } catch {
        if (!cancelled) setNeighbors(0)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Live weather for Marikina Heights (Open-Meteo, no API key)
  React.useEffect(() => {
    let cancelled = false
    const lat = coords?.lat ?? MARIKINA_HEIGHTS_CENTER.lat
    const lng = coords?.lng ?? MARIKINA_HEIGHTS_CENTER.lng
    void (async () => {
      try {
        const params = new URLSearchParams({
          latitude: String(lat),
          longitude: String(lng),
          current: "temperature_2m,weather_code",
          timezone: "Asia/Manila",
        })
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
        if (!response.ok) throw new Error("weather failed")
        const data = (await response.json()) as {
          current?: { temperature_2m?: number; weather_code?: number }
        }
        if (cancelled) return
        const temp = data.current?.temperature_2m
        setWeather({
          tempC: typeof temp === "number" ? Math.round(temp) : null,
          label: weatherLabel(data.current?.weather_code),
        })
      } catch {
        if (!cancelled) {
          setWeather({ tempC: null, label: "Weather unavailable" })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [coords?.lat, coords?.lng])

  const cardClass =
    "flex min-h-[120px] flex-col items-center justify-center rounded-2xl bg-neutral-100/90 px-2 py-4 text-center sm:min-h-[160px]"

  return (
    <div className="w-full space-y-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[minmax(0,1.55fr)_minmax(0,0.72fr)_minmax(0,0.72fr)] sm:gap-3">
        <div className="relative col-span-2 min-h-[148px] overflow-hidden rounded-2xl bg-neutral-100 sm:col-span-1 sm:min-h-[160px]">
          <div ref={mapRef} className="absolute inset-0 h-full w-full" />
          {!mapReady ? (
            <div className="absolute inset-0 flex items-center justify-center bg-neutral-100">
              <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>

        <div className={cardClass}>
          <p className="text-[1.65rem] font-semibold leading-none tracking-tight text-foreground sm:text-[1.85rem]">
            {weather.tempC != null ? `${weather.tempC}°C` : "—"}
          </p>
          <div className="mt-1.5 flex items-center gap-1 text-sm text-muted-foreground">
            <CloudSunIcon className="size-4 text-amber-500" />
            <span>{weather.label}</span>
          </div>
        </div>

        <div className={cardClass}>
          <p className="text-[1.65rem] font-semibold leading-none tracking-tight text-foreground sm:text-[1.85rem]">
            {formatNeighborCount(neighbors)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">Neighbors</p>
        </div>
      </div>
    </div>
  )
}

export function VerifiedPeekStep({ street, houseNumber, onContinue }: VerifiedPeekStepProps) {
  return (
    <div className="flex w-full flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-[600px] flex-1 flex-col px-5 pb-10 pt-4 md:px-0 md:pt-6">
        <StepTitle className="text-[1.4rem] md:text-[1.6rem]">
          You&apos;re verified! Here&apos;s a peek at Marikina Heights.
        </StepTitle>

        <div className="mt-7">
          <NeighborhoodPeekCards street={street} houseNumber={houseNumber} />
        </div>

        <StepContinueButton onClick={onContinue}>Continue</StepContinueButton>
      </div>
    </div>
  )
}
