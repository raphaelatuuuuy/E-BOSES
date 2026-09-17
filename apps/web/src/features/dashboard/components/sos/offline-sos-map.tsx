"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HomeIcon, LocateFixedIcon } from "lucide-react"
import type { Map as MapLibreMap } from "maplibre-gl"

import { cn } from "@workspace/ui/lib/utils"
import type { GeoJsonPolygon } from "@/features/dashboard/api"
import {
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"
import {
  loadOfflineSosConfig,
  nearestOfflineStreet,
  offlineCommunityOutline,
} from "@/features/dashboard/components/sos/offline-sos-config"
import type {
  LocationConfirmPayload,
  PinState,
} from "@/features/dashboard/components/location-picker"

export const OFFLINE_MAP_ARCHIVE_URL =
  "/offline-maps/marikina-heights.pmtiles"

const PIN_OFFSET_Y = 64

function localCoverage(): CoverageInput {
  const config = loadOfflineSosConfig()
  const communities = config.communities?.length
    ? config.communities
    : [config.community]
  const community = communities[0]
  if (!community) return {}
  const acceptance = community.acceptance
  const geometry = acceptance?.geometry as GeoJsonPolygon | null
  const hasGeometry =
    geometry?.type === "Polygon" || geometry?.type === "MultiPolygon"
  const centerLat = Number(acceptance?.centerLatitude)
  const centerLng = Number(acceptance?.centerLongitude)
  const radius = Number(acceptance?.radiusMeters)
  const hasCircle =
    Number.isFinite(centerLat) &&
    Number.isFinite(centerLng) &&
    Number.isFinite(radius) &&
    radius > 0
  return {
    boundary: offlineCommunityOutline(community) ?? null,
    policy:
      hasGeometry || hasCircle
        ? {
            acceptance_center_latitude: hasCircle ? centerLat : null,
            acceptance_center_longitude: hasCircle ? centerLng : null,
            acceptance_radius_meters: hasCircle ? radius : 0,
            acceptance_geometry: hasGeometry ? geometry : null,
          }
        : null,
  }
}

function communityCenter(): { lat: number; lng: number } {
  const config = loadOfflineSosConfig()
  const communities = config.communities?.length
    ? config.communities
    : [config.community]
  const acceptance = communities[0]?.acceptance
  const lat = Number(acceptance?.centerLatitude)
  const lng = Number(acceptance?.centerLongitude)
  return {
    lat: Number.isFinite(lat) ? lat : 14.6507,
    lng: Number.isFinite(lng) ? lng : 121.1133,
  }
}

async function archiveReadable(): Promise<boolean> {
  try {
    const { PMTiles } = await import("pmtiles")
    const header = await new PMTiles(OFFLINE_MAP_ARCHIVE_URL).getHeader()
    return header.tileType === 2
  } catch {
    return false
  }
}

export function OfflineSosMap({
  initialLat,
  initialLng,
  initialAddress = "",
  onPinStateChange,
  onConfirm,
  onFallback,
  className,
}: {
  initialLat?: number | null
  initialLng?: number | null
  initialAddress?: string
  onPinStateChange?: (state: PinState | null) => void
  onConfirm: (payload: LocationConfirmPayload) => void
  onFallback: () => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const sourceRef = useRef<PinState["source"]>("manual_pin")
  const coverage = useMemo(localCoverage, [])
  const coverageRef = useRef(coverage)
  coverageRef.current = coverage
  const [address, setAddress] = useState({
    primary: initialAddress || "Move the map to adjust",
    secondary: "",
    full: initialAddress || "Move the map to adjust",
  })
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    initialLat != null && initialLng != null
      ? { lat: initialLat, lng: initialLng }
      : null
  )
  const [outOfScope, setOutOfScope] = useState(false)
  const [ready, setReady] = useState(false)
  const pinRef = useRef(pin)
  pinRef.current = pin
  const onPinStateChangeRef = useRef(onPinStateChange)
  onPinStateChangeRef.current = onPinStateChange
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const onFallbackRef = useRef(onFallback)
  onFallbackRef.current = onFallback
  const addressRef = useRef(address)
  addressRef.current = address

  const resolvePin = useCallback((lat: number, lng: number) => {
    const street = nearestOfflineStreet(lat, lng)
    const primary = street || "Pinned location"
    const full = street
      ? `${street} on the map`
      : "Pinned location on the map"
    setAddress({ primary, secondary: "", full })
    const inside = insideCoverage(lat, lng, coverageRef.current)
    setPin({ lat, lng })
    setOutOfScope(!inside)
    setReady(inside)
    onPinStateChangeRef.current?.({
      lat,
      lng,
      address: full,
      addressPrimary: primary,
      addressSecondary: "",
      ready: inside,
      source: sourceRef.current,
      accuracy: null,
    })
  }, [])

  const resolvePinRef = useRef(resolvePin)
  resolvePinRef.current = resolvePin

  useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | null = null
    let maplibregl: typeof import("maplibre-gl") | null = null

    async function init() {
      const readable = await archiveReadable()
      if (cancelled || !readable) {
        if (!cancelled) onFallbackRef.current()
        return
      }
      const container = containerRef.current
      if (cancelled || !container) {
        onFallbackRef.current()
        return
      }
      try {
        const [maplibreModule, pmtilesModule] = await Promise.all([
          import("maplibre-gl"),
          import("pmtiles"),
        ])
        if (cancelled) return
        maplibregl = maplibreModule
        const active = new pmtilesModule.Protocol()
        maplibregl.addProtocol("pmtiles", active.tile as never)
        await import("maplibre-gl/dist/maplibre-gl.css")
        if (cancelled || !containerRef.current) {
          maplibregl.removeProtocol("pmtiles")
          return
        }
        const start =
          initialLat != null && initialLng != null
            ? { lat: initialLat, lng: initialLng }
            : communityCenter()
        map = new maplibregl.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              offline: {
                type: "raster",
                tiles: [
                  `pmtiles://${OFFLINE_MAP_ARCHIVE_URL}/{z}/{x}/{y}`,
                ],
                tileSize: 256,
                minzoom: 10,
                maxzoom: 16,
                attribution:
                  "© OpenStreetMap contributors © CARTO",
              },
            },
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#e8f5f0" },
              },
              {
                id: "offline",
                type: "raster",
                source: "offline",
                paint: { "raster-fade-duration": 0 },
              },
            ],
          },
          center: [start.lng, start.lat],
          zoom: initialLat != null && initialLng != null ? 16 : 15,
          attributionControl: false,
          dragRotate: false,
          touchPitch: false,
          refreshExpiredTiles: false,
          maxBounds: [
            [120.9, 14.5],
            [121.3, 14.8],
          ],
        })
        map.on("move", () => {
          if (!map) return
          const size = map.getCanvasContainer().getBoundingClientRect()
          if (!size.width || !size.height) return
          const center = map.unproject([
            size.width / 2,
            size.height / 2 - PIN_OFFSET_Y,
          ])
          setOutOfScope(
            !insideCoverage(center.lat, center.lng, coverageRef.current)
          )
        })
        map.on("moveend", () => {
          if (!map) return
          const size = map.getCanvasContainer().getBoundingClientRect()
          if (!size.width || !size.height) return
          const center = map.unproject([
            size.width / 2,
            size.height / 2 - PIN_OFFSET_Y,
          ])
          resolvePinRef.current(center.lat, center.lng)
        })
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error("offline map timed out")),
            9000
          )
          map!.once("load", () => {
            window.clearTimeout(timer)
            resolve()
          })
          map!.once("error", () => {
            window.clearTimeout(timer)
            reject(new Error("offline map failed to load"))
          })
        })
        if (cancelled) {
          map.remove()
          maplibregl.removeProtocol("pmtiles")
          return
        }
        mapRef.current = map
        const outline = coverageRef.current.boundary as
          | GeoJsonPolygon
          | null
          | undefined
        if (
          (initialLat == null || initialLng == null) &&
          outline &&
          (outline.type === "Polygon" || outline.type === "MultiPolygon")
        ) {
          try {
            const rings =
              outline.type === "Polygon"
                ? [outline.coordinates[0] ?? []]
                : outline.coordinates.map((part) => part[0] ?? [])
            const points = rings.flat().filter((p) => p.length >= 2)
            const lngs = points.map((p) => p[0]!)
            const lats = points.map((p) => p[1]!)
            map.fitBounds(
              [
                [Math.min(...lngs), Math.min(...lats)],
                [Math.max(...lngs), Math.max(...lats)],
              ],
              { padding: 28, maxZoom: 16, animate: false }
            )
          } catch {
            // The saved center above remains the fallback view.
          }
        }
        const box = map.getCanvasContainer().getBoundingClientRect()
        if (box.width && box.height) {
          const center = map.unproject([
            box.width / 2,
            box.height / 2 - PIN_OFFSET_Y,
          ])
          resolvePinRef.current(center.lat, center.lng)
        }
      } catch {
        try {
          map?.remove()
        } catch {
          // The container is already gone.
        }
        if (maplibregl) {
          try {
            maplibregl.removeProtocol("pmtiles")
          } catch {
            // Protocol was never registered.
          }
        }
        if (!cancelled) onFallbackRef.current()
      }
    }

    void init()
    return () => {
      cancelled = true
      try {
        mapRef.current?.remove()
      } catch {
        // MapLibre tolerates double removal poorly; stay quiet.
      } finally {
        mapRef.current = null
      }
    }
  }, [initialLat, initialLng, resolvePin])

  function recenter() {
    const map = mapRef.current
    if (!map) return
    const outline = coverageRef.current.boundary as
      | GeoJsonPolygon
      | null
      | undefined
    try {
      if (outline && outline.coordinates?.length) {
        const rings =
          outline.type === "Polygon"
            ? [outline.coordinates[0] ?? []]
            : (outline.coordinates as number[][][][]).map(
                (part) => part[0] ?? []
              )
        const points = rings.flat().filter((p) => p.length >= 2)
        const lngs = points.map((p) => p[0]!)
        const lats = points.map((p) => p[1]!)
        map.fitBounds(
          [
            [Math.min(...lngs), Math.min(...lats)],
            [Math.max(...lngs), Math.max(...lats)],
          ],
          { padding: 18, maxZoom: 16 }
        )
        return
      }
    } catch {
      // Fall through to the saved center below.
    }
    const center = communityCenter()
    map.easeTo({ center: [center.lng, center.lat], zoom: 15 })
  }

  function locate() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        sourceRef.current = "gps"
        const target = map.project([
          position.coords.longitude,
          position.coords.latitude,
        ])
        const center = map.unproject([target.x, target.y + PIN_OFFSET_Y])
        map.easeTo({ center, zoom: 16 })
        resolvePinRef.current(
          position.coords.latitude,
          position.coords.longitude
        )
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function confirm() {
    const current = pinRef.current
    if (!current || outOfScope) return
    const parts = addressRef.current
    onConfirmRef.current({
      lat: current.lat,
      lng: current.lng,
      address: parts.full,
      addressPrimary: parts.primary,
      addressSecondary: parts.secondary,
      source: sourceRef.current === "gps" ? "gps" : "manual_pin",
      zone: undefined,
      warning: null,
    })
  }

  return (
    <div
      className={cn(
        "relative isolate flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#e8f5f0]",
        className
      )}
    >
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="pointer-events-none absolute inset-0 z-20 flex min-w-0 flex-col items-end gap-2 px-3 pt-3 pb-24">
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
          >
            <LocateFixedIcon
              className="size-5"
              strokeWidth={1.8}
              aria-hidden
            />
          </MapStackButton>
        </MapControlStack>
      </div>
      {!outOfScope ? (
        <span
          className="eboses-pin-pulse absolute left-1/2 z-30 size-3 rounded-full bg-neutral-900"
          style={{
            top: `calc(50% - ${PIN_OFFSET_Y}px)`,
            marginLeft: -6,
            marginTop: -6,
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
          }}
        />
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-4">
        {outOfScope ? (
          <p
            role="status"
            className="pointer-events-none flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
          >
            <span className="text-[15px] leading-none font-semibold text-neutral-900">
              {OUT_OF_SCOPE_MESSAGE}
            </span>
            <span className="mt-1.5 text-[13px] leading-snug font-medium text-neutral-500">
              Drag the pin within the barangay only.
            </span>
          </p>
        ) : (
          <button
            type="button"
            onClick={confirm}
            className="pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform hover:scale-[1.02] active:scale-[0.99]"
          >
            <span className="text-[16px] leading-none font-semibold text-neutral-900">
              Use this location
            </span>
            <span className="mt-1.5 line-clamp-2 text-[14px] leading-snug font-medium text-neutral-500">
              {address.primary}
            </span>
          </button>
        )}
      </div>
      <div className="pointer-events-none absolute right-2 bottom-1 z-20 flex items-center gap-1.5">
        <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
          Offline map · © OpenStreetMap © CARTO
        </span>
      </div>
    </div>
  )
}
