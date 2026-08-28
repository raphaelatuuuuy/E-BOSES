import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  CircleCheck,
  MapPinned,
  Pencil,
  Pentagon,
  SearchIcon,
  Spline,
  Trash2,
  Undo2,
} from "lucide-react"
import type leaflet from "leaflet"

import { cn } from "@workspace/ui/lib/utils"
import {
  listManagedAnnouncements,
  type Announcement,
  type AnnouncementAreaContext,
  type LiveMapStreet,
} from "@/features/dashboard/api"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import { advisoryMeta, advisoryMarkerHtml } from "./advisory-tags"
import {
  emptyArea,
  geoJsonToRing,
  polygonCentroid,
  shapesToPolygon,
  streetCorridor,
  streetPoints,
  type AreaPickerValue,
  type DrawnShape,
} from "./area-lib"

const inputClass =
  "w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"

const labelClass = "grid gap-1 text-[13px] font-semibold text-neutral-500"

const MARIKINA_CENTER: [number, number] = [14.6507, 121.1133]
/** Click radius, in screen pixels, for snapping onto an existing vertex. */
const SNAP_PX = 14

type Tool = "line" | "polygon" | "edit" | "delete" | null

function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function hintFor(tool: Tool, draftLength: number): string {
  if (tool === "polygon") {
    if (draftLength === 0) return "Click to place the first point."
    if (draftLength < 3) return "Click to keep adding points."
    return "Click first point to close this shape."
  }
  if (tool === "line") {
    if (draftLength === 0) return "Click to place the first point."
    return "Click last point to finish this line."
  }
  if (tool === "edit") return "Drag a handle to reshape. Click a small dot to add a point."
  if (tool === "delete") return "Click a shape to remove it."
  return ""
}

