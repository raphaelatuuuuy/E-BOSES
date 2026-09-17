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
import { fetchRegistrationCommunities } from "@/features/auth/api"

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

      let areaLayer: leaflet.GeoJSON | null = null
      try {
        const areas = await fetchRegistrationCommunities()
        if (cancelled || !map) return
        const list = areas.results ?? []
        const match =
          list.find(
            (area) =>
              area.name.trim().toLowerCase() ===
              communityName.trim().toLowerCase(),
          ) ?? list[0]
        if (match?.boundary) {
          areaLayer = L.geoJSON(match.boundary as never, {
            style: {
              stroke: false,
              fillColor: "#ff5003",
              fillOpacity: 0.16,
              interactive: false,
            },
          }).addTo(map)
        }
      } catch {
        /* Keep the default centered view */
      }

      mapRef.current = map
      const fitBoundary = () => {
        if (cancelled || !map) return
        map.invalidateSize()
        if (!areaLayer) return
        try {
          const bounds = areaLayer.getBounds()
          const size = map.getSize()
          if (bounds.isValid() && size.x > 0 && size.y > 0) {
            map.fitBounds(bounds, { padding: [12, 12] })
          }
        } catch {
          /* Keep the default centered view */
        }
      }
      requestAnimationFrame(() => {
        fitBoundary()
        window.setTimeout(() => {
          if (areaLayer && !cancelled && mapRef.current) fitBoundary()
        }, 250)
      })
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
      <style>{`@keyframes peek-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}.peek-stat{opacity:0;animation:peek-rise .7s cubic-bezier(.22,1,.36,1) forwards}@media (prefers-reduced-motion:reduce){.peek-stat{opacity:1;animation:none}}`}</style>
      <StepTitle className="text-center">
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
          <div className="peek-stat" style={{ animationDelay: "0.15s" }}>
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

          <div className="peek-stat" style={{ animationDelay: "0.3s" }}>
            <p className="text-[64px] leading-none font-bold tracking-tight text-accent tabular-nums">
              {neighbors}+
            </p>
            <p className="mt-1.5 text-[14px] font-medium text-neutral-500">
              Residents
            </p>
          </div>
        </div>
      </div>

      <StepContinueButton onClick={onContinue} fullWidth>
        Get Started
      </StepContinueButton>
    </div>
  )
}
