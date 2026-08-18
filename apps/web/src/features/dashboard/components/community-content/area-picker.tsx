import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleCheck, MinusIcon, PlusIcon, SearchIcon } from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import type { AnnouncementAreaContext, LiveMapStreet } from "@/features/dashboard/api"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"
import { advisoryMeta, advisoryMarkerHtml } from "./advisory-tags"
import {
  emptyArea,
  polygonCentroid,
  streetCorridor,
  streetPoints,
  type AreaPickerValue,
} from "./area-lib"

const inputClass =
  "w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"

const labelClass = "grid gap-1 text-[13px] font-semibold text-neutral-500"

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

  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const streets = useMemo<LiveMapStreet[]>(
    () => context?.streets.streets ?? [],
    [context],
  )
  const boundary = useMemo(() => context?.boundary ?? null, [context])
  const fillColor = advisoryMeta(tag).color

  const corridorSeqRef = useRef(0)
  const iconPosRef = useRef<[number, number] | null>(null)
  const iconStreetsRef = useRef("")

  const applyStreets = useCallback(
    (next: string[]) => {
      const seq = ++corridorSeqRef.current
      const selectedStreets = streets.filter((street) => next.includes(street.name))
      void streetCorridor(selectedStreets).then((corridor) => {
        if (seq !== corridorSeqRef.current) return
        onChange({
          streets: next,
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

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || mapRef.current) return
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

      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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

  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer || !mapReady) return

    layer.clearLayers()

    if (boundary?.geometry) {
      L.geoJSON(boundary.geometry as never, {
        style: {
          color: "rgba(226,232,240,0.45)",
          weight: 0.5,
          fillColor,
          fillOpacity: value.streets.length === 0 ? 0.15 : 0,
        },
      }).addTo(layer)
    }

    const selected = new Set(value.streets)
    const selectionKey = value.streets.join("|")
    if (iconStreetsRef.current !== selectionKey) {
      iconPosRef.current = null
      iconStreetsRef.current = selectionKey
    }

    for (const street of streets) {
      const isSelected = selected.has(street.name)
      const lines = (street.geometries ?? []).flatMap((geometry) => geoJsonToLines(geometry))

      if (isSelected) {
        for (const line of lines) {
          L.polyline(line, {
            color: fillColor,
            weight: 5,
            opacity: 0.15,
            dashArray: "6 8",
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(layer)
        }
        for (const line of lines) {
          L.polyline(line, {
            color: fillColor,
            weight: 3,
            opacity: 0.3,
            dashArray: "6 8",
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(layer)
        }
      }

      for (const line of lines) {
        const polyline = L.polyline(line, {
          color: isSelected ? fillColor : "transparent",
          weight: isSelected ? 1 : 8,
          opacity: isSelected ? 1 : 0,
          dashArray: isSelected ? "6 8" : undefined,
          lineCap: "round",
          lineJoin: "round",
          interactive: true,
        })
        polyline.on("click", () => toggleStreet(street.name))
        polyline.bindTooltip(street.name, { sticky: true, direction: "top", opacity: 0.95 })
        polyline.addTo(layer)
      }
    }

    let anchor: [number, number] | null = iconPosRef.current
    if (!anchor) {
      if (value.streets.length > 0) {
        if (value.geometry) {
          anchor = polygonCentroid(value.geometry)
        } else {
          const street = streets.find((s) => s.name === value.streets[0])
          const pts = street ? streetPoints(street) : []
          if (pts.length > 0) {
            anchor = [
              pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
              pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
            ]
          }
        }
      } else if (boundary?.geometry) {
        try {
          const bounds = L.geoJSON(boundary.geometry as never).getBounds()
          if (bounds.isValid()) {
            const center = bounds.getCenter()
            anchor = [center.lat, center.lng]
          }
        } catch {
          void 0
        }
      }
    }
    if (anchor) {
      let dragging = false
      const icon = L.marker(anchor, {
        icon: L.divIcon({
          className: "",
          html: advisoryMarkerHtml(tag, 26),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        draggable: true,
        keyboard: true,
        zIndexOffset: 1000,
      })
      icon.on("dragstart", () => {
        dragging = true
      })
      icon.on("dragend", () => {
        const position = icon.getLatLng()
        iconPosRef.current = [position.lat, position.lng]
        iconStreetsRef.current = value.streets.join("|")
      })
      icon.on("click", () => {
        if (dragging) {
          dragging = false
          return
        }
        clearArea()
      })
      icon.addTo(layer)
    }

    if (!framedRef.current && boundary?.geometry) {
      try {
        const bounds = L.geoJSON(boundary.geometry as never).getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 })
          framedRef.current = true
        }
      } catch {
        void 0
      }
    }
  }, [value, streets, boundary, mapReady, onChange, toggleStreet, clearArea, tag, fillColor])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return streets.filter((street) => street.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, streets])

  return (
    <div className="space-y-3">
      <label htmlFor="area-search" className={labelClass}>
        Search streets
      </label>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-neutral-400" />
        <input
          id="area-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search streets"
          className={cn(inputClass, "pl-11 font-normal")}
        />
        {searchResults.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white py-1 shadow-lg">
            {searchResults.map((street) => {
              const on = value.streets.includes(street.name)
              return (
                <button
                  key={street.name}
                  type="button"
                  onClick={() => toggleStreet(street.name)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
                >
                  <span className="min-w-0 flex-1 truncate">{street.name}</span>
                  {street.type ? (
                    <span className="text-[12px] text-neutral-400">{street.type}</span>
                  ) : null}
                  {on ? (
                    <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className={cn("relative overflow-hidden rounded-2xl border border-line-tint bg-white", className)}>
        <div ref={containerRef} className="h-64 w-full md:h-72" />

        <div className="absolute bottom-3 right-3 z-[600] flex flex-col overflow-hidden rounded-[10px] border border-neutral-200 bg-white shadow-lg">
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            aria-label="Zoom in"
            title="Zoom in"
            className="flex size-9 items-center justify-center border-b border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <PlusIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            aria-label="Zoom out"
            title="Zoom out"
            className="flex size-9 items-center justify-center text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <MinusIcon className="size-4" />
          </button>
        </div>

        <style>{`
          .eboses-area-map.leaflet-container {
            font-family: inherit;
            background: #18181b;
          }
          .eboses-area-map .leaflet-interactive { cursor: pointer; }
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
    </div>
  )
}
