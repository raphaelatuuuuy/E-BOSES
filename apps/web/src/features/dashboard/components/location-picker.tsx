"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MapPinIcon, SearchIcon, XIcon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"

const NOMINATIM_HEADERS = {
  Accept: "application/json",
  // Nominatim usage policy requires a valid identifying User-Agent
  "User-Agent": "E-Boses/1.0 (barangay-concern-reports)",
}

const DEFAULT_CENTER: [number, number] = [14.6515, 121.1207]

export type LocationConfirmPayload = {
  lat: number
  lng: number
  /** Full single-line address (for API / drafts) */
  address: string
  /** Primary line e.g. street */
  addressPrimary: string
  /** Secondary line e.g. barangay, city */
  addressSecondary: string
  source: "gps" | "manual_pin"
}

interface LocationPickerModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (payload: LocationConfirmPayload) => void
  initialLat?: number | null
  initialLng?: number | null
  initialAddress?: string
}

type AddressParts = { primary: string; secondary: string; full: string }

function formatNominatimParts(data: {
  address?: Record<string, string>
  display_name?: string
}): AddressParts {
  const a = data.address ?? {}
  const house = a.house_number
  const road = a.road || a.pedestrian || a.path || a.residential
  const primary =
    house && road
      ? `${house} ${road}`
      : road ||
        a.neighbourhood ||
        a.suburb ||
        a.village ||
        a.town ||
        a.city ||
        (data.display_name ?? "").split(",")[0]?.trim() ||
        "Selected location"

  const secondaryBits = [
    a.suburb || a.neighbourhood || a.village,
    a.city || a.town || a.municipality || a.city_district,
    a.state,
  ].filter(Boolean) as string[]
  // Prefer "Barangay, City" style without duplicating primary
  const secondary = secondaryBits
    .filter((part, i, arr) => part !== primary && arr.indexOf(part) === i)
    .slice(0, 2)
    .join(", ")

  const full = secondary ? `${primary}, ${secondary}` : primary
  return { primary, secondary, full }
}

async function reverseGeocode(lat: number, lng: number): Promise<AddressParts> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const res = await fetch(url, { headers: NOMINATIM_HEADERS })
    if (!res.ok) throw new Error("reverse failed")
    const data = (await res.json()) as {
      address?: Record<string, string>
      display_name?: string
    }
    return formatNominatimParts(data)
  } catch {
    const fallback = `Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)}`
    return { primary: fallback, secondary: "", full: fallback }
  }
}

async function searchPlaces(query: string): Promise<
  Array<{ lat: number; lng: number; label: string; parts: AddressParts }>
> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=ph&viewbox=121.08,14.68,121.16,14.62&bounded=0`
    const res = await fetch(url, { headers: NOMINATIM_HEADERS })
    if (!res.ok) return []
    const data = (await res.json()) as Array<{
      lat: string
      lon: string
      display_name: string
      address?: Record<string, string>
    }>
    return data.map((item) => {
      const parts = formatNominatimParts(item)
      return {
        lat: Number(item.lat),
        lng: Number(item.lon),
        label: parts.full,
        parts,
      }
    })
  } catch {
    return []
  }
}

export default function LocationPickerModal({
  open,
  onClose,
  onConfirm,
  initialLat,
  initialLng,
  initialAddress = "",
}: LocationPickerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const reverseTimer = useRef<number | null>(null)
  const ignoreMove = useRef(false)

  const [previewParts, setPreviewParts] = useState<AddressParts>({
    primary: initialAddress || "Move the map to adjust",
    secondary: "",
    full: initialAddress || "Move the map to adjust",
  })
  const [previewLatLng, setPreviewLatLng] = useState<{ lat: number; lng: number } | null>(
    initialLat != null && initialLng != null ? { lat: initialLat, lng: initialLng } : null,
  )
  const [geocoding, setGeocoding] = useState(false)
  const [search, setSearch] = useState("")
  const [results, setResults] = useState<
    Array<{ lat: number; lng: number; label: string; parts: AddressParts }>
  >([])
  const [searching, setSearching] = useState(false)

  const scheduleReverse = useCallback((lat: number, lng: number) => {
    setPreviewLatLng({ lat, lng })
    if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
    reverseTimer.current = window.setTimeout(() => {
      setGeocoding(true)
      void reverseGeocode(lat, lng).then((parts) => {
        setPreviewParts(parts)
        setGeocoding(false)
      })
    }, 350)
  }, [])

  // Init / destroy map when open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      LRef.current = L

      const center: [number, number] =
        initialLat != null && initialLng != null ? [initialLat, initialLng] : DEFAULT_CENTER

      map = L.map(containerRef.current, {
        center,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
      })
      L.control.zoom({ position: "topright" }).addTo(map)

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map)

      // Optional barangay boundary
      fetch(
        "https://nominatim.openstreetmap.org/lookup?osm_ids=R371327&format=json&polygon_geojson=1",
        { headers: NOMINATIM_HEADERS },
      )
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data?.[0]?.geojson || !map) return
          L.geoJSON(data[0].geojson, {
            style: { color: "#ff6a1a", weight: 2, fillOpacity: 0.06, opacity: 0.65 },
          }).addTo(map)
        })
        .catch(() => {})

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        const c = map.getCenter()
        scheduleReverse(c.lat, c.lng)
      })

      mapRef.current = map
      requestAnimationFrame(() => {
        map?.invalidateSize()
        const c = map?.getCenter()
        if (c) scheduleReverse(c.lat, c.lng)
      })
    }

    void init()

    return () => {
      cancelled = true
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      map?.remove()
      mapRef.current = null
    }
  }, [open, initialLat, initialLng, scheduleReverse])

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (search.trim().length < 2) {
      setResults([])
      return
    }
    const t = window.setTimeout(() => {
      setSearching(true)
      void searchPlaces(search).then((items) => {
        setResults(items)
        setSearching(false)
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [search, open])

  function flyTo(lat: number, lng: number, parts?: AddressParts) {
    const map = mapRef.current
    if (!map) return
    ignoreMove.current = true
    map.setView([lat, lng], 17)
    setPreviewLatLng({ lat, lng })
    if (parts) setPreviewParts(parts)
    else scheduleReverse(lat, lng)
    window.setTimeout(() => {
      ignoreMove.current = false
    }, 500)
  }

  function handleConfirm() {
    const map = mapRef.current
    const center = map?.getCenter()
    const lat = previewLatLng?.lat ?? center?.lat
    const lng = previewLatLng?.lng ?? center?.lng
    if (lat == null || lng == null) return
    onConfirm({
      lat,
      lng,
      address: previewParts.full,
      addressPrimary: previewParts.primary,
      addressSecondary: previewParts.secondary,
      source: "manual_pin",
    })
    onClose()
  }

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl",
          "h-[min(640px,92vh)]",
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          <h2 className="text-[17px] font-semibold text-neutral-900">Move map to pin location</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        {/* Map + floating pin + callout */}
        <div className="relative min-h-0 flex-1">
          <div ref={containerRef} className="absolute inset-0 z-0" />

          {/* Fixed center pin */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
            <MapPinIcon className="size-10 fill-[#ff6a1a] text-[#ff6a1a] drop-shadow-md" strokeWidth={1.5} />
            <span className="absolute bottom-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-[#2447b3] ring-2 ring-white" />
          </div>

          {/* Use this location pill */}
          <div className="pointer-events-none absolute inset-x-0 top-[42%] z-[500] flex justify-center px-4">
            <button
              type="button"
              onClick={handleConfirm}
              className="pointer-events-auto flex max-w-[min(100%,320px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-center shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.99]"
            >
              <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-neutral-900">
                <MapPinIcon className="size-3.5 text-neutral-700" />
                Use this location
              </span>
              <span className="mt-0.5 line-clamp-2 text-[12px] font-medium text-neutral-500">
                {geocoding
                  ? "Finding address…"
                  : previewParts.secondary
                    ? `${previewParts.primary} · ${previewParts.secondary}`
                    : previewParts.primary}
              </span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative shrink-0 border-t border-neutral-100 bg-white p-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="h-11 w-full rounded-full border border-neutral-200 bg-neutral-50 pl-10 pr-4 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-300 focus:bg-white focus:ring-2 focus:ring-neutral-100"
            />
          </div>
          {results.length > 0 || searching ? (
            <ul className="absolute inset-x-3 bottom-full z-[600] mb-1 max-h-40 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              {searching ? (
                <li className="px-3 py-2 text-[13px] text-neutral-500">Searching…</li>
              ) : (
                results.map((item) => (
                  <li key={`${item.lat}-${item.lng}-${item.label}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] text-neutral-800 hover:bg-neutral-50"
                      onClick={() => {
                        setSearch(item.label)
                        setResults([])
                        flyTo(item.lat, item.lng, item.parts)
                      }}
                    >
                      <MapPinIcon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
                      <span className="line-clamp-2">{item.label}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
