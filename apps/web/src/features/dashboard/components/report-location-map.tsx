"use client"

import { useEffect, useRef, useState } from "react"
import { MapPinIcon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"
import { reverseGeocodeToMarikinaStreet } from "@/features/auth/lib/reverse-geocode"
import { reverseGeocode, searchGeocode } from "@/lib/geocode"
import {
  concernMarkerHtml,
  concernMarkerSize,
} from "@/features/dashboard/components/map/concern-marker"

type ReportLocationMapProps = {
  latitude: number | string | null | undefined
  longitude: number | string | null | undefined
  streetAddress?: string | null
  category?: string
  iconKey?: string
  status?: string
  className?: string
  heightClassName?: string
}

/** Values that are not a real street line for residents. */
function looksLikeCoordOrPlaceholder(value?: string | null) {
  if (!value?.trim()) return true
  const v = value.trim().toLowerCase()
  if (v === "pending") return true
  if (v === "marikina heights" || v === "marikina" || v === "marikina city") return true
  if (v === "pinned location" || v === "selected location" || v === "street unavailable") return true
  if (/^lat\b/.test(v) || /\blng\b/.test(v)) return true
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)) return true
  return false
}

function isUsableReportAddress(value?: string | null) {
  return !looksLikeCoordOrPlaceholder(value)
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

type NamedRoad = { name: string; lat: number; lng: number; distance: number }

/**
 * When the exact pin sits on an unnamed residential way, find the nearest
 * named highway within ~150m (Overpass) so the label matches map labels.
 */
async function nearestNamedRoads(lat: number, lng: number, radiusM = 150): Promise<NamedRoad[]> {
  const query = `
    [out:json][timeout:12];
    way["highway"]["name"](around:${radiusM},${lat},${lng});
    out tags center 20;
  `
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      elements?: Array<{
        tags?: { name?: string }
        center?: { lat: number; lon: number }
        lat?: number
        lon?: number
      }>
    }
    const roads: NamedRoad[] = []
    for (const el of data.elements ?? []) {
      const name = el.tags?.name?.trim()
      if (!name) continue
      const rLat = el.center?.lat ?? el.lat
      const rLng = el.center?.lon ?? el.lon
      if (rLat == null || rLng == null) continue
      roads.push({
        name,
        lat: rLat,
        lng: rLng,
        distance: haversineMeters(lat, lng, rLat, rLng),
      })
    }
    roads.sort((a, b) => a.distance - b.distance)
    return roads
  } catch {
    return []
  }
}

/**
 * Resolve street from report lat/lng (same pin the user set).
 * Not random — reverse geocode + nearest named road when OSM way is unnamed.
 */
async function reverseGeocodeStreet(lat: number, lng: number): Promise<string> {
  // 1) Curated reverse match (road field only — admin labels no longer false-match)
  try {
    const matched = await reverseGeocodeToMarikinaStreet(lat, lng)
    if (matched.ok && matched.street) {
      if (matched.houseNumber) return `${matched.houseNumber} ${matched.street}`
      return matched.street
    }
  } catch {
    /* continue */
  }

  // 2) Nominatim road / house on this exact point
  let nominatimRoad: string | undefined
  let house: string | undefined
  try {
    const data = await reverseGeocode(lat, lng)
    if (data) {
      const a = data.address ?? {}
      house = a.house_number?.trim() || ""
      nominatimRoad = (
        data.name ||
        a.road ||
        a.pedestrian ||
        a.path ||
        a.residential ||
        ""
      ).trim()
      if (nominatimRoad) {
        const curated = matchMarikinaHeightsStreet(nominatimRoad)
        const label = curated || nominatimRoad
        return house ? `${house} ${label}` : label
      }
    }
  } catch {
    /* continue */
  }

  // 3) Nearest named OSM roads around the pin (fixes unnamed residential ways)
  const nearby = await nearestNamedRoads(lat, lng, 150)
  for (const road of nearby) {
    const curated = matchMarikinaHeightsStreet(road.name)
    if (curated) return curated
  }
  if (nearby[0]?.name) return nearby[0].name

  return "Street unavailable"
}

/** Street line from DB address (first segment before comma). */
function streetFromStoredAddress(address?: string | null) {
  if (!isUsableReportAddress(address)) return null
  return address!.split(",")[0]?.trim() || address!.trim()
}

/**
 * Prefer the street saved on the concern row at submit time.
 * External reverse-geocode runs only for legacy rows that stored Lat/Lng or Pending.
 */
