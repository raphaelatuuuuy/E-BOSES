"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  FootprintsIcon,
  HomeIcon,
  LocateFixedIcon,
  SearchIcon,
} from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import {
  formatNominatimParts,
  reverseGeocode,
  type AddressParts,
} from "@/lib/geocode"
import type { MapDispatchPolicy } from "@/features/dashboard/api"
import { GLYPHS, glyphPinHtml, MAP_COLORS } from "@/features/dashboard/components/map/markers"
import { StreetViewModal, type StreetViewCoord, type StreetViewMapPoint } from "@/features/dashboard/components/map/street-view"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"
import {
  drawCoverage,
  insideCoverage,
  OUT_OF_SCOPE_MESSAGE,
  type CoverageInput,
} from "@/features/dashboard/components/map/coverage-layer"
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"

const DEFAULT_CENTER: [number, number] = [14.6507, 121.1133]

// The pin sits this many pixels above the map's true geometric center so the
// "Use this location" pill anchored to the bottom can never cover it.
const PIN_OFFSET_Y = 64

function pinLatLng(map: leaflet.Map): leaflet.LatLng {
  const size = map.getSize()
  return map.containerPointToLatLng([size.x / 2, Math.max(0, size.y / 2 - PIN_OFFSET_Y)])
}

function pinAdjustedCenter(map: leaflet.Map, lat: number, lng: number, zoom: number): leaflet.LatLng {
  const point = map.project([lat, lng], zoom).add([0, PIN_OFFSET_Y])
  return map.unproject(point, zoom)
}

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
  /** When true, render just the map content inline — no portal, overlay, header, or drag handle. */
  renderInline?: boolean
}

