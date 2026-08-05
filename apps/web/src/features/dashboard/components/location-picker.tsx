"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SearchIcon, XIcon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { reverseGeocode } from "@/lib/geocode"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

export type LocationConfirmPayload = {
  lat: number
  lng: number
  address: string
  addressPrimary: string
  addressSecondary: string
  source: "gps" | "manual_pin"
  zone?: string
  warning?: string | null
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

type MapContext = {
  center: { latitude: number; longitude: number; zoom: number }
  bounds: {
    min_latitude: number
    max_latitude: number
    min_longitude: number
    max_longitude: number
  }
  boundary: { name: string; geometry: unknown }
  soft_buffer_meters: number
  hard_reject_meters: number
}

type LocationClass = {
  status: "inside" | "edge" | "far"
  zone: string
  accepted: boolean
  warning: string | null
  message: string
  distance_meters: number | null
}

type SearchHit = {
  lat: number
  lng: number
  label: string
  primary: string
  secondary: string
  zone?: string
  accepted?: boolean
}

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
  ].filter(Boolean) as string[]
  const secondary = secondaryBits
    .filter((part, i, arr) => part !== primary && arr.indexOf(part) === i)
    .slice(0, 2)
    .join(", ")

  return {
    primary,
    secondary,
    full: secondary ? `${primary}, ${secondary}` : primary,
  }
}

/**
 * Reverse-geocode a pin into display-ready address parts.
 *
 * Named apart from the imported `reverseGeocode` deliberately: this used to
 * share that name, which meant the local declaration shadowed the import and
 * the function called *itself* — infinite recursion that only ever exited
 * through the catch below, so every pin silently resolved to "Finding street…".
 */