function useReportStreetAddress(opts: {
  address?: string | null
  barangay?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
}) {
  const lat = Number(opts.latitude)
  const lng = Number(opts.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const fromDb = streetFromStoredAddress(opts.address)

  const [street, setStreet] = useState(() => {
    if (fromDb) return fromDb
    return hasCoords ? "Finding street…" : "No address on file"
  })

  // Adjust state when the address/coordinates change (render-adjust pattern
  // instead of a sync setState inside an effect): the async geocode resolution
  // below is the only code that runs in an effect.
  const [prevInput, setPrevInput] = useState({ fromDb, hasCoords })
  if (prevInput.fromDb !== fromDb || prevInput.hasCoords !== hasCoords) {
    setPrevInput({ fromDb, hasCoords })
    if (fromDb) setStreet(fromDb)
    else if (hasCoords) setStreet("Finding street…")
    else setStreet("No address on file")
  }

  useEffect(() => {
    // Source of truth: address column saved with the report (no network).
    if (fromDb || !hasCoords) return
    let cancelled = false
    void reverseGeocodeStreet(lat, lng).then((line) => {
      if (!cancelled) setStreet(line)
    })
    return () => {
      cancelled = true
    }
  }, [fromDb, hasCoords, lat, lng])

  return street
}

export function ReportLocationMap({
  latitude,
  longitude,
  streetAddress,
  category,
  iconKey,
  status,
  className,
  heightClassName = "h-52 sm:h-56",
}: ReportLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const coverageRef = useRef<leaflet.LayerGroup | null>(null)

  const rawLat = Number(latitude)
  const rawLng = Number(longitude)
  const hasPinnedCoords = Number.isFinite(rawLat) && Number.isFinite(rawLng)

  // No pin on file — resolve the stored address into approximate coordinates
  // so the card still shows a map instead of a dead end.
  const [geocoded, setGeocoded] = useState<{ address: string; lat: number; lng: number } | null>(null)
  const resolvedGeocoded = geocoded?.address === streetAddress ? geocoded : null
  useEffect(() => {
    if (hasPinnedCoords || !streetAddress) return
    let cancelled = false
    searchGeocode(streetAddress, 1).then((rows) => {
      if (cancelled) return
      const first = rows[0]
      const lat = Number(first?.lat)
      const lng = Number(first?.lon)
      setGeocoded(
        Number.isFinite(lat) && Number.isFinite(lng)
          ? { address: streetAddress, lat, lng }
          : null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [hasPinnedCoords, streetAddress])

  const lat = hasPinnedCoords ? rawLat : (resolvedGeocoded?.lat ?? NaN)
  const lng = hasPinnedCoords ? rawLng : (resolvedGeocoded?.lng ?? NaN)
  const valid = Number.isFinite(lat) && Number.isFinite(lng)

  useEffect(() => {
    if (!valid || !containerRef.current) return

    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      const el = containerRef.current as HTMLDivElement & { _leaflet_id?: number }
      if (el._leaflet_id) {
        try {
          mapRef.current?.remove()
        } catch {
          /* already torn down */
        }
        el._leaflet_id = undefined
      }

      map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 18,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      })

      addBaseTiles(L, map, "light", {
        maxZoom: 19,
        className: "eboses-report-map-tiles",
      })

      const pinSelected = true
      const pinSize = concernMarkerSize(pinSelected)

      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "eboses-report-pin",
          html: `<div style="position:relative;width:${pinSize}px;height:${pinSize}px">${concernMarkerHtml(
            {
              category: category ?? "other",
              iconKey,
              status: status ?? "",
              selected: pinSelected,
            },
          )}</div>`,
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        interactive: true,
        zIndexOffset: 900,
      }).addTo(map)

      const centerView = () => {
        map?.setView([lat, lng], 18, { animate: false })
      }

      // Boundary overlay hidden for cleaner report detail view

      mapRef.current = map
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = new ResizeObserver(() => {
        if (!mapRef.current) return
        requestAnimationFrame(() => {
          if (!mapRef.current) return
          mapRef.current.invalidateSize()
          centerView()
        })
      })
      resizeObserverRef.current.observe(containerRef.current)
      requestAnimationFrame(() => {
        map?.invalidateSize()
        centerView()
      })
      window.setTimeout(() => {
        if (!mapRef.current) return
        mapRef.current.invalidateSize()
        centerView()
      }, 150)
    }

    void init()

    return () => {
      cancelled = true
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      coverageRef.current = null
      try {
        map?.off()
        map?.remove()
      } catch {
        /* ignore */
      }
      mapRef.current = null
    }
  }, [lat, lng, valid, iconKey, category, status])

  if (!valid) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[16px] bg-neutral-100 text-[13px] text-neutral-400",
          heightClassName,
          className,
        )}
      >
        No map location
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl bg-tint",
        heightClassName,
        className,
      )}
    >
      <div ref={containerRef} className="eboses-report-map pointer-events-none absolute inset-0 z-0 h-full w-full" />
      <style>{`
        .eboses-report-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8eef5;
          font: inherit;
        }
        .eboses-report-map .leaflet-control-zoom {
          border: 1px solid #e5e7eb !important;
          border-radius: 10px !important;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.1);
        }
        .eboses-report-map .leaflet-control-zoom a {
          width: 30px !important;
          height: 30px !important;
          line-height: 30px !important;
          color: #171717 !important;
          background: #fff !important;
        }
        .eboses-report-map img.leaflet-tile,
        .eboses-report-map .leaflet-tile {
          max-width: none !important;
        }
        /* Soften the faint seam every tile leaves behind and blend tile edges
           into the card so the map reads as one continuous surface. */
        .eboses-report-map .leaflet-tile-pane {
          filter: saturate(0.85);
        }
        .eboses-report-map .leaflet-tile {
          outline: none;
          transition: filter 150ms ease;
        }
        .eboses-report-pin {
          background: transparent !important;
          border: none !important;
        }
        /* Soft tint disc + solid glyph colour — matches the alerts map */
        .eboses-report-map .eboses-pin__disc {
          background: color-mix(in srgb, var(--pin) 16%, white) !important;
          color: var(--pin) !important;
          border: 2px solid #fff !important;
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15) !important;
        }
        .eboses-report-map .eboses-pin__disc svg {
          display: block;
        }
        .eboses-report-map .eboses-pin__core {
          border: none !important;
        }
      `}</style>
    </div>
  )
}

/** Address chip — GPS pin icon + street name only (no subtext). */
export function ReportLocationAddress({
  address,
  barangay,
  latitude,
  longitude,
}: {
  address?: string | null
  barangay?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
}) {
  const street = useReportStreetAddress({ address, barangay, latitude, longitude })

  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3.5 py-3">
      <MapPinIcon className="size-6 shrink-0 text-neutral-500" />
      <p className="min-w-0 truncate text-[15px] font-medium leading-snug text-neutral-900">
        {street}
      </p>
    </div>
  )
}