function handleIcon(L: typeof leaflet, size: number, color: string, faded: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};opacity:${
      faded ? 0.55 : 1
    };box-shadow:0 0 6px ${color}aa,0 1px 4px rgba(0,0,0,.55)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function AreaPicker({
  context,
  value,
  onChange,
  tag = "",
  excludeId = null,
  className = "",
}: {
  context: AnnouncementAreaContext | null
  value: AreaPickerValue
  onChange: (next: AreaPickerValue) => void
  tag?: string
  /** The announcement being edited — its own area is not drawn as context. */
  excludeId?: number | null
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const baseLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const drawLayerRef = useRef<leaflet.LayerGroup | null>(null)
  const hintLineRef = useRef<leaflet.Polyline | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const fittedRef = useRef(false)

  const [mapReady, setMapReady] = useState(false)
  const [search, setSearch] = useState("")
  const [tool, setTool] = useState<Tool>(null)
  /** null until the user draws — the canvas mirrors the saved area until then. */
  const [drawn, setDrawn] = useState<DrawnShape[] | null>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [pointerOnMap, setPointerOnMap] = useState(false)
  /** Where the advisory pin was dragged to, when the centroid is not wanted. */
  const [iconPos, setIconPos] = useState<[number, number] | null>(null)
  /** Areas of announcements that already exist, drawn as dim context. */
  const [existing, setExisting] = useState<Announcement[]>([])

  const toolRef = useRef<Tool>(null)
  const draftRef = useRef<[number, number][]>([])
  const shapesRef = useRef<DrawnShape[]>([])
  const historyRef = useRef<DrawnShape[][]>([])
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)

  const shapes = useMemo<DrawnShape[]>(() => {
    if (drawn) return drawn
    if (value.mode !== "manual" || !value.geometry) return []
    const ring = geoJsonToRing(value.geometry)
    if (ring.length < 3) return []
    return [{ id: "saved", kind: "polygon", points: ring }]
  }, [drawn, value.geometry, value.mode])

  useEffect(() => {
    valueRef.current = value
  }, [value])
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(() => {
    shapesRef.current = shapes
  }, [shapes])

  const streets = useMemo<LiveMapStreet[]>(() => context?.streets.streets ?? [], [context])
  const boundary = useMemo(() => context?.boundary ?? null, [context])
  const accent = advisoryMeta(tag).color
  const accentRef = useRef(accent)
  useEffect(() => {
    accentRef.current = accent
  }, [accent])

  const corridorSeqRef = useRef(0)

  const applyStreets = useCallback(
    (next: string[]) => {
      if (shapesRef.current.length > 0) {
        onChangeRef.current({ ...valueRef.current, streets: next })
        return
      }
      const seq = ++corridorSeqRef.current
      const selected = streets.filter((street) => next.includes(street.name))
      void streetCorridor(selected).then((corridor) => {
        if (seq !== corridorSeqRef.current) return
        onChangeRef.current({ streets: next, geometry: corridor, mode: "auto" })
      })
    },
    [streets],
  )

  const toggleStreet = useCallback(
    (name: string) => {
      const next = new Set(valueRef.current.streets)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      applyStreets([...next])
    },
    [applyStreets],
  )

  const commitShapes = useCallback((next: DrawnShape[]) => {
    historyRef.current = [...historyRef.current.slice(-19), shapesRef.current]
    setDrawn(next)
  }, [])

  const finishDraft = useCallback(() => {
    const points = draftRef.current
    const active = toolRef.current
    if (active !== "polygon" && active !== "line") return
    const enough = active === "polygon" ? points.length >= 3 : points.length >= 2
    if (enough) commitShapes([...shapesRef.current, { id: newId(), kind: active, points }])
    setDraft([])
  }, [commitShapes])

  const undo = useCallback(() => {
    if (draftRef.current.length > 0) {
      setDraft([])
      return
    }
    const previous = historyRef.current.pop()
    if (!previous) return
    setDrawn(previous)
  }, [])

  const clearAll = useCallback(() => {
    setDraft([])
    setIconPos(null)
    if (shapesRef.current.length > 0) commitShapes([])
    else onChangeRef.current(emptyArea)
  }, [commitShapes])

  const selectTool = useCallback((next: Tool) => {
    setDraft([])
    setTool((current) => (current === next ? null : next))
  }, [])

  // Drawn shapes own the geometry; clearing them hands it back to the streets.
  const geometrySeqRef = useRef(0)
  useEffect(() => {
    if (drawn === null) return
    const seq = ++geometrySeqRef.current
    if (drawn.length === 0) {
      applyStreets(valueRef.current.streets)
      return
    }
    void shapesToPolygon(drawn).then((geometry) => {
      if (seq !== geometrySeqRef.current) return
      onChangeRef.current({ streets: valueRef.current.streets, geometry, mode: "manual" })
    })
  }, [drawn, applyStreets])

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
      LRef.current = L

      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-area-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #0b1020;
          font-family: inherit;
        }
        .eboses-area-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-area-map img.leaflet-tile,
        .eboses-area-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-area-map .leaflet-tooltip {
          background: #ffffff;
          border: none;
          border-radius: 8px;
          box-shadow: 0 6px 18px rgba(0,0,0,.35);
          color: #1e2b45;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
        }
        .eboses-area-map .leaflet-tooltip-top::before { border-top-color: #ffffff; }
        .eboses-area-map .eboses-glow {
          filter: drop-shadow(0 0 3px var(--eboses-accent, #ffffff));
        }
        .eboses-area-map .leaflet-interactive:focus,
        .eboses-area-map .leaflet-marker-icon:focus,
        .eboses-area-map:focus,
        .eboses-area-map *:focus-visible {
          outline: none !important;
        }
        .eboses-area-map.eboses-drawing { cursor: crosshair; }
        .eboses-area-map.eboses-drawing .leaflet-grab { cursor: crosshair; }
      `
      document.head.appendChild(styleEl)

      const map = L.map(containerRef.current, {
        center: MARIKINA_CENTER,
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        doubleClickZoom: false,
        preferCanvas: false,
      })

      addBaseTiles(L, map, "dark", {
        maxZoom: 20,
        // Load a ring of tiles past the viewport so panning and zooming out
        // never expose bare background.
        keepBuffer: 6,
        updateWhenIdle: false,
        updateWhenZooming: true,
      })

      baseLayerRef.current = L.layerGroup().addTo(map)
      drawLayerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map

      map.on("click", (event: leaflet.LeafletMouseEvent) => {
        const active = toolRef.current
        if (active !== "polygon" && active !== "line") return
        const points = draftRef.current
        const at = map.latLngToContainerPoint(event.latlng)

        if (active === "polygon" && points.length >= 3) {
          const first = map.latLngToContainerPoint(points[0]!)
          if (at.distanceTo(first) <= SNAP_PX) {
            finishDraft()
            return
          }
        }
        if (active === "line" && points.length >= 2) {
          const last = map.latLngToContainerPoint(points[points.length - 1]!)
          if (at.distanceTo(last) <= SNAP_PX) {
            finishDraft()
            return
          }
        }
        setDraft([...points, [event.latlng.lat, event.latlng.lng]])
      })

      map.on("dblclick", () => {
        if (toolRef.current === "line" || toolRef.current === "polygon") finishDraft()
      })

      map.on("mousemove", (event: leaflet.LeafletMouseEvent) => {
        const active = toolRef.current
        const tooltip = tooltipRef.current
        if (tooltip) {
          const at = map.latLngToContainerPoint(event.latlng)
          tooltip.style.transform = `translate(${at.x + 16}px, ${at.y - 14}px)`
        }
        if (active !== "polygon" && active !== "line") return
        const points = draftRef.current
        const last = points[points.length - 1]
        if (!last) return
        const trail: [number, number][] = [last, [event.latlng.lat, event.latlng.lng]]
        if (hintLineRef.current) {
          hintLineRef.current.setLatLngs(trail)
          hintLineRef.current.setStyle({ color: accentRef.current })
        } else {
          hintLineRef.current = L.polyline(trail, {
            color: accentRef.current,
            weight: 1.5,
            opacity: 0.85,
            dashArray: "4 6",
            className: "eboses-glow",
            interactive: false,
          }).addTo(map)
        }
      })

      map.on("mouseout", () => setPointerOnMap(false))
      map.on("mouseover", () => setPointerOnMap(true))

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
      observerRef.current?.disconnect()
      observerRef.current = null
      hintLineRef.current = null
      baseLayerRef.current = null
      drawLayerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      LRef.current = null
    }
  }, [finishDraft])

  useEffect(() => {
    let cancelled = false
    void listManagedAnnouncements()
      .then((announcements) => {
        if (cancelled) return
        setExisting(
          announcements.filter(
            (item) =>
              item.area_geometry ||
              (item.street_geometries?.length ?? 0) > 0 ||
              (item.affected_streets?.length ?? 0) > 0,
          ),
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (draftRef.current.length > 0) setDraft([])
      else setTool(null)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  /** Barangay bounds, kept for the recenter button and the zoom-out floor. */
  const boundsRef = useRef<leaflet.LatLngBounds | null>(null)

  const recenter = useCallback(() => {
    const map = mapRef.current
    const bounds = boundsRef.current
    if (!map || !bounds) return
    map.fitBounds(bounds, { padding: [24, 24] })
  }, [])

  // The view is fitted once; panning and zooming are the user's from then on.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map || !mapReady || fittedRef.current || !boundary?.geometry) return
    try {
      const bounds = L.geoJSON(boundary.geometry as never).getBounds()
      if (!bounds.isValid()) return
      fittedRef.current = true
      boundsRef.current = bounds
      map.fitBounds(bounds, { padding: [24, 24] })
      // Two steps out from the barangay is as far as the picker zooms.
      map.setMinZoom(Math.max(map.getZoom() - 2, 0))
    } catch {
      void 0
    }
  }, [boundary, mapReady])

  // Reference layer: barangay outline plus the searchable streets.
  useEffect(() => {
    const L = LRef.current
    const layer = baseLayerRef.current
    if (!L || !layer || !mapReady) return
    layer.clearLayers()

    // The barangay reads as a static white plate with a subtle dashed edge.
    // A selected area that already spans the whole barangay hides it outright.
    if (boundary?.geometry) {
      const boundaryBounds = L.geoJSON(boundary.geometry as never).getBounds()
      let covered = false
      if (value.geometry) {
        try {
          const areaBounds = L.geoJSON(value.geometry as never).getBounds()
          covered = areaBounds.isValid() && areaBounds.contains(boundaryBounds)
        } catch {
          covered = false
        }
      }

      // Nothing picked means the advisory covers the whole barangay, so the
      // barangay itself takes the advisory's colour.
      const wholeBarangay = value.streets.length === 0 && !value.geometry
      if (!covered) {
        L.geoJSON(boundary.geometry as never, {
          style: {
            color: wholeBarangay ? accent : "#ffffff",
            weight: 1,
            opacity: wholeBarangay ? 0.8 : 0.35,
            dashArray: "5 7",
            fillColor: wholeBarangay ? accent : "#ffffff",
            fillOpacity: wholeBarangay ? 0.18 : 0.16,
            className: wholeBarangay ? "eboses-glow" : undefined,
            interactive: false,
          },
        }).addTo(layer)
      }
    }

    // Areas already published, so a new advisory is not drawn blind. Older
    // announcements that only carry streets are shown as their street lines.
    for (const announcement of existing) {
      if (announcement.id === excludeId) continue
      const color = advisoryMeta(announcement.tag).color
      const tooltip = { sticky: true, direction: "top", opacity: 1 } as const

      if (announcement.area_geometry) {
        L.geoJSON(announcement.area_geometry as never, {
          style: {
            color,
            weight: 1.5,
            opacity: 0.6,
            fillColor: color,
            fillOpacity: 0.14,
            interactive: false,
          },
        })
          .bindTooltip(announcement.title, tooltip)
          .addTo(layer)
        continue
      }

      const named = new Set(announcement.affected_streets ?? [])
      const lines = [
        ...(announcement.street_geometries ?? []),
        ...streets.filter((street) => named.has(street.name)).flatMap((s) => s.geometries ?? []),
      ].flatMap((geometry) => geoJsonToLines(geometry))
      if (lines.length === 0) continue
      L.polyline(lines, {
        color,
        weight: 2,
        opacity: 0.6,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      })
        .bindTooltip(announcement.title, tooltip)
        .addTo(layer)
    }

    const selected = new Set(value.streets)
    for (const street of streets) {
      const lines = (street.geometries ?? []).flatMap((geometry) => geoJsonToLines(geometry))
      if (lines.length === 0) continue
      const on = selected.has(street.name)

      // A fat invisible line keeps the whole street clickable, selected or not.
      const target = L.polyline(lines, {
        color: "#ffffff",
        weight: 14,
        opacity: 0,
        lineCap: "round",
        lineJoin: "round",
        interactive: tool === null,
      })
      if (tool === null) {
        target.on("click", () => toggleStreet(street.name))
        target.bindTooltip(street.name, { sticky: true, direction: "top", opacity: 1 })
      }
      target.addTo(layer)

      if (on) {
        L.polyline(lines, {
          color: accent,
          weight: 2,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
          className: "eboses-glow",
          interactive: false,
        }).addTo(layer)
      }
    }

    const centroid = value.geometry ? polygonCentroid(value.geometry) : null
    const fallback =
      !centroid && value.streets.length > 0
        ? (() => {
            const street = streets.find((s) => s.name === value.streets[0])
            const pts = street ? streetPoints(street) : []
            if (pts.length === 0) return null
            return [
              pts.reduce((sum, p) => sum + p[0], 0) / pts.length,
              pts.reduce((sum, p) => sum + p[1], 0) / pts.length,
            ] as [number, number]
          })()
        : null
    // The pin is always on the map, sitting on the barangay until an area exists.
    let barangayCenter: [number, number] | null = null
    if (boundary?.geometry) {
      try {
        const bounds = L.geoJSON(boundary.geometry as never).getBounds()
        if (bounds.isValid()) {
          const center = bounds.getCenter()
          barangayCenter = [center.lat, center.lng]
        }
      } catch {
        void 0
      }
    }

    const anchor = iconPos ?? centroid ?? fallback ?? barangayCenter
    if (anchor) {
      // Draggable so the pin can be nudged off the centroid, and clicking it
      // again clears the area — that is why there is no separate clear button.
      let dragged = false
      const pin = L.marker(anchor, {
        icon: L.divIcon({
          className: "",
          html: advisoryMarkerHtml(tag, 26, "light"),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        draggable: true,
        keyboard: false,
        zIndexOffset: 500,
      })
      pin.on("dragstart", () => {
        dragged = true
      })
      pin.on("dragend", () => {
        const position = pin.getLatLng()
        setIconPos([position.lat, position.lng])
      })
      pin.on("click", () => {
        if (dragged) {
          dragged = false
          return
        }
        clearAll()
      })
      pin.bindTooltip("Drag to move · click to clear", { direction: "top", opacity: 1 })
      pin.addTo(layer)
    }
  }, [
    streets,
    boundary,
    value,
    mapReady,
    tool,
    accent,
    tag,
    toggleStreet,
    iconPos,
    clearAll,
    existing,
    excludeId,
  ])

  // Drawing layer: committed shapes, the in-progress draft and the handles.
  useEffect(() => {
    const L = LRef.current
    const layer = drawLayerRef.current
    if (!L || !layer || !mapReady) return
    layer.clearLayers()

    const outline = {
      color: accent,
      weight: 2,
      opacity: 0.95,
      className: "eboses-glow",
    } as const

    for (const shape of shapes) {
      const removable = tool === "delete"
      const drawn =
        shape.kind === "polygon"
          ? L.polygon(shape.points, {
              ...outline,
              fillColor: accent,
              fillOpacity: 0.22,
              interactive: removable,
            })
          : L.polyline(shape.points, {
              ...outline,
              weight: 3,
              lineCap: "round",
              interactive: removable,
            })
      if (removable) {
        drawn.on("click", () => commitShapes(shapesRef.current.filter((s) => s.id !== shape.id)))
        drawn.bindTooltip("Remove", { direction: "top", opacity: 1 })
      }
      drawn.addTo(layer)

      if (tool !== "edit") continue

      shape.points.forEach((point, index) => {
        const handle = L.marker(point, { icon: handleIcon(L, 12, accent, false), draggable: true })
        handle.on("drag", (event: leaflet.LeafletEvent) => {
          const position = (event.target as leaflet.Marker).getLatLng()
          const next = [...shape.points]
          next[index] = [position.lat, position.lng]
          ;(drawn as leaflet.Polyline).setLatLngs(next)
        })
        handle.on("dragend", (event: leaflet.LeafletEvent) => {
          const position = (event.target as leaflet.Marker).getLatLng()
          const next = [...shape.points]
          next[index] = [position.lat, position.lng]
          commitShapes(
            shapesRef.current.map((s) => (s.id === shape.id ? { ...s, points: next } : s)),
          )
        })
        handle.addTo(layer)
      })

      const segments = shape.kind === "polygon" ? shape.points.length : shape.points.length - 1
      for (let index = 0; index < segments; index++) {
        const from = shape.points[index]!
        const to = shape.points[(index + 1) % shape.points.length]!
        const middle: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
        const dot = L.marker(middle, { icon: handleIcon(L, 9, accent, true), draggable: true })
        // Dragging a midpoint turns it into a real vertex, the way Geoman does.
        dot.on("drag", (event: leaflet.LeafletEvent) => {
          const position = (event.target as leaflet.Marker).getLatLng()
          const next = [...shape.points]
          next.splice(index + 1, 0, [position.lat, position.lng])
          ;(drawn as leaflet.Polyline).setLatLngs(next)
        })
        dot.on("dragend", (event: leaflet.LeafletEvent) => {
          const position = (event.target as leaflet.Marker).getLatLng()
          const next = [...shape.points]
          next.splice(index + 1, 0, [position.lat, position.lng])
          commitShapes(
            shapesRef.current.map((s) => (s.id === shape.id ? { ...s, points: next } : s)),
          )
        })
        dot.on("click", () => {
          const next = [...shape.points]
          next.splice(index + 1, 0, middle)
          commitShapes(
            shapesRef.current.map((s) => (s.id === shape.id ? { ...s, points: next } : s)),
          )
        })
        dot.addTo(layer)
      }
    }

    if (draft.length > 0) {
      const closing = tool === "polygon" && draft.length >= 3
      L.polyline(draft, {
        ...outline,
        weight: tool === "line" ? 3 : 2,
        lineCap: "round",
      }).addTo(layer)
      if (closing) {
        L.polyline([draft[draft.length - 1]!, draft[0]!], {
          color: accent,
          weight: 1.5,
          opacity: 0.45,
          dashArray: "4 6",
          className: "eboses-glow",
          interactive: false,
        }).addTo(layer)
      }

      draft.forEach((point, index) => {
        L.marker(point, {
          icon: handleIcon(L, index === 0 ? 14 : 12, accent, false),
          interactive: false,
          keyboard: false,
        }).addTo(layer)
      })
    }

    if (draft.length === 0 && hintLineRef.current) {
      hintLineRef.current.remove()
      hintLineRef.current = null
    }
  }, [shapes, draft, tool, mapReady, accent, commitShapes])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    const drawing = tool === "polygon" || tool === "line"
    container.classList.toggle("eboses-drawing", drawing)
    if (drawing) map.dragging.disable()
    else map.dragging.enable()
  }, [tool])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return streets.filter((street) => street.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, streets])

  const hint = hintFor(tool, draft.length)
  const tools: Array<{ id: Exclude<Tool, null>; label: string; icon: typeof Spline }> = [
    { id: "line", label: "Draw a line", icon: Spline },
    { id: "polygon", label: "Draw a shape", icon: Pentagon },
    { id: "edit", label: "Edit shape", icon: Pencil },
    { id: "delete", label: "Delete shape", icon: Trash2 },
  ]

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

      <div
        className={cn(
          "relative h-80 overflow-hidden rounded-2xl border-[1.5px] border-neutral-300 bg-ink",
          className,
        )}
        style={{ "--eboses-accent": accent } as CSSProperties}
      >
        <div ref={containerRef} className="eboses-area-map h-full w-full" />

        <div className="absolute left-3 top-1/2 z-[1000] flex -translate-y-1/2 flex-col gap-1">
          {tools.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={tool === id}
              onClick={() => selectTool(id)}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                tool === id
                  ? "bg-white text-neutral-900"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.8} />
            </button>
          ))}
          <button
            type="button"
            title="Undo"
            aria-label="Undo"
            onClick={undo}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Undo2 className="size-[18px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title="Recenter on the barangay"
            aria-label="Recenter on the barangay"
            onClick={recenter}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <MapPinned className="size-[18px]" strokeWidth={1.8} />
          </button>
        </div>

        <div
          ref={tooltipRef}
          className={cn(
            "pointer-events-none absolute left-0 top-0 z-[1000] whitespace-nowrap rounded-lg bg-white px-3 py-2 text-[13px] font-semibold text-neutral-900 shadow-[0_6px_20px_rgba(0,0,0,.35)]",
            hint && pointerOnMap ? "opacity-100" : "opacity-0",
          )}
        >
          {hint}
        </div>
      </div>
    </div>
  )
}