type MapContext = {
  center: { latitude: number; longitude: number; zoom: number }
  bounds: {
    min_latitude: number
    max_latitude: number
    min_longitude: number
    max_longitude: number
  }
  boundary: { name: string; geometry: unknown }
  dispatch_policy: MapDispatchPolicy | null
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
  renderInline,
}: LocationPickerModalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const reverseTimer = useRef<number | null>(null)
  const ignoreMove = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)

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
  // Runs on every frame of a pan, so the pin can refuse itself while the map is
  // still moving. The server call behind `locationClass` is debounced and stays
  // the authority; this only drives the cursor and the notice.
  const [outOfScope, setOutOfScope] = useState(false)
  const coverageRef = useRef<CoverageInput>({})
  const coverageLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const [gpsFix, setGpsFix] = useState<{ lat: number; lng: number } | null>(null)
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)
  const [svPicking, setSvPicking] = useState(false)

  // Bottom sheet for mobile
  const locSheet = useBottomSheetSnap({
    enabled: open,
    initialMode: "expanded",
    onSettle: () => {
      if (locSheet.mode === "hidden") onClose()
    },
  })

  useEffect(() => {
    if (open) locSheet.snapTo("expanded")
  }, [open])

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
    let styleEl: HTMLStyleElement | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      containerRef.current.classList.add("eboses-location-picker-map")

      // Same fix as the AreaPicker/pin maps: the tile-size override has to
      // exist in <head> before Leaflet lays out its tile pane, or the 256px
      // tiles collapse under Tailwind Preflight's `img { max-width: 100% }`
      // and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-location-picker-map.leaflet-container {
          width: 100%;
          height: 100%;
          font-family: inherit;
        }
        .eboses-location-picker-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-location-picker-map img.leaflet-tile,
        .eboses-location-picker-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
      `
      document.head.appendChild(styleEl)

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

      // Clean Carto light basemap (sign-up style — not busy)
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map)

      coverageLayerRef.current = L.layerGroup().addTo(map)

      map.on("move", () => {
        if (!map) return
        const c = pinLatLng(map)
        setOutOfScope(!insideCoverage(c.lat, c.lng, coverageRef.current))
      })

      map.on("moveend", () => {
        if (ignoreMove.current || !map) return
        const c = pinLatLng(map)
        scheduleReverseAndValidate(c.lat, c.lng)
      })

      mapRef.current = map
      // The picker mounts into a portal that is still sizing itself, so one
      // frame is not enough: Leaflet measured a collapsed box and painted no
      // tiles. Re-measure on every box change instead.
      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        mapRef.current?.invalidateSize({ animate: false })
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(() => {
        map?.invalidateSize()
        if (map) {
          const c = pinLatLng(map)
          scheduleReverseAndValidate(c.lat, c.lng)
        }
      })
    }

    void init()

    return () => {
      cancelled = true
      if (reverseTimer.current) window.clearTimeout(reverseTimer.current)
      resizeRef.current?.disconnect()
      resizeRef.current = null
      coverageLayerRef.current = null
      styleEl?.remove()
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

  // The barangay edge and the acceptance zone, drawn from the same policy the
  // server validates against — so what the resident is allowed to pin is
  // visible before they try, not only after a rejection.
  useEffect(() => {
    const map = mapRef.current
    const group = coverageLayerRef.current
    if (!open || !map || !group || !mapContext) return
    const boundary = (mapContext.boundary?.geometry ?? null) as never
    coverageRef.current = { boundary, policy: mapContext.dispatch_policy }
    void import("leaflet").then((L) => {
      if (!coverageLayerRef.current) return
      group.clearLayers()
      drawCoverage(L, group, {
        boundary,
        policy: mapContext.dispatch_policy,
        showBoundary: false,
        showZone: false,
      })
      const center = pinLatLng(map)
      setOutOfScope(!insideCoverage(center.lat, center.lng, coverageRef.current))
      if (!boundary) return
      try {
        map.fitBounds(L.geoJSON(boundary).getBounds(), { padding: [28, 28], maxZoom: 16 })
      } catch {
        /* ignore */
      }
    })
  }, [open, mapContext])

  // Clear stale results when the query drops below the debounce threshold, or
  // the picker opens/closes — via render-adjust instead of a sync setState in
  // the debounce effect below.
  const searchKey = `${open}/${search.trim()}`
  const [prevSearchKey, setPrevSearchKey] = useState(searchKey)
  if (prevSearchKey !== searchKey) {
    setPrevSearchKey(searchKey)
    if (!open || search.trim().length < 2) setResults([])
  }

  // Debounced API search
  useEffect(() => {
    if (!open || search.trim().length < 2) return
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
    map.setView(pinAdjustedCenter(map, lat, lng, 17), 17)
    setPreviewLatLng({ lat, lng })
    if (parts) setPreviewParts(parts)
    scheduleReverseAndValidate(lat, lng)
    window.setTimeout(() => {
      ignoreMove.current = false
    }, 500)
  }

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
      (position) => {
        setGpsFix({ lat: position.coords.latitude, lng: position.coords.longitude })
        map.setView(pinAdjustedCenter(map, position.coords.latitude, position.coords.longitude, 16), 16)
      },
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
      flyTo(lat, lng)
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

  function handleConfirm() {
    const map = mapRef.current
    const center = map ? pinLatLng(map) : undefined
    const lat = previewLatLng?.lat ?? center?.lat
    const lng = previewLatLng?.lng ?? center?.lng
    if (lat == null || lng == null) return
    if (outOfScope) return
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
    if (!open || svCoord || svPicking) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose, svCoord, svPicking])

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
  const canConfirm =
    !outOfScope && (!locationClass || locationClass.accepted) && hasUsableStreet && !geocoding

  const svPoints = useMemo<StreetViewMapPoint[]>(
    () =>
      gpsFix
        ? [
            {
              id: "you",
              lat: gpsFix.lat,
              lng: gpsFix.lng,
              html: glyphPinHtml({ paths: GLYPHS.userResident, color: MAP_COLORS.you, size: 24 }),
              size: 24,
              title: "You are here",
            },
          ]
        : [],
    [gpsFix],
  )

  if (!open) return null

  const LOCATION_STYLES = `
    .eboses-pin-pulse::before,
    .eboses-pin-pulse::after {
      content: "";
      position: absolute;
      inset: 50%;
      width: 12px;
      height: 12px;
      margin: -6px 0 0 -6px;
      border-radius: 9999px;
      background: rgba(0, 0, 0, 0.35);
      animation: eboses-pin-scan 1.8s ease-out infinite;
      pointer-events: none;
    }
    .eboses-pin-pulse::after {
      animation-delay: 0.9s;
      background: rgba(0, 0, 0, 0.22);
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
    .eboses-map-blocked::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 500;
      pointer-events: none;
      background: rgba(220, 38, 38, 0.08);
    }
    .eboses-loc-resize { resize: both; }
    .eboses-loc-resize::-webkit-resizer { display: none; }
    .eboses-loc-resize::after { display: none !important; content: none !important; }
  `

  const mapBody = (
    <div
      className={cn(
        "relative min-h-0 flex-1 h-full overflow-hidden",
        sheetMode === "expanded" && "eboses-map-search-expanded",
      )}
    >
      <div
        ref={containerRef}
        className={cn("absolute inset-0 z-0", outOfScope && "eboses-map-blocked")}
      />

      {!svCoord ? (
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
            className={cn(
              "text-neutral-900 hover:bg-white hover:text-neutral-900",
              svPicking ? "bg-neutral-100" : "bg-white",
            )}
            active={svPicking}
            label={svPicking ? "Cancel Street View pick" : "Click the map, then open Street View there"}
            onClick={() => setSvPicking((value) => !value)}
          >
            <FootprintsIcon className="size-5" strokeWidth={1.9} aria-hidden />
          </MapStackButton>
        </MapControlStack>
      ) : null}

      {sheetMode !== "expanded" && !svCoord && !svPicking ? (
        <>
          {!outOfScope ? (
            <span
              className="eboses-pin-pulse absolute left-1/2 z-[1200] size-3 rounded-full bg-neutral-900"
              style={{
                top: `calc(50% - ${PIN_OFFSET_Y}px)`,
                marginLeft: -6,
                marginTop: -6,
                boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
              }}
            />
          ) : null}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-[1100] flex flex-col items-center gap-2 px-4",
              sheetMode === "peek" ? "bottom-[116px]" : "bottom-[88px]",
            )}
          >
            {outOfScope ? (
              <p
                role="status"
                className="pointer-events-none flex max-w-[min(100%,340px)] flex-col items-center rounded-full border border-neutral-200 bg-white px-7 py-3.5 text-center shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
              >
                <span className="text-[15px] font-semibold leading-none text-neutral-900">
                  {OUT_OF_SCOPE_MESSAGE}
                </span>
                <span className="mt-1.5 text-[13px] font-medium leading-snug text-neutral-500">
                  Move the map back to a covered area.
                </span>
              </p>
            ) : (
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
            )}
          </div>
        </>
      ) : null}

      {svPicking && sheetMode !== "expanded" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[88px] z-[1100] flex justify-center px-4">
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 shadow-md">
            Click the map to open Street View there · Esc cancels
          </p>
        </div>
      ) : null}

      {/* Search bottom sheet */}
      {!svCoord ? (
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
              placeholder={`Search streets in ${mapContext?.boundary?.name ?? "Marikina Heights"}`}
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
            "scrollbar-hide min-h-0 flex-1 list-none overflow-y-auto",
            sheetMode === "collapsed" && "hidden",
            sheetMode === "peek" && "pointer-events-none select-none",
            sheetMode === "expanded" && hasQuery && results.length === 0 && !searching &&
              "flex flex-col justify-center",
          )}
        >
          {searching ? (
            <li className="px-5 py-3 text-[14px] text-neutral-500">Searching…</li>
          ) : results.length === 0 && hasQuery ? (
            <li className="px-5 py-3 text-center text-[14px] text-neutral-500">No results found</li>
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
      ) : null}
    </div>
  )

  // Inline mode: just the map content, no portal/overlay/header
  if (renderInline) {
    return (
      <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <style>{LOCATION_STYLES}</style>
        {mapBody}
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[320] flex items-center justify-center p-3 sm:p-6 md:p-6">
      <style>{LOCATION_STYLES}</style>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Mobile: draggable bottom sheet · Desktop: centered dialog */}
      <div
        className={cn(
          "z-10 flex w-full flex-col overflow-hidden bg-white",
          "absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-neutral-200 shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
          "md:relative md:inset-auto md:mx-auto md:max-w-2xl md:rounded-2xl md:border md:border-neutral-200 md:shadow-2xl md:h-[min(780px,92vh)] md:min-h-[420px] md:resize md:overflow-auto eboses-loc-resize",
          !locSheet.dragging && "transition-[height] duration-200 ease-out",
        )}
        style={{ height: locSheet.height }}
      >
        {/* Drag handle — mobile only */}
        <div
          onPointerDown={locSheet.onHandlePointerDown}
          onPointerMove={locSheet.onHandlePointerMove}
          onPointerUp={locSheet.onHandlePointerUp}
          onPointerCancel={locSheet.onHandlePointerUp}
          className="flex shrink-0 touch-none cursor-grab flex-col items-center bg-white px-3 pb-1 pt-2 active:cursor-grabbing md:hidden"
        >
          <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
        </div>
        <div className="relative flex shrink-0 items-center gap-2 border-b border-neutral-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 sm:size-12"
            aria-label="Back"
          >
            <ArrowLeftIcon className="size-6" strokeWidth={2} />
          </button>
          <h2 className="text-[16px] font-semibold text-neutral-900 sm:text-[17px] max-md:pointer-events-none max-md:absolute max-md:inset-x-0 max-md:text-center">
            Move map to pin location
          </h2>
        </div>
        {mapBody}

        {svCoord ? (
          <StreetViewModal
            coord={svCoord}
            mode="pick"
            points={svPoints}
            onMove={(next) => {
              flyTo(next.lat, next.lng)
              setSvCoord(next)
            }}
            coverage={
              mapContext
                ? {
                    boundary: (mapContext.boundary?.geometry ?? null) as never,
                    policy: mapContext.dispatch_policy,
                  }
                : null
            }
            onClose={() => setSvCoord(null)}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  )
}