async function reverseGeocodeParts(lat: number, lng: number): Promise<AddressParts> {
  const data = await reverseGeocode(lat, lng)
  // The helper already swallows network and rate-limit failures into null. Do
  // not persist Lat/Lng as a fake street — keep the UI empty until a lookup
  // works.
  if (!data) return { primary: "Finding street…", secondary: "Marikina Heights", full: "" }
  return formatNominatimParts(data)
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
  const reverseTimer = useRef<number | null>(null)
  const ignoreMove = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

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
  const [results, setResults] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [mapContext, setMapContext] = useState<MapContext | null>(null)
  const [locationClass, setLocationClass] = useState<LocationClass | null>(null)

  const scheduleReverseAndValidate = useCallback((lat: number, lng: number) => {
    setPreviewLatLng({ lat, lng })
    if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
    reverseTimer.current = window.setTimeout(() => {
      setGeocoding(true)
      void Promise.all([
        reverseGeocodeParts(lat, lng),
        apiRequest<LocationClass>("/locations/validate/", {
          method: "POST",
          body: JSON.stringify({ latitude: lat, longitude: lng }),
        }).catch(
          () =>
            ({
              status: "inside",
              zone: "unknown",
              accepted: true,
              warning: null,
              message: "",
              distance_meters: null,
            }) as LocationClass,
        ),
      ]).then(([parts, classification]) => {
        setPreviewParts(parts)
        setLocationClass(classification)
        setGeocoding(false)
      })
    }, 350)
  }, [])

  // Load map context
  useEffect(() => {
    if (!open) return
    void apiRequest<MapContext>("/locations/map-context/")
      .then(setMapContext)
      .catch(() => setMapContext(null))
  }, [open])

  // Init map
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      const center: [number, number] =
        initialLat != null && initialLng != null
          ? [initialLat, initialLng]
          : mapContext
            ? [mapContext.center.latitude, mapContext.center.longitude]
            : DEFAULT_CENTER

      map = L.map(containerRef.current, {
        center,
        zoom: mapContext?.center.zoom ?? 15,
        zoomControl: false,
        attributionControl: false,
      })
      L.control.zoom({ position: "topright" }).addTo(map)
      containerRef.current.querySelector(".leaflet-control-zoom")?.classList.add("eboses-map-zoom")

      // Clean Carto light basemap (sign-up style — not busy)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map)

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        const c = map.getCenter()
        scheduleReverseAndValidate(c.lat, c.lng)
      })

      mapRef.current = map
      requestAnimationFrame(() => {
        map?.invalidateSize()
        const c = map?.getCenter()
        if (c) scheduleReverseAndValidate(c.lat, c.lng)
      })
    }

    void init()

    return () => {
      cancelled = true
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      try {
        map?.off()
        map?.remove()
      } catch {
        /* Leaflet may already have detached panes during portal close */
      }
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once per open
  }, [open, scheduleReverseAndValidate])

  // Draw barangay boundary when context loads (no service/POI markers)
  useEffect(() => {
    const map = mapRef.current
    if (!open || !map || !mapContext) return
    void import("leaflet").then((L) => {
      const geometry = mapContext.boundary?.geometry as leaflet.GeoJSON | null
      if (geometry) {
        L.geoJSON(geometry as never, {
          style: {
            color: "#ff6a1a",
            weight: 2,
            fillColor: "#ff6a1a",
            fillOpacity: 0.04,
            opacity: 0.75,
          },
        }).addTo(map)
        try {
          map.fitBounds(L.geoJSON(geometry as never).getBounds(), {
            padding: [28, 28],
            maxZoom: 16,
          })
        } catch {
          /* ignore */
        }
      }
    })
  }, [open, mapContext])

  // Debounced API search
  useEffect(() => {
    if (!open) return
    if (search.trim().length < 2) {
      setResults([])
      return
    }
    const t = window.setTimeout(() => {
      setSearching(true)
      void apiRequest<{ results: SearchHit[] }>(
        `/locations/search/?q=${encodeURIComponent(search.trim())}`,
      )
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => window.clearTimeout(t)
  }, [search, open])

  function flyTo(lat: number, lng: number, parts?: AddressParts) {
    const map = mapRef.current
    if (!map) return
    ignoreMove.current = true
    map.setView([lat, lng], 17)
    setPreviewLatLng({ lat, lng })
    if (parts) setPreviewParts(parts)
    scheduleReverseAndValidate(lat, lng)
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
    if (locationClass && !locationClass.accepted) {
      return
    }
    // Require a real street line so Concern.address is saved for later display
    // without reverse-geocoding again on My Reports.
    const primary = (previewParts.primary || "").trim()
    const badPrimary =
      !primary ||
      primary === "Finding street…" ||
      primary === "Selected location" ||
      /^lat\b/i.test(primary) ||
      /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(primary)
    if (badPrimary || geocoding) {
      return
    }
    const secondary = (previewParts.secondary || "Marikina Heights").trim()
    const full = previewParts.full?.trim() || `${primary}, ${secondary}`
    onConfirm({
      lat,
      lng,
      address: full,
      addressPrimary: primary,
      addressSecondary: secondary,
      source: "manual_pin",
      zone: locationClass?.zone,
      warning: locationClass?.warning,
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

  const hasQuery = search.trim().length >= 2
  const sheetMode: "collapsed" | "peek" | "expanded" = !hasQuery
    ? "collapsed"
    : searchFocused
      ? "expanded"
      : "peek"

  const streetPrimary = (previewParts.primary || "").trim()
  const hasUsableStreet =
    Boolean(streetPrimary) &&
    streetPrimary !== "Finding street…" &&
    streetPrimary !== "Selected location" &&
    !/^lat\b/i.test(streetPrimary) &&
    !/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(streetPrimary)
  const canConfirm = (!locationClass || locationClass.accepted) && hasUsableStreet && !geocoding

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6">
      <style>{`
        .eboses-pin-pulse::before,
        .eboses-pin-pulse::after {
          content: "";
          position: absolute;
          inset: 50%;
          width: 12px;
          height: 12px;
          margin: -6px 0 0 -6px;
          border-radius: 9999px;
          background: rgba(43, 127, 255, 0.35);
          animation: eboses-pin-scan 1.8s ease-out infinite;
          pointer-events: none;
        }
        .eboses-pin-pulse::after {
          animation-delay: 0.9s;
          background: rgba(43, 127, 255, 0.22);
        }
        @keyframes eboses-pin-scan {
          0% { transform: scale(1); opacity: 0.7; }
          70% { transform: scale(2.8); opacity: 0; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        .eboses-map-zoom.leaflet-control-zoom {
          border: none !important;
          border-radius: 10px !important;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0,0,0,0.28) !important;
        }
        .eboses-map-zoom .leaflet-control-zoom-in,
        .eboses-map-zoom .leaflet-control-zoom-out {
          width: 36px !important;
          height: 36px !important;
          line-height: 36px !important;
          font-size: 22px !important;
          font-weight: 700 !important;
          color: #18181b !important;
          background: #fff !important;
          border: none !important;
          border-bottom: 1px solid #e4e4e7 !important;
        }
        .eboses-map-zoom .leaflet-control-zoom-out { border-bottom: none !important; }
        .eboses-map-zoom a:hover { background: #f4f4f5 !important; color: #000 !important; }
        .eboses-map-search-expanded .leaflet-control-zoom {
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `}</style>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={cn(
          "relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl",
          "h-[min(640px,92vh)]",
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          <h2 className="text-[17px] font-semibold text-neutral-900">Move map to pin location</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100"
            aria-label="Close"
          >
            <XIcon className="size-5" strokeWidth={2} />
          </button>
        </div>

        <div
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden",
            sheetMode === "expanded" && "eboses-map-search-expanded",
          )}
        >
          <div ref={containerRef} className="absolute inset-0 z-0" />

          {sheetMode !== "expanded" ? (
            <>
              <span
                className="eboses-pin-pulse absolute left-1/2 top-1/2 size-3 rounded-full bg-[#2b7fff]"
                style={{
                  marginLeft: -6,
                  marginTop: -6,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                }}
              />
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-[1100] flex flex-col items-center gap-2 px-4",
                  sheetMode === "peek" ? "top-[calc(50%+24px)]" : "top-[calc(50%+36px)]",
                )}
              >
                {locationClass?.warning ? (
                  <p className="pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-amber-50 px-3 py-2 text-center text-[12px] font-medium text-amber-800 shadow-sm ring-1 ring-amber-200/80">
                    {locationClass.warning}
                  </p>
                ) : null}
                {locationClass && !locationClass.accepted ? (
                  <p className="pointer-events-none max-w-[min(100%,320px)] rounded-xl bg-red-50 px-3 py-2 text-center text-[12px] font-medium text-red-700 shadow-sm ring-1 ring-red-200/80">
                    {locationClass.message}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!canConfirm || geocoding}
                  className={cn(
                    "pointer-events-auto flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-transform",
                    canConfirm
                      ? "hover:scale-[1.02] active:scale-[0.99]"
                      : "cursor-not-allowed opacity-60",
                  )}
                >
                  <span className="text-[16px] font-semibold leading-none text-neutral-900">
                    Use this location
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-[14px] font-medium leading-snug text-neutral-500">
                    {geocoding ? "Finding address…" : previewParts.primary}
                  </span>
                </button>
              </div>
            </>
          ) : null}

          {/* Bottom sheet: slides up from bottom */}
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-[1400] flex h-full flex-col overflow-hidden bg-white",
              "rounded-t-2xl border-t border-neutral-200 shadow-[0_-8px_28px_rgba(0,0,0,0.12)]",
              "transition-transform duration-300 ease-out will-change-transform",
              sheetMode === "expanded" &&
                "translate-y-0 rounded-none border-0 shadow-none",
              sheetMode === "peek" && "translate-y-[calc(100%-100px)]",
              sheetMode === "collapsed" && "translate-y-[calc(100%-72px)]",
            )}
            onClick={() => {
              if (sheetMode === "peek") {
                setSearchFocused(true)
                searchInputRef.current?.focus()
              }
            }}
          >
            <div className="shrink-0 px-4 pb-2 pt-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    window.setTimeout(() => setSearchFocused(false), 180)
                  }}
                  placeholder="Search streets in Marikina Heights"
                  autoComplete="off"
                  className={cn(
                    "h-11 w-full rounded-full border border-neutral-200 bg-white pl-10 pr-4 text-[15px] text-neutral-900 outline-none",
                    "placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
                  )}
                />
              </div>
            </div>

            <ul
              className={cn(
                "min-h-0 flex-1 list-none overflow-y-auto",
                sheetMode === "collapsed" && "hidden",
                sheetMode === "peek" && "pointer-events-none select-none",
              )}
            >
              {searching ? (
                <li className="px-5 py-3 text-[14px] text-neutral-500">Searching…</li>
              ) : results.length === 0 && hasQuery ? (
                <li className="px-5 py-3 text-[14px] text-neutral-500">
                  No places found inside Marikina Heights (or its edge buffer)
                </li>
              ) : (
                results.map((item) => (
                  <li
                    key={`${item.lat}-${item.lng}-${item.label}`}
                    className="border-b border-neutral-100 last:border-b-0"
                  >
                    <button
                      type="button"
                      className="flex w-full flex-col px-5 py-3.5 text-left transition-colors hover:bg-neutral-50 active:bg-neutral-100"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearch("")
                        setResults([])
                        setSearchFocused(false)
                        flyTo(item.lat, item.lng, {
                          primary: item.primary,
                          secondary: item.secondary,
                          full: item.secondary
                            ? `${item.primary}, ${item.secondary}`
                            : item.primary,
                        })
                      }}
                    >
                      <span className="text-[15px] font-semibold text-neutral-900">
                        {item.primary || item.label}
                      </span>
                      {item.secondary ? (
                        <span className="mt-0.5 text-[13px] text-neutral-500">{item.secondary}</span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
