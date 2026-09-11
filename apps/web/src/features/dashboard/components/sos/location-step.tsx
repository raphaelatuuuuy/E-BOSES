"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HomeIcon, LocateFixedIcon } from "lucide-react"
import L, {
  type Map as LeafletMap,
  type Marker,
  type LatLngBounds,
  type LeafletMouseEvent,
} from "leaflet"
import "leaflet/dist/leaflet.css"
import "@/features/dashboard/components/map/location-pin.css"
import { apiRequest } from "@/lib/api"
import type { GeoJsonPolygon } from "@/features/dashboard/api"
import { drawCoverage } from "@/features/dashboard/components/map/coverage-layer"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"

import { cn } from "@workspace/ui/lib/utils"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import { GLYPHS, MAP_COLORS, glyphPinHtml } from "@/features/dashboard/components/map/markers"
import { formatNominatimParts, reverseGeocode } from "@/lib/geocode"

export type SosLocationValue = {
  lat: number
  lng: number
  accuracy?: number | null
  source: "gps" | "manual"
  address: string
  addressPrimary: string
  addressResolved?: boolean
  streetDistanceMeters?: number | null
  streetConfidence?: "high" | "medium" | null
  locationCheck?: SosLocationCheck | null
}

export type SosLocationCheck = {
  accepted: boolean
  status: string
  zone: string
  message: string
  acceptance_zone?: {
    within: boolean
    distance_meters?: number
    radius_meters?: number
  }
}

export function friendlyLocationMessage(
  check: SosLocationCheck | null | undefined
) {
  if (!check || (check.accepted && check.acceptance_zone?.within)) return ""
  return "This location may be outside the service area. Check your pin."
}

