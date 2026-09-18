import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PHILIPPINE_CITIES } from "@/features/dashboard/lib/philippine-cities"
import {
  Circle,
  MapIcon,
  MapPinned,
  Pencil,
  Pentagon,
  Plus,
  Save,
  SearchIcon,
  ShieldCheckIcon,
  Square,
  SquarePen,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import type leaflet from "leaflet"

import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  ConfigHeroAction,
  ConfigPanel,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import { cn } from "@workspace/ui/lib/utils"
import {
  getAnnouncementAreaContext,
  getMapDispatchPolicy,
  listActiveCommunities,
  searchBarangayBoundaries,
  updateBarangayBoundary,
  updateMapDispatchPolicy,
  type ActiveCommunity,
  type AnnouncementAreaContext,
  type BarangayBoundary,
  type GeoJsonPolygon,
  type LiveMapGeometry,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"

const MIN_RADIUS = 100
const MAX_RADIUS = 5000
const ZONE_COLOR = "#ff6a1a"
/** The boundary edge, in the grey the resident Home map already draws it in. */
const EDGE_COLOR = "#ffffff"
/**
 * A barangay already running as its own community. Solid rather than dashed,
 * and brighter than the edge being edited: a broken line reads as "draft", and
 * these are the one thing on this map that is not up for editing.
 */
const COMMUNITY_COLOR = "#eef2ff"
const SNAP_PX = 14
/** The policy columns are decimal(10, 7), so coordinates ship rounded. */
const COORD_PLACES = 7
/**
 * An imported barangay outline runs to hundreds of points — a large community
 * alone is 524 — and a draggable marker per point makes the map crawl. Handles
 * are drawn for the part of the edge on screen instead, so zooming in is what
 * gives you the vertex you want to move.
 */
const MAX_EDGE_HANDLES = 160

function roundCoord(value: number): number {
  return Number(value.toFixed(COORD_PLACES))
}

type Tool = "circle" | "rect" | "polygon" | "boundary" | null

/** Metres between two coordinates, good enough for a barangay-sized radius. */
function metersBetween(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const lat1 = (a[0] * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function ringToPolygon(points: [number, number][]): GeoJsonPolygon | null {
  if (points.length < 3) return null
  const ring = points.map(([lat, lng]) => [lng, lat] as [number, number])
  ring.push(ring[0]!)
  return { type: "Polygon", coordinates: [ring] }
}

function polygonToRing(geometry: GeoJsonPolygon | null): [number, number][] {
  const ring = geometry?.coordinates?.[0] ?? []
  const points = ring.map(([lng, lat]) => [lat, lng] as [number, number])
  if (
    points.length > 1 &&
    points[0]![0] === points[points.length - 1]![0] &&
    points[0]![1] === points[points.length - 1]![1]
  ) {
    points.pop()
  }
  return points
}

/**
 * The editable ring of a boundary, or `[]` when it cannot be edited safely.
 *
 * A MultiPolygon barangay is several separate parts; saving one ring back
 * would drop the rest, so those stay read-only rather than lose geography.
 */
function editableBoundaryRing(
  geometry: LiveMapGeometry | GeoJsonPolygon | null | undefined
): [number, number][] {
  if (!geometry || geometry.type !== "Polygon") return []
  const rings = geometry.coordinates as [number, number][][] | undefined
  if (!Array.isArray(rings) || rings.length !== 1) return []
  return polygonToRing(geometry as GeoJsonPolygon)
}

function dot(L: typeof leaflet, size: number, color: string = ZONE_COLOR) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};box-shadow:0 0 0 1.5px rgba(0,0,0,.45)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/**
 * Makes a drawn path draggable by its body, which Leaflet paths do not support.
 * `onMove` runs each frame with the offset, `onDrop` once on release.
 */
function dragBody(
  map: leaflet.Map,
  path: leaflet.Path,
  onMove: (dLat: number, dLng: number) => void,
  onDrop: (dLat: number, dLng: number) => void
) {
  path.on("mousedown", (event: leaflet.LeafletMouseEvent) => {
    const start = event.latlng
    let dLat = 0
    let dLng = 0
    map.dragging.disable()

    const move = (moved: leaflet.LeafletMouseEvent) => {
      dLat = moved.latlng.lat - start.lat
      dLng = moved.latlng.lng - start.lng
      onMove(dLat, dLng)
    }
    const drop = () => {
      map.off("mousemove", move)
      map.off("mouseup", drop)
      map.dragging.enable()
      if (dLat !== 0 || dLng !== 0) onDrop(dLat, dLng)
    }

    map.on("mousemove", move)
    map.on("mouseup", drop)
  })
}

function hintFor(tool: Tool, draftLength: number): string {
  if (tool === "rect") {
    return draftLength === 0
      ? "Click one corner of the zone."
      : "Click the opposite corner."
  }
  if (tool === "polygon") {
    if (draftLength === 0) return "Click to place the first point."
    if (draftLength < 3) return "Click to keep adding points."
    return "Click first point to close this shape."
  }
  if (tool === "boundary") {
    if (draftLength === 0) return "Click to start the barangay edge."
    if (draftLength < 3) return "Click to keep tracing the edge."
    return "Click first point to close the barangay edge."
  }
  if (tool === "circle") return "Click to place the centre of the zone."
  return ""
}

export default function OfficialCoverageAreaPage({ embedded = false }: { embedded?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layerRef = useRef<leaflet.LayerGroup | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const fittedRef = useRef(false)

  const [mapReady, setMapReady] = useState(false)
  const [policy, setPolicy] = useState<MapDispatchPolicy | null>(null)
  const [context, setContext] = useState<AnnouncementAreaContext | null>(null)
  const [center, setCenter] = useState<[number, number] | null>(null)
  const [radius, setRadius] = useState(800)
  const [shape, setShape] = useState<[number, number][] | null>(null)
  const [tool, setTool] = useState<Tool>(null)
  const [draft, setDraft] = useState<[number, number][]>([])
  const [pointerOnMap, setPointerOnMap] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<BarangayBoundary[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<BarangayBoundary | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customName, setCustomName] = useState("")
  const [customSubtext, setCustomSubtext] = useState("")
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false)
  const [communities, setCommunities] = useState<ActiveCommunity[]>([])
  const [home, setHome] = useState<BarangayBoundary | null>(null)
  // The edge as it is being edited. Null means "as it came from the server".
  const [edge, setEdge] = useState<[number, number][] | null>(null)
  const [edgeDirty, setEdgeDirty] = useState(false)
  // Bumped on pan and zoom so the on-screen slice of edge handles is redrawn.
  const [viewport, setViewport] = useState(0)
  // Handles and drag are off by default: a finished zone reads as a shape, not
  // as a scattering of dots. Turning edit on is what makes it adjustable.
  const [editing, setEditing] = useState(false)

  const toolRef = useRef<Tool>(null)
  const draftRef = useRef<[number, number][]>([])
  useEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const filteredCities = useMemo(() => {
    if (!customSubtext.trim()) return PHILIPPINE_CITIES.slice(0, 50)
    return PHILIPPINE_CITIES.filter((c) =>
      c.toLowerCase().includes(customSubtext.toLowerCase())
    )
  }, [customSubtext])

  /**
   * The barangay whose edge is on the map: a picked search hit, else this
   * station's own. `home` is preferred over the announcement context because
   * only it carries the row id an edit has to be saved against.
   */
  const source = picked ?? home
  const serverBoundary = useMemo(
    () => source?.geometry ?? context?.boundary?.geometry ?? null,
    [source, context]
  )
  const serverEdge = useMemo(
    () => editableBoundaryRing(serverBoundary),
    [serverBoundary]
  )
  const editableEdgeId = source?.id ?? null
  const boundary = useMemo<LiveMapGeometry | GeoJsonPolygon | null>(
    () => (edge && edge.length >= 3 ? ringToPolygon(edge) : serverBoundary),
    [edge, serverBoundary]
  )
  const barangayName = picked?.name ?? policy?.barangay ?? "—"

  useEffect(() => {
    let cancelled = false
    // An empty search answers with this station's own barangay first, and that
    // row carries the id the boundary edit is saved against.
    void searchBarangayBoundaries("")
      .then((found) => {
        if (!cancelled)
          setHome(found.find((hit) => hit.is_home) ?? found[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setHome(null)
      })
    void listActiveCommunities()
      .then((found) => {
        if (!cancelled) setCommunities(found)
      })
      .catch(() => {
        if (!cancelled) setCommunities([])
      })
    void Promise.all([
      getMapDispatchPolicy(),
      getAnnouncementAreaContext().catch(() => null),
    ])
      .then(([loaded, areaContext]) => {
        if (cancelled) return
        setPolicy(loaded)
        setContext(areaContext)
        setCenter([
          Number(loaded.acceptance_center_latitude),
          Number(loaded.acceptance_center_longitude),
        ])
        setRadius(loaded.acceptance_radius_meters)
        const ring = polygonToRing(loaded.acceptance_geometry)
        setShape(ring.length >= 3 ? ring : null)
      })
      .catch((error) => {
        if (!cancelled)
          toast.error(
            describeApiError(error, "Could not load the coverage area.")
          )
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Always goes home: back to this station's own barangay, not a picked one. */
  const recenter = useCallback(() => {
    const L = LRef.current
    const map = mapRef.current
    const back = home?.geometry ?? context?.boundary?.geometry ?? boundary
    if (!L || !map || !back) return
    setPicked(null)
    try {
      const bounds = L.geoJSON(back as never).getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32] })
    } catch {
      void 0
    }
  }, [home, context, boundary])

  const selectTool = useCallback((next: Tool) => {
    setDraft([])
    // Drawing and adjusting compete for the same clicks on the map.
    setEditing(false)
    setTool((current) => (current === next ? null : next))
  }, [])

  const undo = useCallback(() => {
    if (draftRef.current.length > 0) {
      setDraft([])
      return
    }
    // An edited edge is stepped back before the zone, so undo walks back
    // whichever change was made last rather than always dropping the zone.
    if (edgeDirty) {
      setEdge(null)
      setEdgeDirty(false)
      return
    }
    // Dropping a drawn zone hands coverage back to the circle.
    setShape(null)
  }, [edgeDirty])

  /** Takes every zone off the map — circle, square and drawn shape alike. */
  const clearZone = useCallback(() => {
    setDraft([])
    setTool(null)
    setShape(null)
    setCenter(null)
  }, [])

  // Barangay search, debounced so a keystroke does not fire a request.
  useEffect(() => {
    if (!searchOpen) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setSearching(true)
      // Drop the previous answer first, so a slow lookup never leaves the old
      // list on screen looking like the search did nothing.
      setResults([])
      void searchBarangayBoundaries(query)
        .then((found) => {
          if (!cancelled) setResults(found)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
      // Boundaries are fetched live from OSM, which is rate paced, so a typed
      // word settles before the request goes out.
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, searchOpen])

  /**
   * Names the coverage without touching the outline. Not every barangay has a
   * published boundary, so an official can label a hand-drawn zone instead of
   * being stuck with whatever the search could find.
   */
  const applyCustom = useCallback(() => {
    const name = customName.trim()
    if (!name) return
    setPicked({
      id: null,
      source: "custom",
      name,
      locality: customSubtext.trim(),
      osm_id: -1,
      is_home: false,
      geometry: null,
    })
    setCustomOpen(false)
    setSearchOpen(false)
  }, [customName, customSubtext])

  const pickBoundary = useCallback((boundaryHit: BarangayBoundary) => {
    if (!boundaryHit.geometry) {
      toast.error(`${boundaryHit.name} has no saved outline.`)
      return
    }
    setPicked(boundaryHit)
    // A different barangay is a different edge; unsaved edits to the old one
    // are not carried across onto it.
    setEdge(null)
    setEdgeDirty(false)
    setSearchOpen(false)
    fittedRef.current = false
  }, [])

  useEffect(() => {
    let cancelled = false
    let styleEl: HTMLStyleElement | null = null

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || mapRef.current) return
      LRef.current = L

      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-coverage-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #0b1020;
          font-family: inherit;
        }
        .eboses-coverage-map .leaflet-tile-pane { isolation: isolate; }
        .eboses-coverage-map img.leaflet-tile,
        .eboses-coverage-map .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-coverage-map .leaflet-interactive:focus,
        .eboses-coverage-map .leaflet-marker-icon:focus,
        .eboses-coverage-map *:focus-visible { outline: none !important; }
        .eboses-coverage-map .eboses-zone-glow { filter: drop-shadow(0 0 3px ${ZONE_COLOR}); }
        .eboses-coverage-map .eboses-community-glow {
          filter: drop-shadow(0 0 4px rgba(238, 242, 255, 0.55));
        }
        .eboses-coverage-map.eboses-drawing { cursor: crosshair; }
      `
      document.head.appendChild(styleEl)

      const map = L.map(containerRef.current, {
        center: [14.5995, 120.9842],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      })

      addBaseTiles(L, map, "dark", {
        maxZoom: 20,
        keepBuffer: 6,
        updateWhenIdle: false,
        updateWhenZooming: true,
      })

      layerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map

      map.on("click", (event: leaflet.LeafletMouseEvent) => {
        const active = toolRef.current
        if (!active) return
        const point: [number, number] = [event.latlng.lat, event.latlng.lng]

        if (active === "circle") {
          setCenter(point)
          setShape(null)
          setTool(null)
          return
        }

        const points = draftRef.current
        if (active === "rect") {
          if (points.length === 0) {
            setDraft([point])
            return
          }
          const [first] = points as [[number, number]]
          setShape([
            [first[0], first[1]],
            [first[0], point[1]],
            [point[0], point[1]],
            [point[0], first[1]],
          ])
          setDraft([])
          setTool(null)
          return
        }

        const finish = (ring: [number, number][]) => {
          if (active === "boundary") {
            setEdge(ring)
            setEdgeDirty(true)
          } else {
            setShape(ring)
          }
          setDraft([])
          setTool(null)
        }

        if (points.length >= 3) {
          const at = map.latLngToContainerPoint(event.latlng)
          const start = map.latLngToContainerPoint(points[0]!)
          if (at.distanceTo(start) <= SNAP_PX) {
            finish(points)
            return
          }
        }
        setDraft([...points, point])
      })

      map.on("dblclick", () => {
        const active = toolRef.current
        if (active !== "polygon" && active !== "boundary") return
        const points = draftRef.current
        if (points.length >= 3) {
          if (active === "boundary") {
            setEdge(points)
            setEdgeDirty(true)
          } else {
            setShape(points)
          }
        }
        setDraft([])
        setTool(null)
      })

      // Edge handles are drawn for the visible slice only, so panning and
      // zooming have to ask for a redraw.
      map.on("moveend zoomend", () => setViewport((count) => count + 1))

      map.on("mousemove", (event: leaflet.LeafletMouseEvent) => {
        const tooltip = tooltipRef.current
        if (!tooltip) return
        const at = map.latLngToContainerPoint(event.latlng)
        tooltip.style.transform = `translate(${at.x + 16}px, ${at.y - 14}px)`
      })
      map.on("mouseover", () => setPointerOnMap(true))
      map.on("mouseout", () => setPointerOnMap(false))

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
      layerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      LRef.current = null
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

  // Close city dropdown on outside click
  useEffect(() => {
    if (!cityDropdownOpen) return
    const close = () => setCityDropdownOpen(false)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [cityDropdownOpen])

  useEffect(() => {
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    container.classList.toggle("eboses-drawing", tool !== null)
  }, [tool])

  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map || !mapReady || fittedRef.current || !boundary) return
    try {
      const bounds = L.geoJSON(boundary as never).getBounds()
      if (!bounds.isValid()) return
      fittedRef.current = true
      map.fitBounds(bounds, { padding: [32, 32] })
    } catch {
      void 0
    }
  }, [boundary, mapReady])

  // How far the map travels is the zone itself. A small square used to pin the
  // floor to its own bounds, which left no room to zoom out at all, so the
  // range is measured from the zone plus the barangay around it.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map || !mapReady) return
    let bounds: leaflet.LatLngBounds | null = null
    if (shape && shape.length >= 3) bounds = L.latLngBounds(shape)
    else if (center) bounds = L.latLng(center).toBounds(radius * 2)
    if (!bounds || !bounds.isValid()) {
      // No zone, no limits — the map is free again until one is placed.
      map.setMinZoom(0)
      map.setMaxZoom(20)
      return
    }

    if (boundary) {
      try {
        const around = L.geoJSON(boundary as never).getBounds()
        if (around.isValid()) bounds = bounds.extend(around)
      } catch {
        void 0
      }
    }

    map.setMinZoom(0)
    map.setMaxZoom(20)
    const floor = map.getBoundsZoom(bounds, false)
    map.setMinZoom(Math.max(floor - 3, 0))
    map.setMaxZoom(Math.min(floor + 6, 20))
  }, [center, radius, shape, boundary, mapReady])

  useEffect(() => {
    const L = LRef.current
    const layer = layerRef.current
    const map = mapRef.current
    if (!L || !layer || !map || !mapReady) return
    layer.clearLayers()

    // Neighbouring communities go down first, so the zone being edited always
    // sits on top of them. Solid, brighter and glowing: they are the one thing
    // here that is settled, and a zone drawn across them would put two
    // stations on the same street.
    for (const community of communities) {
      if (community.is_home || !community.geometry) continue
      L.geoJSON(community.geometry as never, {
        style: {
          color: COMMUNITY_COLOR,
          weight: 1.75,
          opacity: 0.85,
          fillColor: COMMUNITY_COLOR,
          fillOpacity: 0.06,
          interactive: false,
          className: "eboses-community-glow",
        },
      })
        .addTo(layer)
        .bindTooltip(`${community.name} — active community`, {
          sticky: true,
          direction: "top",
          opacity: 1,
        })
    }

    // Nothing is grabbable while a drawing tool is armed, and nothing shows a
    // handle until edit mode is on — a finished outline should read as a
    // shape, not as a scatter of dots.
    const adjustable = editing && tool === null

    const edgeRing = edge ?? serverEdge
    const edgeStyle = {
      color: EDGE_COLOR,
      weight: 1,
      opacity: 0.35,
      dashArray: "5 7",
      fillColor: EDGE_COLOR,
      fillOpacity: 0.1,
      bubblingMouseEvents: false,
    } as const

    if (editing && edgeRing.length >= 3) {
      const editable = editableEdgeId != null
      const drawnEdge = L.polygon(edgeRing, {
        ...edgeStyle,
        opacity: edgeDirty ? 0.75 : 0.35,
        weight: edgeDirty ? 2 : 1,
        interactive: adjustable && editable,
      }).addTo(layer)

      const commitEdge = (next: [number, number][]) => {
        setEdge(next)
        setEdgeDirty(true)
      }

      if (adjustable && editable) {
        drawnEdge.bindTooltip("Drag to move the barangay edge", {
          sticky: true,
          direction: "top",
          opacity: 1,
        })
        dragBody(
          map,
          drawnEdge,
          (dLat, dLng) =>
            drawnEdge.setLatLngs(
              edgeRing.map(
                ([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]
              )
            ),
          (dLat, dLng) =>
            commitEdge(
              edgeRing.map(
                ([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]
              )
            )
        )

        // Only the vertices on screen get a handle; an imported outline holds
        // hundreds and a marker per point would stall the map.
        const view = map.getBounds().pad(0.1)
        const onScreen = edgeRing
          .map((point, index) => ({ point, index }))
          .filter(({ point }) => view.contains(point))
        const step = Math.ceil(onScreen.length / MAX_EDGE_HANDLES)
        for (const { point, index } of onScreen.filter(
          (_, at) => at % step === 0
        )) {
          const handle = L.marker(point, {
            icon: dot(L, 9, EDGE_COLOR),
            draggable: true,
          })
          const moved = (): [number, number][] => {
            const position = handle.getLatLng()
            const next = [...edgeRing]
            next[index] = [position.lat, position.lng]
            return next
          }
          handle.on("drag", () => drawnEdge.setLatLngs(moved()))
          handle.on("dragend", () => commitEdge(moved()))
          handle.addTo(layer)
        }
      }
    } else if (boundary) {
      // Shown as a plain reference outline whenever there's no active traced
      // edge to edit — including outside edit mode, so the barangay boundary
      // reads on the map without needing the pencil first. A multi-part
      // barangay cannot be edited a ring at a time, so it is drawn as it came
      // from the server.
      L.geoJSON(boundary as never, {
        style: { ...edgeStyle, interactive: false },
      }).addTo(layer)
    }

    const zoneStyle = {
      color: ZONE_COLOR,
      weight: 2,
      opacity: 0.95,
      fillColor: ZONE_COLOR,
      fillOpacity: 0.12,
      className: "eboses-zone-glow",
      // Grabbable by its body while edit mode is on and no tool is armed.
      interactive: adjustable,
      bubblingMouseEvents: false,
    } as const

    if (shape && shape.length >= 3) {
      const drawn = L.polygon(shape, zoneStyle).addTo(layer)
      const vertices: leaflet.Marker[] = []
      if (adjustable) {
        drawn.bindTooltip("Drag to move the zone", {
          sticky: true,
          direction: "top",
          opacity: 1,
        })
        dragBody(
          map,
          drawn,
          (dLat, dLng) => {
            const moved = shape.map(
              ([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]
            )
            drawn.setLatLngs(moved)
            moved.forEach((point, index) => vertices[index]?.setLatLng(point))
          },
          (dLat, dLng) => {
            setShape(
              shape.map(
                ([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]
              )
            )
          }
        )
        shape.forEach((point, index) => {
          const handle = L.marker(point, { icon: dot(L, 13), draggable: true })
          handle.on("drag", () => {
            const position = handle.getLatLng()
            const next = [...shape]
            next[index] = [position.lat, position.lng]
            drawn.setLatLngs(next)
          })
          handle.on("dragend", () => {
            const position = handle.getLatLng()
            const next = [...shape]
            next[index] = [position.lat, position.lng]
            setShape(next)
          })
          handle.addTo(layer)
          vertices.push(handle)
        })
      }
    } else if (center) {
      const zone = L.circle(center, { ...zoneStyle, radius }).addTo(layer)
      const handlePos = (at: [number, number]): [number, number] => [
        at[0],
        L.latLng(at)
          .toBounds(radius * 2)
          .getEast(),
      ]

      if (adjustable) {
        // No centre dot — the circle body itself is the drag target.
        const grip = L.marker(handlePos(center), {
          icon: dot(L, 13),
          draggable: true,
        })

        zone.bindTooltip("Drag to move the zone", {
          sticky: true,
          direction: "top",
          opacity: 1,
        })
        dragBody(
          map,
          zone,
          (dLat, dLng) => {
            const moved: [number, number] = [center[0] + dLat, center[1] + dLng]
            zone.setLatLng(moved)
            // The resize handle rides along instead of being left behind.
            grip.setLatLng(handlePos(moved))
          },
          (dLat, dLng) => setCenter([center[0] + dLat, center[1] + dLng])
        )

        grip.on("drag", () => {
          const position = grip.getLatLng()
          zone.setRadius(metersBetween(center, [position.lat, position.lng]))
        })
        grip.on("dragend", () => {
          const position = grip.getLatLng()
          const next = Math.round(
            metersBetween(center, [position.lat, position.lng])
          )
          setRadius(Math.min(Math.max(next, MIN_RADIUS), MAX_RADIUS))
        })
        grip.bindTooltip("Drag to resize the zone", {
          direction: "top",
          opacity: 1,
        })
        grip.addTo(layer)
      }
    }

    if (draft.length > 0) {
      const tracing = tool === "boundary"
      const inkColor = tracing ? EDGE_COLOR : ZONE_COLOR
      if (tool === "polygon" || tracing) {
        L.polyline(draft, {
          color: inkColor,
          weight: 2,
          className: tracing ? undefined : "eboses-zone-glow",
        }).addTo(layer)
      }
      for (const point of draft) {
        L.marker(point, {
          icon: dot(L, tracing ? 9 : 13, inkColor),
          interactive: false,
          keyboard: false,
        }).addTo(layer)
      }
    }
  }, [
    boundary,
    serverEdge,
    edge,
    edgeDirty,
    editableEdgeId,
    editing,
    viewport,
    center,
    radius,
    shape,
    draft,
    tool,
    communities,
    mapReady,
  ])

  async function save() {
    if (!center) {
      toast.error("Place a zone on the map before saving.")
      return
    }
    setSaving(true)
    try {
      const saved = await updateMapDispatchPolicy({
        acceptance_center_latitude: roundCoord(center[0]),
        acceptance_center_longitude: roundCoord(center[1]),
        acceptance_radius_meters: radius,
        acceptance_geometry: shape ? ringToPolygon(shape) : null,
        barangay: barangayName,
      })
      setPolicy(saved)

      // The edge is a different row to the policy, so it saves separately and
      // only when it was actually moved.
      const edgeGeometry = edgeDirty && edge ? ringToPolygon(edge) : null
      if (edgeGeometry && editableEdgeId != null) {
        const savedEdge = await updateBarangayBoundary(
          editableEdgeId,
          edgeGeometry
        )
        if (picked) setPicked(savedEdge)
        else setHome(savedEdge)
        setEdge(null)
        setEdgeDirty(false)
        toast.success("Coverage area and barangay edge saved")
      } else {
        if (edgeGeometry) {
          toast.warning(
            "That barangay has no saved outline to write the edge back to."
          )
        }
        toast.success("Coverage area saved")
      }
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the coverage area."))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!embedded) return
    const handle = () => void save()
    window.addEventListener("configuration-primary-action", handle)
    return () => window.removeEventListener("configuration-primary-action", handle)
  }, [embedded, save])

  const hint = hintFor(tool, draft.length)
  const tools: Array<{
    id: Exclude<Tool, null>
    label: string
    icon: typeof Circle
  }> = [
    { id: "circle", label: "Circle zone", icon: Circle },
    { id: "rect", label: "Square zone", icon: Square },
    { id: "polygon", label: "Draw a shape", icon: Pentagon },
    { id: "boundary", label: "Draw the barangay edge", icon: Pencil },
  ]

  return (
    <ConfigShell
      embedded={embedded}
      hideEmbeddedAction={embedded}
      icon={MapIcon}
      eyebrow="Operations"
      title="Coverage AREA"
      description="Set the area where your station accepts reports"
      stats={[
        {
          label: "Coverage zone",
          value: shape ? "Drawn shape" : `${radius} m radius`,
        },
        { label: "Area", value: barangayName },
      ]}
      action={
        <ConfigHeroAction onClick={() => void save()} icon={Save}>
          {saving ? "Saving…" : "Save coverage"}
        </ConfigHeroAction>
      }
    >
      <ConfigPanel>
        <div className="relative h-[460px] overflow-hidden rounded-2xl border-[1.5px] border-neutral-300 bg-ink">
          <div
            ref={containerRef}
            className="eboses-coverage-map h-full w-full"
          />

          <div
            className={cn(
              "absolute top-1/2 left-3 z-[1000] flex -translate-y-1/2 flex-col gap-1 transition-all duration-300 ease-out",
              searchOpen
                ? "pointer-events-none -translate-x-6 opacity-0"
                : "translate-x-0 opacity-100"
            )}
          >
            <button
              type="button"
              title="Search barangays"
              aria-label="Search barangays"
              onClick={() => setSearchOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <SearchIcon className="size-[18px]" strokeWidth={1.8} />
            </button>
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
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                <Icon className="size-[18px]" strokeWidth={1.8} />
              </button>
            ))}
            <button
              type="button"
              title={
                editing
                  ? "Hide the adjust handles"
                  : "Adjust what is on the map"
              }
              aria-label={
                editing
                  ? "Hide the adjust handles"
                  : "Adjust what is on the map"
              }
              aria-pressed={editing}
              onClick={() => {
                // Arming a tool and adjusting handles fight for the same
                // clicks, so turning edit on puts the drawing tools down.
                setDraft([])
                setTool(null)
                setEditing((on) => !on)
              }}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                editing
                  ? "bg-white text-neutral-900"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <SquarePen className="size-[18px]" strokeWidth={1.8} />
            </button>
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
              title="Clear the zone"
              aria-label="Clear the zone"
              onClick={clearZone}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Trash2 className="size-[18px]" strokeWidth={1.8} />
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
            className={cn(
              "absolute top-3 bottom-3 left-3 z-[1000] flex w-[min(320px,calc(100%-24px))] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_10px_30px_rgba(0,0,0,.45)] transition-all duration-300 ease-out",
              searchOpen
                ? "translate-x-0 opacity-100"
                : "pointer-events-none -translate-x-4 opacity-0"
            )}
          >
            <div className="flex items-center gap-2 border-b border-neutral-200 p-3">
              <SearchIcon
                className="size-4 shrink-0 text-neutral-400"
                strokeWidth={2}
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search barangays"
                aria-label="Search barangays"
                className="min-w-0 flex-1 bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                title="Close search"
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>

            <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto py-1">
              {searching ? (
                <p className="px-4 py-3 text-[13px] text-neutral-500">
                  Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-neutral-500">
                  {query.trim().length < 3
                    ? "Type at least three letters to search."
                    : "No barangay outline matches that."}
                </p>
              ) : (
                results.map((hit) => {
                  const on = picked?.osm_id === hit.osm_id
                  return (
                    <button
                      key={`${hit.source}-${hit.osm_id}`}
                      type="button"
                      onClick={() => pickBoundary(hit)}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-neutral-100",
                        on
                          ? "font-semibold text-brand-navy"
                          : "text-neutral-900"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {hit.name}
                      </span>
                      <span className="shrink-0 text-[11px] tracking-wide text-neutral-400 uppercase">
                        {hit.is_home ? "Current" : (hit.locality ?? "")}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="border-t border-neutral-200 p-3">
              {customOpen ? (
                <div className="grid gap-2">
                  <input
                    type="text"
                    value={customName}
                    onChange={(event) => setCustomName(event.target.value)}
                    placeholder="Area"
                    aria-label="Custom area name"
                    className="w-full rounded-lg border-[1.5px] border-neutral-200 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-neutral-400"
                  />
                  <div className="relative">
                    <input
                      type="text"
                      value={customSubtext}
                      onChange={(event) => setCustomSubtext(event.target.value)}
                      onFocus={() => setCityDropdownOpen(true)}
                      placeholder="City"
                      aria-label="Custom area subtext"
                      className="w-full rounded-lg border-[1.5px] border-neutral-200 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-neutral-400"
                    />
                    {cityDropdownOpen && filteredCities.length > 0 && (
                      <ul className="absolute top-full right-0 left-0 z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
                        {filteredCities.map((city) => (
                          <li key={city}>
                            <button
                              type="button"
                              onClick={() => {
                                setCustomSubtext(city)
                                setCityDropdownOpen(false)
                              }}
                              className="w-full px-3 py-2 text-left text-[13px] hover:bg-neutral-100"
                            >
                              {city}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomOpen(false)}
                      className="rounded-lg px-3 py-2 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyCustom}
                      disabled={!customName.trim()}
                      className={cn(
                        "flex-1 rounded-lg bg-brand-navy px-3 py-2 text-[13px] font-semibold text-white transition-colors",
                        customName.trim() ? "hover:bg-accent" : "opacity-40"
                      )}
                    >
                      Create area
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setCustomName(query.trim())
                    setCustomOpen(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] font-semibold text-brand-navy transition-colors hover:bg-neutral-100"
                >
                  <Plus className="size-4 shrink-0" strokeWidth={2.2} />
                  Add a custom area name
                </button>
              )}
            </div>
          </div>

          <div
            ref={tooltipRef}
            className={cn(
              "pointer-events-none absolute top-0 left-0 z-[1000] rounded-lg bg-white px-3 py-2 text-[13px] font-semibold whitespace-nowrap text-neutral-900 shadow-[0_6px_20px_rgba(0,0,0,.35)]",
              hint && pointerOnMap ? "opacity-100" : "opacity-0"
            )}
          >
            {hint}
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-neutral-500">
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-neutral-400" strokeWidth={2} />
          <span>Reports are only accepted within this coverage area.</span>
        </p>
      </ConfigPanel>
    </ConfigShell>
  )
}
