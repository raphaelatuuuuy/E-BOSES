"use client"

import { useEffect, useRef, useState } from "react"
import type leaflet from "leaflet"
import { FootprintsIcon, HomeIcon, LocateFixedIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { reverseGeocode, type NominatimReverseResult } from "@/lib/geocode"
import { useCoverageContext } from "@/features/dashboard/lib/use-coverage"
import {
  drawCoverage,
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"
import { StreetViewModal, type StreetViewCoord } from "@/features/dashboard/components/map/street-view"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

export type LocationPin = { lat: number; lng: number }

export type MapPhotoMarker = {
  id: string
  lat: number
  lng: number
  imageUrl: string
  label: string
  sublabel?: string
}

function streetLabel(data: NominatimReverseResult | null) {
  if (!data) return ""
  const a = data.address ?? {}
  const road = a.road || a.pedestrian || a.path || a.residential
  const primary =
    a.house_number && road
      ? `${a.house_number} ${road}`
      : road ||
        a.neighbourhood ||
        a.suburb ||
        a.village ||
        a.town ||
        a.city ||
        (data.display_name ?? "").split(",")[0]?.trim() ||
        ""
  return primary
}

export function LocationPinMap({
  pin,
  onPinChange,
  markers = [],
}: {
  pin: LocationPin | null
  onPinChange: (pin: LocationPin | null) => void
  markers?: MapPhotoMarker[]
}) {
  const context = useCoverageContext(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const coverageLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const markerLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const coverageRef = useRef<CoverageInput>({})
  const fittedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)
  const reverseTimer = useRef<number | null>(null)
  const resizeDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [outOfScope, setOutOfScope] = useState(false)
  const [height, setHeight] = useState(224)
  const [street, setStreet] = useState("")
  const [geocoding, setGeocoding] = useState(false)
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)
  const [svPicking, setSvPicking] = useState(false)

  function scheduleStreetLookup(lat: number, lng: number) {
    if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
    setGeocoding(true)
    reverseTimer.current = window.setTimeout(() => {
      void reverseGeocode(lat, lng).then((data) => {
        setStreet(streetLabel(data))
        setGeocoding(false)
      })
    }, 350)
  }

  useEffect(() => {
    let cancelled = false
    let styleEl: HTMLStyleElement | null = null

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || mapRef.current) return
      if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        containerRef.current.innerHTML = ""
      }

      // Same fix as the (working) AreaPicker map: a JSX <style> tag renders
      // fine, but the CSS needs to exist in <head> — not scoped inside this
      // component's own subtree — before Leaflet lays out its tile pane, or
      // the 256px tiles collapse under Tailwind Preflight's `img { max-width
      // : 100% }` and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-pin-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #0b1020;
          font-family: inherit;
        }
        .eboses-pin-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-pin-map img.leaflet-tile,
        .eboses-pin-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-pin-pulse::before,
        .eboses-pin-pulse::after {
          content: "";
          position: absolute;
          inset: 50%;
          width: 12px;
          height: 12px;
          margin: -6px 0 0 -6px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.45);
          animation: eboses-pin-scan 1.8s ease-out infinite;
          pointer-events: none;
        }
        .eboses-pin-pulse::after {
          animation-delay: 0.9s;
          background: rgba(255, 255, 255, 0.28);
        }
        @keyframes eboses-pin-scan {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        .eboses-map-blocked.leaflet-container,
        .eboses-map-blocked .leaflet-grab,
        .eboses-map-blocked .leaflet-interactive {
          cursor: not-allowed !important;
        }
        .eboses-sv-pick.leaflet-container,
        .eboses-sv-pick .leaflet-grab,
        .eboses-sv-pick .leaflet-interactive {
          cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>') 13 13, pointer !important;
        }
        .eboses-map-blocked::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 500;
          pointer-events: none;
          background: rgba(220, 38, 38, 0.08);
        }
        .eboses-map-bubble {
          width: 176px;
          pointer-events: none;
        }
        .eboses-map-bubble-card {
          overflow: hidden;
          border-radius: 14px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .eboses-map-bubble-card img {
          display: block;
          width: 176px;
          height: 92px;
          object-fit: cover;
        }
        .eboses-map-bubble-caption {
          padding: 6px 10px 7px;
        }
        .eboses-map-bubble-title {
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
          color: #171717;
        }
        .eboses-map-bubble-sub {
          margin-top: 1px;
          font-size: 10px;
          font-weight: 500;
          line-height: 1.3;
          color: #737373;
        }
        .eboses-map-bubble-tail {
          width: 12px;
          height: 12px;
          margin: -6px auto 0;
          background: #ffffff;
          transform: rotate(45deg);
          border-radius: 2px;
          box-shadow: 4px 4px 10px rgba(0, 0, 0, 0.18);
        }
      `
      document.head.appendChild(styleEl)

      const map = L.map(containerRef.current, {
        center: DEFAULT_CENTER,
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
      })

      addBaseTiles(L, map, "dark", {
        maxZoom: 19,
        keepBuffer: 6,
        updateWhenIdle: false,
        updateWhenZooming: true,
      })

      coverageLayerRef.current = L.layerGroup().addTo(map)
      markerLayerRef.current = L.layerGroup().addTo(map)

      map.on("moveend", () => {
        const c = map.getCenter()
        const inside = insideCoverage(c.lat, c.lng, coverageRef.current)
        setOutOfScope(!inside)
        onPinChange(inside ? { lat: c.lat, lng: c.lng } : null)
        if (inside) {
          scheduleStreetLookup(c.lat, c.lng)
        } else {
          setStreet("")
        }
      })

      mapRef.current = map

      map.invalidateSize()
      requestAnimationFrame(() => map.invalidateSize())
      setTimeout(() => map.invalidateSize(), 300)
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        const observer = new ResizeObserver(() => map.invalidateSize())
        observer.observe(containerRef.current)
        observerRef.current = observer
      }
      setMapReady(true)
    })()

    return () => {
      cancelled = true
      styleEl?.remove()
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      observerRef.current?.disconnect()
      observerRef.current = null
      try {
        mapRef.current?.off()
        mapRef.current?.remove()
      } catch {
        /* leaflet may already have detached during close */
      }
      mapRef.current = null
      coverageLayerRef.current = null
      markerLayerRef.current = null
    }
  }, [onPinChange])

  useEffect(() => {
    const group = markerLayerRef.current
    if (!mapReady || !group) return
    void import("leaflet").then((L) => {
      if (!markerLayerRef.current) return
      group.clearLayers()
      for (const marker of markers) {
        const sublabel = marker.sublabel
          ? `<div class="eboses-map-bubble-sub">${marker.sublabel}</div>`
          : ""
        const html = `
          <div class="eboses-map-bubble">
            <div class="eboses-map-bubble-card">
              <img src="${marker.imageUrl}" alt="" />
              <div class="eboses-map-bubble-caption">
                <div class="eboses-map-bubble-title">${marker.label}</div>
                ${sublabel}
              </div>
            </div>
            <div class="eboses-map-bubble-tail"></div>
          </div>
        `
        const icon = L.divIcon({
          className: "",
          html,
          iconSize: [176, 150],
          iconAnchor: [88, 146],
        })
        L.marker([marker.lat, marker.lng], { icon, interactive: false, keyboard: false }).addTo(group)
      }
    })
  }, [mapReady, markers])

  useEffect(() => {
    const map = mapRef.current
    const group = coverageLayerRef.current
    if (!mapReady || !map || !group || !context) return
    const boundary = (context.boundary?.geometry ?? null) as never
    coverageRef.current = { boundary, policy: context.dispatch_policy }
    void import("leaflet").then((L) => {
      if (!coverageLayerRef.current) return
      group.clearLayers()
      drawCoverage(L, group, { boundary, policy: context.dispatch_policy, showBoundary: false, showZone: false })
      if (boundary && !fittedRef.current) {
        fittedRef.current = true
        try {
          map.fitBounds(L.geoJSON(boundary).getBounds(), { padding: [18, 18], maxZoom: 16 })
        } catch {
          /* ignore */
        }
      }
      const c = map.getCenter()
      const inside = insideCoverage(c.lat, c.lng, coverageRef.current)
      setOutOfScope(!inside)
      onPinChange(inside ? { lat: c.lat, lng: c.lng } : null)
      if (inside) scheduleStreetLookup(c.lat, c.lng)
    })
  }, [mapReady, context, onPinChange])

  function recenter() {
    const map = mapRef.current
    if (!map) return
    const boundary = coverageRef.current.boundary
    if (boundary) {
      void import("leaflet").then((L) => {
        try {
          map.fitBounds(L.geoJSON(boundary as never).getBounds(), { padding: [18, 18], maxZoom: 16 })
        } catch {
          map.setView(DEFAULT_CENTER, 15)
        }
      })
    } else {
      map.setView(DEFAULT_CENTER, 15)
    }
  }

  function locate() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) {
      toast.error("Location is not available on this device.")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => map.setView([position.coords.latitude, position.coords.longitude], 16),
      () => toast.error("Could not get your current location."),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  useEffect(() => {
    if (!svPicking) return
    const map = mapRef.current
    if (!map) return
    const container = map.getContainer()
    container.classList.add("eboses-sv-pick")
    function onMapClick(event: leaflet.LeafletMouseEvent) {
      const lat = event.latlng.lat
      const lng = event.latlng.lng
      if (!insideCoverage(lat, lng, coverageRef.current)) {
        toast.error(OUT_OF_SCOPE_MESSAGE)
        return
      }
      setSvPicking(false)
      mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 16))
      setSvCoord({ lat, lng })
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSvPicking(false)
    }
    map.on("click", onMapClick)
    document.addEventListener("keydown", onKey)
    return () => {
      container.classList.remove("eboses-sv-pick")
      map.off("click", onMapClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [svPicking])

  return (
    <div>
      <div
        className={cn(
          "relative overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-ink",
          outOfScope && "eboses-map-blocked",
        )}
        style={{ height }}
      >
        <div ref={containerRef} className="eboses-pin-map absolute inset-0 z-0" />

        {mapReady && !svCoord ? (
          <MapControlStack className="absolute right-3 top-3 z-[1100] border-0 bg-white">
            <MapStackButton
              className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
              label="Recenter to the barangay"
              onClick={recenter}
            >
              <HomeIcon className="size-5" strokeWidth={1.8} aria-hidden />
            </MapStackButton>
            <MapStackDivider className="bg-neutral-200" />
            <MapStackButton
              className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
              label="Use my current location"
              onClick={locate}
            >
              <LocateFixedIcon className="size-5" strokeWidth={1.8} aria-hidden />
            </MapStackButton>
            <MapStackDivider className="bg-neutral-200" />
            <MapStackButton
              className="bg-white text-neutral-900 hover:bg-white hover:text-neutral-900"
              active={svPicking}
              label={svPicking ? "Cancel Street View pick" : "Click the map, then open Street View there"}
              onClick={() => setSvPicking((value) => !value)}
            >
              <FootprintsIcon className="size-5" strokeWidth={1.9} aria-hidden />
            </MapStackButton>
          </MapControlStack>
        ) : null}

        {svPicking && !svCoord ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1100] flex justify-center px-4">
            <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 shadow-md">
              Click the map to open Street View there · Esc cancels
            </p>
          </div>
        ) : null}

        {svCoord ? (
          <StreetViewModal
            coord={svCoord}
            mode="pick"
            onMove={(next) => {
              mapRef.current?.setView([next.lat, next.lng], Math.max(mapRef.current.getZoom(), 16))
              setSvCoord(next)
            }}
            coverage={coverageRef.current}
            onClose={() => setSvCoord(null)}
          />
        ) : null}

        {mapReady && !outOfScope && pin ? (
          <span
            className="eboses-pin-pulse absolute left-1/2 top-1/2 size-3 rounded-full bg-white"
            style={{ marginLeft: -6, marginTop: -6, boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }}
          />
        ) : null}

        {!svCoord && !svPicking ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1100] flex flex-col items-center gap-2 px-4">
          {outOfScope ? (
            <p
              role="status"
              className="flex max-w-[min(100%,320px)] flex-col items-center rounded-full bg-white px-5 py-2.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
            >
              <span className="text-[13px] font-semibold leading-none text-neutral-900">
                {OUT_OF_SCOPE_MESSAGE}
              </span>
              <span className="mt-1 text-[12px] font-medium leading-snug text-neutral-500">
                Move the map back to a covered area.
              </span>
            </p>
          ) : (
            <div className="flex max-w-[min(100%,320px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
              <span className="text-[14px] font-semibold leading-none text-neutral-900">
                Use this location
              </span>
              <span className="mt-1 line-clamp-1 text-[12.5px] font-medium leading-snug text-neutral-500">
                {geocoding ? "Finding street…" : street || "Move the map to adjust"}
              </span>
            </div>
          )}
        </div>
        ) : null}

        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 z-[1200] h-1.5 cursor-ns-resize touch-none"
          onPointerDown={(event) => {
            resizeDragRef.current = { startY: event.clientY, startHeight: height }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = resizeDragRef.current
            if (!drag) return
            setHeight(Math.min(520, Math.max(160, drag.startHeight + (event.clientY - drag.startY))))
          }}
          onPointerUp={() => {
            resizeDragRef.current = null
          }}
        />
      </div>
    </div>
  )
}