export function SosLocationStep({
  value,
  onChange,
  className,
}: {
  value: SosLocationValue | null
  onChange: (next: SosLocationValue) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const markerRef = useRef<Marker | null>(null)
  const leafletRef = useRef<typeof L | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const requestRef = useRef(0)
  const watchRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const boundaryRef = useRef<LatLngBounds | null>(null)
  const [addressExpanded, setAddressExpanded] = useState(false)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [addressBusy, setAddressBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [mapError, setMapError] = useState("")

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const stopGps = useCallback(() => {
    if (watchRef.current != null)
      navigator.geolocation?.clearWatch(watchRef.current)
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    watchRef.current = null
    timerRef.current = null
    setGpsBusy(false)
  }, [])

  const selectLocation = useCallback(
    (
      lat: number,
      lng: number,
      source: "gps" | "manual",
      accuracy: number | null
    ) => {
      const request = ++requestRef.current
      const next: SosLocationValue = {
        lat,
        lng,
        source,
        accuracy,
        address: "Pinned location on the map",
        addressPrimary: "Pinned location",
        addressResolved: false,
        locationCheck: null,
      }
      valueRef.current = next
      onChangeRef.current(next)
      setAddressBusy(true)
      void reverseGeocode(lat, lng).then((data) => {
        if (request !== requestRef.current) return
        setAddressBusy(false)
        if (
          !data ||
          (!data.display_name &&
            !Object.values(data.address ?? {}).some(Boolean))
        )
          return
        const address = formatNominatimParts(data)
        const resolved = {
          ...next,
          address: address.full,
          addressPrimary: address.primary,
          addressResolved: true,
        }
        valueRef.current = resolved
        onChangeRef.current(resolved)
      })
    },
    []
  )

  const locate = useCallback(() => {
    stopGps()
    if (!navigator.geolocation) {
      setNotice("Location is unavailable. Select your location on the map.")
      return
    }
    setGpsBusy(true)
    setNotice("")
    let bestAccuracy = Infinity
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (coords.accuracy >= bestAccuracy) return
        bestAccuracy = coords.accuracy
        if (coords.accuracy > 120) return
        selectLocation(
          coords.latitude,
          coords.longitude,
          "gps",
          coords.accuracy
        )
        mapRef.current?.setView([coords.latitude, coords.longitude], 17)
        if (coords.accuracy <= 50) stopGps()
      },
      (error) => {
        stopGps()
        setNotice(
          error.code === error.PERMISSION_DENIED
            ? "Allow location access in your browser, or select a place on the map."
            : "Could not find your location. Try again or select a place on the map."
        )
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }
    )
    timerRef.current = window.setTimeout(() => {
      stopGps()
      if (bestAccuracy > 120)
        setNotice(
          "Could not find a precise location. Try again or select a place on the map."
        )
    }, 20_000)
  }, [selectLocation, stopGps])

  const syncMarker = useCallback(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const pin = valueRef.current
    if (!L || !map || !pin) return
    if (markerRef.current) {
      markerRef.current.setLatLng([pin.lat, pin.lng])
      return
    }
    const pinSize = 30
    const marker = L.marker([pin.lat, pin.lng], {
      draggable: true,
      title: "Emergency location. Drag to adjust.",
      alt: "Emergency location",
      icon: L.divIcon({
        className: "",
        html: glyphPinHtml({
          paths: GLYPHS.userResident,
          color: MAP_COLORS.you,
          size: pinSize,
          label: "You",
          className: "is-you",
        }),
        iconSize: [pinSize, pinSize],
        iconAnchor: [pinSize / 2, pinSize / 2],
      }),
      zIndexOffset: 800,
    }).addTo(map)
    marker.on("dragstart", stopGps)
    marker.on("dragend", () => {
      const point = marker.getLatLng()
      setNotice("")
      selectLocation(point.lat, point.lng, "manual", null)
    })
    markerRef.current = marker
  }, [selectLocation, stopGps])

  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | undefined
    const contextRequest = apiRequest<{
      boundary: { geometry: GeoJsonPolygon | null }
    }>("/locations/map-context/").catch(() => null)
    if (!containerRef.current) return
    {
      leafletRef.current = L
      const pin = valueRef.current
      const map = L.map(containerRef.current, {
        zoomControl: false,
        attributionControl: false,
      }).setView(pin ? [pin.lat, pin.lng] : [14.5995, 120.9842], pin ? 17 : 11)
      mapRef.current = map
      void contextRequest.then((context) => {
        if (cancelled || !context?.boundary.geometry) return
        const boundary = context.boundary.geometry
        const bounds = L.geoJSON(boundary as never).getBounds()
        if (!bounds.isValid()) return
        boundaryRef.current = bounds
        drawCoverage(L, L.layerGroup().addTo(map), {
          boundary,
          showBoundary: true,
          showZone: false,
          boundaryStyle: "quiet",
        })
        if (!valueRef.current)
          map.fitBounds(bounds, { padding: [18, 18], maxZoom: 16 })
      })
      const tiles = addBaseTiles(L, map, "light", { crossOrigin: true })
      tiles.on("tileerror", () =>
        setMapError("Map unavailable. Connect to load this area.")
      )
      tiles.on("tileload", () => setMapError(""))
      map.on("click", (event: LeafletMouseEvent) => {
        stopGps()
        setNotice("")
        selectLocation(event.latlng.lat, event.latlng.lng, "manual", null)
      })
      const reconnect = () => tiles.redraw()
      map.on("unload", () => window.removeEventListener("online", reconnect))
      window.addEventListener("online", reconnect)
      observer = new ResizeObserver(() => map.invalidateSize())
      observer.observe(containerRef.current)
      syncMarker()
    }
    return () => {
      cancelled = true
      observer?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      markerRef.current = null
      leafletRef.current = null
      boundaryRef.current = null
    }
  }, [selectLocation, stopGps, syncMarker])

  useEffect(() => {
    syncMarker()
  }, [value, syncMarker])

  useEffect(() => {
    if (!valueRef.current) locate()
    return () => {
      stopGps()
      requestRef.current += 1
    }
  }, [locate, stopGps])

  function recenter() {
    stopGps()
    const bounds = boundaryRef.current
    if (!bounds || !mapRef.current) {
      setNotice("Barangay boundary is unavailable. Reconnect and try again.")
      return
    }
    setNotice("")
    mapRef.current.fitBounds(bounds, {
      paddingTopLeft: [18, 18],
      paddingBottomRight: [64, 100],
      maxZoom: 16,
    })
  }

  return (
    <div
      className={cn(
        "relative isolate h-[clamp(300px,46dvh,400px)] shrink-0 overflow-hidden rounded-2xl bg-neutral-100 text-neutral-900",
        className
      )}
    >
      <div
        ref={containerRef}
        className="relative z-0 h-full w-full"
        aria-label="Emergency location map"
      />
      <div className="pointer-events-none absolute top-3 right-3 z-20">
        <MapControlStack className="pointer-events-auto shrink-0 border-0 bg-white">
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
            loading={gpsBusy}
          >
            <LocateFixedIcon className="size-5" strokeWidth={1.8} aria-hidden />
          </MapStackButton>
        </MapControlStack>
      </div>
      {mapError || notice ? (
        <p
          role="status"
          className="absolute top-3 right-16 left-3 z-20 rounded-lg bg-white/95 px-3 py-2 text-xs shadow-sm"
        >
          {notice || mapError}
        </p>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex flex-col items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => setAddressExpanded((expanded) => !expanded)}
          aria-expanded={addressExpanded}
          className="pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
        >
          <span className="text-[16px] leading-none font-semibold text-neutral-900">
            Nearby location
          </span>
          <span
            aria-live="polite"
            className={cn(
              "mt-1.5 text-[14px] leading-snug font-medium text-neutral-500",
              !addressExpanded && "line-clamp-2"
            )}
          >
            {addressBusy
              ? "Finding address…"
              : (addressExpanded ? value?.address : value?.addressPrimary) ||
                "Select your location"}
          </span>
        </button>
      </div>
    </div>
  )
}
