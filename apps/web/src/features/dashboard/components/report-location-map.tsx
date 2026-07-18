"use client"

import { useEffect, useRef, useState } from "react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"
import { reverseGeocodeToMarikinaStreet } from "@/features/auth/lib/reverse-geocode"

type ReportLocationMapProps = {
  latitude: number | string | null | undefined
  longitude: number | string | null | undefined
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

export function isUsableReportAddress(value?: string | null) {
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
  let nominatimRoad = ""
  let house = ""
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=18`
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "E-Boses/1.0 (barangay-concern-reports)",
      },
    })
    if (res.ok) {
      const data = (await res.json()) as {
        name?: string
        address?: Record<string, string>
      }
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
export function streetFromStoredAddress(address?: string | null) {
  if (!isUsableReportAddress(address)) return null
  return address!.split(",")[0]?.trim() || address!.trim()
}

/**
 * Prefer the street saved on the concern row at submit time.
 * External reverse-geocode runs only for legacy rows that stored Lat/Lng or Pending.
 */
export function useReportStreetAddress(opts: {
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

  useEffect(() => {
    // Source of truth: address column saved with the report (no network).
    if (fromDb) {
      setStreet(fromDb)
      return
    }
    // Legacy / bad data only — backfill label from pin once.
    if (!hasCoords) {
      setStreet("No address on file")
      return
    }
    let cancelled = false
    setStreet("Finding street…")
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
  className,
  heightClassName = "h-52 sm:h-56",
}: ReportLocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)

  const lat = Number(latitude)
  const lng = Number(longitude)
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
        zoom: 17,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
        doubleClickZoom: true,
        boxZoom: false,
        keyboard: false,
      })
      L.control.zoom({ position: "topright" }).addTo(map)

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
        className: "eboses-report-map-tiles",
      }).addTo(map)

      const pinIcon = L.divIcon({
        className: "eboses-report-pin",
        html: `
          <div style="position:relative;width:18px;height:18px;margin-left:-9px;margin-top:-9px;">
            <span style="
              position:absolute;inset:0;border-radius:999px;
              background:rgba(43,127,255,.22);
            "></span>
            <span style="
              position:absolute;left:50%;top:50%;width:12px;height:12px;
              margin-left:-6px;margin-top:-6px;border-radius:999px;
              background:#2b7fff;border:2.5px solid #fff;
              box-shadow:0 2px 8px rgba(37,99,235,.45);
            "></span>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })

      L.marker([lat, lng], { icon: pinIcon, interactive: false }).addTo(map)

      mapRef.current = map
      requestAnimationFrame(() => {
        map?.invalidateSize()
        map?.setView([lat, lng], 17, { animate: false })
      })
    }

    void init()

    return () => {
      cancelled = true
      try {
        map?.off()
        map?.remove()
      } catch {
        /* ignore */
      }
      mapRef.current = null
    }
  }, [lat, lng, valid])

  if (!valid) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 text-[14px] text-neutral-500",
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
        "relative overflow-hidden rounded-xl border border-neutral-200 bg-[#e8eef5]",
        heightClassName,
        className,
      )}
    >
      <div ref={containerRef} className="eboses-report-map absolute inset-0 z-0 h-full w-full" />
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
        .eboses-report-pin {
          background: transparent !important;
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
      <img
        src="/contents/map-pin-gps.png"
        alt=""
        className="size-6 shrink-0 object-contain"
        aria-hidden
      />
      <p className="min-w-0 truncate text-[15px] font-medium leading-snug text-neutral-900">
        {street}
      </p>
    </div>
  )
}
