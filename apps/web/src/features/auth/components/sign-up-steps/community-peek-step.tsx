import { useEffect, useRef } from "react"
import type leaflet from "leaflet"

import {
  StepContinueButton,
  StepTitle,
} from "@/features/auth/components/sign-up-shell"
import {
  MapWeatherIcon,
  useMapWeather,
  weatherLabel,
} from "@/features/dashboard/components/map-weather"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"

const PIN_HOUSE_HTML =
  '<span class="material-symbols-outlined" style="font-size:44px;color:#07145f;">home_pin</span>'

interface CommunityPeekStepProps {
  communityName: string
  neighbors: number
  latitude: number | null
  longitude: number | null
  onContinue: () => void
}

export function CommunityPeekStep({
  communityName,
  neighbors,
  latitude,
  longitude,
  onContinue,
}: CommunityPeekStepProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const weather = useMapWeather(latitude, longitude, communityName)

  useEffect(() => {
    if (latitude == null || longitude == null) return
    let cancelled = false
    let map: leaflet.Map | null = null
    let styleEl: HTMLStyleElement | null = null

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      // Same tile-size fix used across every map in this app: the override
      // has to exist in <head> before Leaflet lays out tiles, or Tailwind
      // Preflight's `img { max-width: 100% }` collapses them.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-peek-map.leaflet-container {
          width: 100%;
          height: 100%;
          font-family: inherit;
        }
        .eboses-peek-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-peek-map img.leaflet-tile,
        .eboses-peek-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-peek-pinhouse {
          display: block;
          filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45));
        }
      `
      document.head.appendChild(styleEl)

      map = L.map(containerRef.current, {
        center: [latitude, longitude],
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        boxZoom: true,
        keyboard: true,
      })

      addBaseTiles(L, map, "light", {
        maxZoom: 19,
      })

      L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: "",
          html: `<span class="eboses-peek-pinhouse">${PIN_HOUSE_HTML}</span>`,
          iconSize: [44, 44],
          iconAnchor: [22, 40],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(map)

      mapRef.current = map
      requestAnimationFrame(() => map?.invalidateSize())
    })()

    return () => {
      cancelled = true
      styleEl?.remove()
      try {
        map?.remove()
      } catch {
        /* Leaflet may already have detached panes */
      }
      mapRef.current = null
    }
  }, [latitude, longitude, communityName])

  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>
        You&apos;re verified! Here&apos;s a sneak peek at {communityName}.
      </StepTitle>

      <div className="mt-6 flex gap-8">
        <div className="relative h-56 w-1/2 shrink-0 overflow-hidden rounded-2xl bg-neutral-100 shadow-sm ring-1 ring-neutral-200">
          <div
            ref={containerRef}
            className="eboses-peek-map absolute inset-0"
          />
        </div>

        <div className="flex w-1/2 flex-col justify-between">
          <div>
            <MapWeatherIcon
              code={weather.code}
              className="size-8 shrink-0 text-neutral-500"
            />
            <p className="mt-2 text-[36px] leading-none font-bold text-neutral-900 tabular-nums">
              {weather.temperature != null
                ? `${Math.round(weather.temperature)}°C`
                : "—"}
            </p>
            <p className="mt-1.5 text-[15px] font-medium text-neutral-500">
              {weatherLabel(weather.code)}
            </p>
          </div>

          <div>
            <p className="text-[64px] leading-none font-bold tracking-tight text-neutral-900 tabular-nums">
              {neighbors}+
            </p>
            <p className="mt-1.5 text-[14px] font-medium text-neutral-500">
              verified residents nearby
            </p>
          </div>
        </div>
      </div>

      <StepContinueButton onClick={onContinue} fullWidth>
        Continue
      </StepContinueButton>
    </div>
  )
}
