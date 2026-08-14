import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MapPinIcon, SearchIcon, XIcon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import type { AnnouncementAreaContext, LiveMapStreet } from "@/features/dashboard/api"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"
import { ADVISORY_COLOR, advisoryMarkerHtml } from "./advisory-tags"
import {
  emptyArea,
  geoJsonToRing,
  polygonCentroid,
  streetCorridor,
  streetPoints,
  type AreaPickerValue,
} from "./area-lib"

const STREET_COLOR = "#8b93a7"

export function AreaPicker({
  context,
  value,
  onChange,
  tag = "",
  className = "",
}: {
  context: AnnouncementAreaContext | null
  value: AreaPickerValue
  onChange: (next: AreaPickerValue) => void
  /** Advisory tag — colors the streets, area fill, and icon marker. */
  tag?: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layerRef = useRef<leaflet.LayerGroup | null>(null)
  const framedRef = useRef(false)
  const observerRef = useRef<ResizeObserver | null>(null)

  const [mapReady, setMapReady] = useState(false)
  const [search, setSearch] = useState("")

  // Latest value, readable from Leaflet callbacks.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const streets = useMemo<LiveMapStreet[]>(
    () => context?.streets.streets ?? [],
    [context],
  )
  const boundary = useMemo(() => context?.boundary ?? null, [context])
  const fillColor = ADVISORY_COLOR

  // Guards against a slow corridor resolution landing after a newer one —
  // only the most recent request may commit to state.
  const corridorSeqRef = useRef(0)

  const applyStreets = useCallback(
    (next: string[]) => {
      const seq = ++corridorSeqRef.current
      const selectedStreets = streets.filter((street) => next.includes(street.name))
      void streetCorridor(selectedStreets).then((corridor) => {
        if (seq !== corridorSeqRef.current) return
        onChange({
          streets: next,
          // Single street → no polygon; only 2+ streets form an area.
          geometry: corridor,
          mode: "auto",
        })
      })
    },
    [streets, onChange],
  )

  const toggleStreet = useCallback(
    (name: string) => {
      const current = valueRef.current
      const next = new Set(current.streets)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      applyStreets([...next])
    },
    [applyStreets],
  )

  const clearArea = useCallback(() => {
    onChange(emptyArea)
  }, [onChange])

  // ── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || mapRef.current) return
      // Leaflet re-inits into the same node if Strict Mode remounts — clear
      // the stale `_leaflet_id` first or L.map() returns the removed map.
      if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        containerRef.current.innerHTML = ""
      }
      LRef.current = L

      const map = L.map(containerRef.current, {
        center: [14.6507, 121.1133],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
      })
      containerRef.current.classList.add("eboses-area-map")
      L.control.zoom({ position: "bottomright" }).addTo(map)

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OSM &copy; CARTO",
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map)

      layerRef.current = L.layerGroup().addTo(map)

      mapRef.current = map
      map.invalidateSize()
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        const observer = new ResizeObserver(() => map.invalidateSize())
        observer.observe(containerRef.current)
        observerRef.current = observer
      }
      setMapReady(true)
      requestAnimationFrame(() => map.invalidateSize())
    })()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      observerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      LRef.current = null
      framedRef.current = false
    }
  }, [onChange])

  // ── Redraw everything when the value or catalog changes ─────────────────
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer || !mapReady) return

    layer.clearLayers()

    // Boundary, for spatial context.
    if (boundary?.geometry) {
      L.geoJSON(boundary.geometry as never, {
        style: { color: ADVISORY_COLOR, weight: 1.5, fillColor: ADVISORY_COLOR, fillOpacity: 0.03, opacity: 0.4 },
      }).addTo(layer)
    }

    const selected = new Set(value.streets)

    // Street lines. Selected streets highlight in the advisory color; every
    // street is clickable to toggle it. The lines are the source of truth —
    // no polygon is invented around a single street.
    for (const street of streets) {
      const isSelected = selected.has(street.name)
      for (const geometry of street.geometries ?? []) {
        for (const line of geoJsonToLines(geometry)) {
          const polyline = L.polyline(line, {
            color: isSelected ? fillColor : STREET_COLOR,
            weight: isSelected ? 4 : 1.25,
            opacity: isSelected ? 1 : 0.45,
            interactive: true,
          })
          polyline.on("click", () => toggleStreet(street.name))
          polyline.bindTooltip(street.name, { sticky: true, direction: "top", opacity: 0.95 })
          polyline.addTo(layer)
        }
      }
    }

    // The affected area: advisory-colored fill with no strong border, plus the
    // tag icon at its centroid.
    if (value.geometry) {
      const ring = geoJsonToRing(value.geometry)
      L.polygon(ring, {
        color: fillColor,
        weight: 0,
        fillColor,
        fillOpacity: 0.22,
        interactive: false,
      }).addTo(layer)

      const centroid = polygonCentroid(value.geometry)
      if (centroid) {
        L.marker(centroid, {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(tag),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(layer)
      }
    }

    // Frame the barangay once the container actually has a size.
    if (!framedRef.current && boundary?.geometry) {
      try {
        const bounds = L.geoJSON(boundary.geometry as never).getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
          framedRef.current = true
        }
      } catch {
        /* ignore */
      }
    }
  }, [value, streets, boundary, mapReady, onChange, toggleStreet, tag, fillColor])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return streets.filter((street) => street.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, streets])

  // When the catalog falls back to street *names* without OSM geometries, the
  // auto area has no lines to buffer — surface that instead of silently doing
  // nothing.
  const streetsLackGeometry = useMemo(() => {
    const selectedStreets = streets.filter((street) => value.streets.includes(street.name))
    return selectedStreets.length > 0 && selectedStreets.every((street) => streetPoints(street).length === 0)
  }, [streets, value.streets])

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-line-tint bg-white", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line-tint px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-[12px] font-bold text-brand-navy">
          <MapPinIcon className="size-4 shrink-0" strokeWidth={2.2} />
          {value.streets.length === 0
            ? "Tap the streets this affects"
            : `${value.streets.length} street${value.streets.length === 1 ? "" : "s"} selected`}
        </span>

        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-navy-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search streets"
            className="h-8 w-full rounded-lg border border-line-tint bg-white pl-8 pr-3 text-xs font-semibold text-brand-navy outline-none placeholder:text-navy-muted focus:border-brand-orange"
          />
          {searchResults.length > 0 ? (
            <div className="absolute left-0 right-0 top-9 z-[1200] overflow-hidden rounded-xl border border-line-tint bg-white shadow-lg">
              {searchResults.map((street) => {
                const on = value.streets.includes(street.name)
                return (
                  <button
                    key={street.name}
                    type="button"
                    onClick={() => toggleStreet(street.name)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-brand-navy transition-colors hover:bg-canvas"
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full border",
                        on ? "border-brand-orange bg-brand-orange" : "border-navy-muted/50",
                      )}
                    />
                    <span className="truncate">{street.name}</span>
                    {street.type ? (
                      <span className="ml-auto text-[10px] font-bold text-navy-muted">{street.type}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        {value.streets.length > 0 || value.geometry ? (
          <button
            type="button"
            onClick={clearArea}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-destructive transition-colors hover:bg-neutral-100"
          >
            <XIcon className="size-3.5" />
            Clear
          </button>
        ) : null}
      </div>

      {/* Map */}
      <div ref={containerRef} className="h-64 w-full md:h-72" />

      {/* Status / hints */}
      <div className="space-y-2 border-t border-line-tint px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-subtle-foreground">
            <span
              aria-hidden
              className="h-1 w-5 shrink-0 rounded-full"
              style={{ background: fillColor }}
            />
            Selected street
          </span>
          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-subtle-foreground">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-[3px] border border-brand-orange/60 bg-brand-orange/15"
            />
            Barangay boundary
          </span>
          <span className="ml-auto text-[11.5px] text-subtle-foreground">
            {streetsLackGeometry
              ? "Street shapes are unavailable, so no area can be drawn."
              : value.streets.length === 0
                ? "Tap a street on the map, or search for it above."
                : value.streets.length === 1
                  ? "Add one more street to outline an area."
                  : "Tap a street again to remove it."}
          </span>
        </div>

        {value.streets.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {value.streets.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => toggleStreet(name)}
                aria-label={`Remove ${name}`}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors"
                style={{
                  borderColor: `${fillColor}66`,
                  background: `${fillColor}14`,
                  color: fillColor,
                }}
              >
                {name}
                <XIcon className="size-3.5" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <style>{`
        .eboses-area-map.leaflet-container {
          font-family: inherit;
          background: #f3f4f6;
        }
        .eboses-area-map .leaflet-interactive { cursor: pointer; }
        .eboses-area-map .leaflet-control-zoom {
          border: none !important;
          border-radius: 10px !important;
          overflow: hidden;
          box-shadow: 0 4px 14px rgba(0,0,0,0.18) !important;
        }
        .eboses-area-map .leaflet-control-zoom a {
          width: 32px !important;
          height: 32px !important;
          line-height: 32px !important;
          color: #3f3f46 !important;
          background: #fff !important;
          border: none !important;
          border-bottom: 1px solid #e4e4e7 !important;
        }
        .eboses-area-map .leaflet-control-zoom a:hover { background: #f4f4f5 !important; }
        .eboses-area-map .leaflet-tooltip {
          border-radius: 8px;
          border: none;
          box-shadow: 0 4px 14px rgba(0,0,0,0.15);
          font-size: 11px;
          font-weight: 700;
          color: #1e2b45;
          padding: 3px 8px;
        }
      `}</style>
    </div>
  )
}
