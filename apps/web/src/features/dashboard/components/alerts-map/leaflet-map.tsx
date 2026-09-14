import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FootprintsIcon, HomeIcon, LocateFixedIcon } from "lucide-react"
import { toast } from "sonner"

import { type LiveMapSnapshot } from "@/features/dashboard/api"
import {
  drawRoute,
  routeRenderGeometry,
} from "@/features/dashboard/lib/route-line"
import {
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import {
  StreetViewModal,
  startStreetViewPick,
  type StreetViewCoord,
} from "@/features/dashboard/components/map/street-view"
import {
  geoJsonToRing,
  polygonCentroid,
} from "@/features/dashboard/components/community-content/area-lib"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryGlyphHtml,
  advisoryLabel,
  advisoryMarkerHtml,
} from "@/features/dashboard/components/community-content/advisory-tags"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import {
  announcementSummary,
  announcementTitle,
} from "@/features/dashboard/lib/announcement-summary"
import type { GeoJsonPolygon } from "@/features/dashboard/api"
import {
  concernGlyph,
  dotPinHtml,
  glyphPinHtml,
  glyphPinSize,
  GLYPHS,
} from "@/features/dashboard/components/map/markers"
import { escapeHtml } from "@/features/dashboard/components/map/concern-marker"
import { lucideIconPaths } from "@/features/dashboard/components/map/lucide-glyphs"
import {
  type MapTip,
  bindHoverCard,
  closeHoverCardsOnLeave,
  makeHoverCard,
  mapTipKey,
  openHoverCard,
} from "@/features/dashboard/components/map/photo-tooltip"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  type LayerKey,
  type Selection,
  type StreetLine,
  advisoryDoneColor,
  geoJsonToLines,
  joinLineRuns,
  isMapDrawableConcern,
  isResolvedRecord,
  isActiveEmergency,
  OFFICIAL_MAP_COLORS as MAP_COLORS,
  validCoord,
} from "./lib"

import type leaflet from "leaflet"

const ICON_CACHE = new Map<string, leaflet.DivIcon>()

function cachedIcon(
  L: typeof leaflet,
  key: string,
  box: number,
  build: () => string
) {
  const hit = ICON_CACHE.get(key)
  if (hit) return hit
  const icon = L.divIcon({
    className: "",
    html: build(),
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
  })
  ICON_CACHE.set(key, icon)
  return icon
}

type MarkerSpec = {
  key: string
  coord: leaflet.LatLngTuple
  iconKey: string
  box: number
  html: () => string
  z: number
  tip?: MapTip | null
  onClick?: () => void
}

type MarkerEntry = {
  marker: leaflet.Marker
  iconKey: string
  lat: number
  lng: number
  z: number
  tipKey: string
}

function syncMarkers(
  L: typeof leaflet,
  map: leaflet.Map,
  group: leaflet.LayerGroup,
  entries: Map<string, MarkerEntry>,
  next: MarkerSpec[]
) {
  const seen = new Set<string>()
  for (const spec of next) {
    seen.add(spec.key)
    const [lat, lng] = spec.coord
    const tip = spec.tip || null
    const tipKey = mapTipKey(tip)
    const existing = entries.get(spec.key)
    if (!existing) {
      const marker = L.marker(spec.coord, {
        icon: cachedIcon(L, spec.iconKey, spec.box, spec.html),
        zIndexOffset: spec.z,
      })
      if (spec.onClick) marker.on("click", spec.onClick)
      bindHoverCard(L, map, marker, tip, spec.box)
      marker.addTo(group)
      entries.set(spec.key, {
        marker,
        iconKey: spec.iconKey,
        lat,
        lng,
        z: spec.z,
        tipKey,
      })
      continue
    }
    if (existing.lat !== lat || existing.lng !== lng) {
      existing.marker.setLatLng(spec.coord)
      existing.lat = lat
      existing.lng = lng
    }
    if (existing.iconKey !== spec.iconKey) {
      existing.marker.setIcon(cachedIcon(L, spec.iconKey, spec.box, spec.html))
      existing.iconKey = spec.iconKey
    }
    if (existing.z !== spec.z) {
      existing.marker.setZIndexOffset(spec.z)
      existing.z = spec.z
    }
    if (existing.tipKey !== tipKey) {
      bindHoverCard(L, map, existing.marker, tip, spec.box)
      existing.tipKey = tipKey
    }
  }
  for (const [key, entry] of entries) {
    if (seen.has(key)) continue
    group.removeLayer(entry.marker)
    entries.delete(key)
  }
}

function AlertsLeafletMapInner({
  snapshot,
  layers,
  selected,
  selectedStreetNames,
  onSelect,
  onMapInteract,
}: {
  snapshot: LiveMapSnapshot
  layers: Record<LayerKey, boolean>
  selected: Selection
  selectedStreetNames: Set<string>
  onSelect: (selection: Selection) => void
  onMapInteract?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  // Mount-time values for the one-shot map construction effect. Reading them
  // through refs keeps that effect stable while still seeing the props the
  // page loaded with.
  const initialSnapshotRef = useRef(snapshot)
  /**
   * Two groups, not one.
   *
   * Alerts (concerns, emergencies, routes, streets) change when someone files
   * or resolves something — rarely. People move constantly: every signed-in
   * device pings its location every 30s. Sharing one group meant a single
   * location ping ran `clearLayers()` and rebuilt every concern pin, every
   * emergency pin, every route polyline and every street line on the map.
   */
  const alertLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const alertMarkersRef = useRef<Map<string, MarkerEntry>>(new Map())
  const onSelectRef = useRef(onSelect)
  const onMapInteractRef = useRef(onMapInteract)
  const streetLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const routeLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const advisoryLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const advisoryRoadsRef = useRef<
    Map<
      number,
      {
        roads: Array<{ flow: leaflet.Polyline }>
        wide: string | null
      }
    >
  >(new Map())
  const svgRendererRef = useRef<leaflet.SVG | null>(null)
  const advisoryFallbackAnchorsRef = useRef(
    new Map<number, leaflet.LatLngTuple>()
  )
  const highlightGroupRef = useRef<leaflet.LayerGroup | null>(null)
  const hoverIdRef = useRef<number | null>(null)
  const focusIdRef = useRef<number | null>(null)
  const boundaryRef = useRef<leaflet.GeoJSON | null>(null)
  const myLocationRef = useRef<leaflet.Marker | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  // Advisory pin hover/focus: dimmed roads at rest; on focus the advisory's
  // roads go full-strength and a barangay-wide advisory fills the boundary.
  const applyAdvisoryFocus = useCallback(
    (id: number | null) => {
      const L = LRef.current
      const highlight = highlightGroupRef.current
      if (!L || !highlight) return
      highlight.clearLayers()
      for (const [key, entry] of advisoryRoadsRef.current) {
        const strong = id != null && key === id
        for (const { flow } of entry.roads) {
          flow.setStyle({ opacity: strong ? 1 : 0.9 })
        }
      }
      const entry = id != null ? advisoryRoadsRef.current.get(id) : null
      if (entry?.wide) {
        const geometry = snapshot.map.boundary.geometry as GeoJsonPolygon | null
        const ring = geometry ? geoJsonToRing(geometry) : []
        if (ring.length >= 3) {
          L.polygon(ring, {
            stroke: false,
            fillColor: entry.wide,
            fillOpacity: 0.15,
            interactive: false,
          }).addTo(highlight)
        }
      }
    },
    [snapshot.map.boundary.geometry]
  )
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  useEffect(() => {
    onMapInteractRef.current = onMapInteract
  }, [onMapInteract])
  // Whether the view has been framed against a container that actually had
  // a size. Guards the one-time re-fit in the ResizeObserver below.
  const framedRef = useRef(false)
  // Set once the async Leaflet import + map construction finishes. Every
  // layer effect depends on it; without it they run against a null map on
  // first paint, bail, and never re-run -- which is why the boundary,
  // acceptance zone and legend layers intermittently never appeared.
  const [mapReady, setMapReady] = useState(false)
  const [locating, setLocating] = useState(false)
  const [svPick, setSvPick] = useState(false)
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)
  const streetViewWasOpenRef = useRef(false)

  useEffect(() => {
    if (svCoord) {
      streetViewWasOpenRef.current = true
      return
    }
    if (!streetViewWasOpenRef.current) return
    streetViewWasOpenRef.current = false

    let firstFrame = 0
    let secondFrame = 0
    const repaintMap = () => {
      const map = mapRef.current
      if (!map) return
      map.invalidateSize({ animate: false })
      map.setZoom(map.getZoom(), { animate: false })
    }
    firstFrame = requestAnimationFrame(() => {
      repaintMap()
      secondFrame = requestAnimationFrame(repaintMap)
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [svCoord])

  const streetLines = useMemo<StreetLine[]>(() => {
    return snapshot.map.streets.streets.flatMap((street) =>
      (street.geometries ?? []).flatMap((geometry) =>
        geoJsonToLines(geometry).map((line) => ({ name: street.name, line }))
      )
    )
  }, [snapshot.map.streets.streets])

  function goHomeOnMap() {
    const map = mapRef.current
    if (!map) return
    const boundary = boundaryRef.current
    if (boundary) {
      map.fitBounds(boundary.getBounds(), { padding: [18, 18], animate: true })
      return
    }
    map.setView(
      [snapshot.map.center.latitude, snapshot.map.center.longitude],
      snapshot.map.center.zoom,
      {
        animate: true,
      }
    )
  }

  useEffect(() => {
    if (!svPick) return
    const map = mapRef.current
    if (!map) return
    const cleanup = startStreetViewPick(map, {
      onPick: (coord) => {
        setSvPick(false)
        setSvCoord(coord)
      },
      onCancel: () => setSvPick(false),
    })
    return cleanup
  }, [svPick, mapReady])

  function openStreetViewAtPin() {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    let lat = center.lat
    let lng = center.lng
    if (selected?.kind === "concern") {
      const coord = validCoord(
        snapshot.concerns.find((c) => c.id === selected.id)?.latitude,
        snapshot.concerns.find((c) => c.id === selected.id)?.longitude
      )
      if (coord) [lat, lng] = coord
    } else if (selected?.kind === "emergency") {
      const coord = validCoord(
        snapshot.emergencies.find((e) => e.id === selected.id)?.latitude,
        snapshot.emergencies.find((e) => e.id === selected.id)?.longitude
      )
      if (coord) [lat, lng] = coord
    }
    setSvCoord({ lat, lng })
  }

  function goToCurrentLocation() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) {
      toast.error("Current location is not available on this device.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const L = LRef.current
        map.setView(
          [coords.latitude, coords.longitude],
          Math.max(map.getZoom(), 17),
          {
            animate: true,
          }
        )
        // Drop a marker. Without one the button just moved the viewport, which
        // is indistinguishable from it having done nothing.
        if (L) {
          if (myLocationRef.current) map.removeLayer(myLocationRef.current)
          myLocationRef.current = L.marker(
            [coords.latitude, coords.longitude],
            {
              icon: L.divIcon({
                className: "",
                html: dotPinHtml({
                  color: MAP_COLORS.you,
                  size: 14,
                  live: true,
                }),
                iconSize: [14, 14],
                iconAnchor: [7, 7],
              }),
              zIndexOffset: 1200,
              // This is a passive position marker, not a report. It should
              // never open a hover affordance or capture pointer interaction.
              interactive: false,
            }
          ).addTo(map)
        }
        toast.success(`You are here, within ${Math.round(coords.accuracy)} m`)
        setLocating(false)
      },
      (error) => {
        // Each failure needs a different action from the official, so they get
        // different messages rather than one generic "unable to read".
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location is blocked. Allow it for this site in your browser's address bar, then try again."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your device could not get a fix. Move somewhere with a clearer view of the sky."
              : "Finding your location took too long. Try again."
        toast.error(message)
        setLocating(false)
      },
      // `maximumAge: 0` forces a fresh fix. The previous 30s cache is why the
      // button kept returning the same stale position on repeated presses.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    )
  }

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null
    let styleEl: HTMLStyleElement | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      LRef.current = L

      // Same fix as the AreaPicker/pin maps: the tile-size override has to
      // exist in <head> before Leaflet lays out its tile pane, or the 256px
      // tiles collapse under Tailwind Preflight's `img { max-width: 100% }`
      // and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .eboses-map-light.leaflet-container {
          width: 100%;
          height: 100%;
          font-family: inherit;
        }
        .eboses-map-light.leaflet-container {
          background: #e8f5f0;
        }
        .eboses-map-light .leaflet-tile-pane { isolation: isolate; }
        .eboses-map-light img.leaflet-tile,
        .eboses-map-light .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-map-light .leaflet-tooltip-pane {
          z-index: 2000 !important;
        }
        .eboses-map-light .leaflet-tooltip {
          background: #ffffff;
          border: 1px solid #dfe4ec;
          color: #14203c;
          font-size: 12px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 6px;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16);
        }
        .eboses-map-light .leaflet-tooltip::before {
          border-top-color: #ffffff;
        }
        .eboses-map-light .eboses-official-responder-tip {
          min-width: 82px;
          padding: 7px 9px;
          text-align: center;
        }
        .eboses-map-light .eboses-official-responder-tip__content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .eboses-map-light .eboses-official-responder-tip__avatar {
          display: grid;
          width: 28px;
          height: 28px;
          place-items: center;
          border: 2px solid #dbeafe;
          border-radius: 9999px;
          background: #2563eb;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.02em;
          line-height: 1;
        }
        .eboses-map-light .eboses-official-responder-tip__name {
          max-width: 150px;
          overflow: hidden;
          color: #14203c;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .eboses-map-light .eboses-pin--dot .eboses-pin__halo {
          opacity: 0.2;
          animation: eboses-pin-halo-quiet 2.6s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes eboses-pin-halo-quiet {
          0% {
            transform: scale(1);
            opacity: 0.2;
          }
          70%,
          100% {
            transform: scale(1.45);
            opacity: 0;
          }
        }
        .eboses-map-light .eboses-pin--dot.is-live .eboses-pin__core {
          animation: eboses-pin-blink-quiet 2.6s ease-in-out infinite;
        }
        .eboses-alerts-corridor-flow {
          animation: eboses-corridor-flow 1.1s linear infinite;
        }
        @keyframes eboses-corridor-flow {
          to {
            stroke-dashoffset: -14;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .eboses-alerts-corridor-flow {
            animation: none;
          }
        }
        @keyframes eboses-pin-blink-quiet {
          0%,
          100% {
            box-shadow: 0 0 0 0 var(--pin);
          }
          50% {
            box-shadow: 0 0 3px 1px var(--pin);
          }
        }
      `
      document.head.appendChild(styleEl)

      map = L.map(containerRef.current, {
        center: [
          initialSnapshotRef.current.map.center.latitude,
          initialSnapshotRef.current.map.center.longitude,
        ],
        zoom: initialSnapshotRef.current.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      containerRef.current.classList.add("eboses-map-light")
      addBaseTiles(L, map, "light")
      streetLayersRef.current = L.layerGroup().addTo(map)
      // Hover-only barangay fill: sits beneath every advisory road/marker.
      highlightGroupRef.current = L.layerGroup().addTo(map)
      advisoryLayersRef.current = L.layerGroup().addTo(map)
      routeLayersRef.current = L.layerGroup().addTo(map)
      alertLayersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      closeHoverCardsOnLeave(map)

      const notifyInteract = () => onMapInteractRef.current?.()
      map.on("dragstart", notifyInteract)
      map.on("zoomstart", notifyInteract)
      map.on("click", notifyInteract)
      // Leaflet measures the container exactly once, at construction. On
      // mobile this page mounts before the flex chain has resolved a height,
      // so the map was built against a 0px box and never painted a single
      // tile -- the "plain navy background" on phones. A single rAF
      // invalidateSize still fired too early. Re-measure on every box change
      // instead, which also covers rotation and the address bar collapsing.
      const observer = new ResizeObserver(() => {
        const current = mapRef.current
        if (!current) return
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.height || !box.width) return
        current.invalidateSize({ animate: false })
        // Re-frame the barangay the first time the box gains real height,
        // otherwise the view keeps the centre it computed while collapsed.
        if (!framedRef.current) {
          framedRef.current = true
          const boundary = boundaryRef.current
          if (boundary)
            current.fitBounds(boundary.getBounds(), { padding: [14, 14] })
        }
      })
      observer.observe(containerRef.current)
      resizeObserverRef.current = observer

      requestAnimationFrame(() => map?.invalidateSize())
      if (!cancelled) setMapReady(true)
    }

    const alertMarkers = alertMarkersRef.current

    void init()
    return () => {
      cancelled = true
      alertMarkers.clear()
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      framedRef.current = false
      styleEl?.remove()
      map?.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [])

  // The edge is built from whatever geometry the snapshot currently holds, not
  // from the one captured at mount. That is what lets the map paint before the
  // first snapshot lands, and what makes an official's boundary edit show up
  // here without a reload.
  const boundaryGeometry = snapshot.map.boundary.geometry ?? null
  const mapViewKey = [
    snapshot.map.boundary.osm_relation_id ?? "none",
    snapshot.map.boundary.name,
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
  ].join(":")
  const previousMapViewKeyRef = useRef<string | null>(null)
  const boundaryFittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    const mapViewChanged = previousMapViewKeyRef.current !== mapViewKey
    previousMapViewKeyRef.current = mapViewKey
    if (boundaryRef.current) {
      map.removeLayer(boundaryRef.current)
      boundaryRef.current = null
    }
    if (!boundaryGeometry) {
      if (mapViewChanged) {
        map.setView(
          [snapshot.map.center.latitude, snapshot.map.center.longitude],
          snapshot.map.center.zoom,
          {
            animate: true,
          }
        )
      }
      return
    }
    const layer = L.geoJSON(
      boundaryGeometry as Parameters<typeof L.geoJSON>[0],
      {
        style: {
          // Keep the boundary geometry available for framing, but do not show
          // a barangay outline/fill as a visual hint on the alerts map.
          stroke: false,
          fillColor: "#f97316",
          fillOpacity: 0,
        },
        interactive: false,
      }
    )
    boundaryRef.current = layer
    if (layers.boundary) layer.addTo(map)
    if (mapViewChanged || !boundaryFittedRef.current) {
      const bounds = layer.getBounds()
      if (bounds.isValid()) {
        boundaryFittedRef.current = true
        map.fitBounds(bounds, { padding: [18, 18] })
      }
    }
    // layers.boundary is handled by the toggle effect below; keeping it out of
    // here stops a checkbox from rebuilding a few-hundred-point polygon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    boundaryGeometry,
    mapReady,
    mapViewKey,
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
    snapshot.map.center.zoom,
  ])

  useEffect(() => {
    const map = mapRef.current
    const boundary = boundaryRef.current
    if (!map || !boundary) return
    if (layers.boundary && !map.hasLayer(boundary)) boundary.addTo(map)
    if (!layers.boundary && map.hasLayer(boundary)) map.removeLayer(boundary)
  }, [layers.boundary, boundaryGeometry, mapReady])

  // Streets are reference geometry: hundreds of polylines that change only when
  // the OSM catalog does. They own their own group so a location ping or a
  // selection can never rebuild them.
  useEffect(() => {
    const L = LRef.current
    const group = streetLayersRef.current
    if (!L || !group) return
    group.clearLayers()
    if (!layers.streets) return
    for (const { name, line } of streetLines) {
      const selectedStreet = selectedStreetNames.has(name)
      if (selectedStreetNames.size && !selectedStreet) continue
      L.polyline(line, {
        color: selectedStreet ? MAP_COLORS.concern : MAP_COLORS.structure,
        opacity: selectedStreet ? 0.9 : 0.28,
        weight: selectedStreet ? 3 : 1.2,
      }).addTo(group)
    }
  }, [layers.streets, selectedStreetNames, streetLines, mapReady])

  // Routes follow their emergency: there is no separate Routes toggle, because a
  // journey with no incident on the map means nothing. The route to the selected
  // incident is drawn at full weight and the rest are dimmed.
  useEffect(() => {
    const L = LRef.current
    const group = routeLayersRef.current
    if (!L || !group) return
    group.clearLayers()
    if (!layers.concerns) return

    const byId = new Map(snapshot.emergencies.map((item) => [item.id, item]))
    const liveAlertIds = new Set(
      snapshot.emergencies
        .filter(isActiveEmergency)
        .map((emergency) => emergency.id)
    )
    const focusId = selected?.kind === "emergency" ? selected.id : null

    for (const route of snapshot.routes) {
      if (route.status === "unavailable" || !route.geometry) continue
      const incident = byId.get(route.alert_id)
      if (!incident) continue
      const live = liveAlertIds.has(route.alert_id)
      const focused = focusId === route.alert_id
      const { road, approach, connectors } = routeRenderGeometry(route, {
        destination: validCoord(incident.latitude, incident.longitude),
      })
      drawRoute(L, group, {
        road,
        approach,
        connectors,
        live,
        weight: focused ? 8 : 5,
        dim: focusId != null && !focused,
      })
    }
  }, [
    snapshot.routes,
    snapshot.emergencies,
    layers.concerns,
    selected?.kind,
    selected?.id,
    mapReady,
  ])

  // Advisory areas: the same street corridors the Community tab publishes, not
  // a shape invented for the map. An advisory with no corridor (one street, or
  // none) highlights its street lines instead of drawing an arbitrary blob.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const group = advisoryLayersRef.current
    if (!L || !map || !group) return
    group.clearLayers()
    advisoryRoadsRef.current.clear()
    highlightGroupRef.current?.clearLayers()
    hoverIdRef.current = null
    focusIdRef.current = null
    if (!layers.advisories) return
    const nowMs = snapshot.generated_at
      ? Date.parse(snapshot.generated_at)
      : undefined

    const bindAdvisoryFocus = (
      id: number,
      marker: leaflet.Marker,
      tip?: MapTip | null
    ) => {
      const card = makeHoverCard(L, tip, 26)
      marker.on("mouseover", () => {
        hoverIdRef.current = id
        applyAdvisoryFocus(id)
        if (card) openHoverCard(map, card, marker)
      })
      marker.on("mouseout", () => {
        hoverIdRef.current = null
        applyAdvisoryFocus(focusIdRef.current)
      })
      const icon = marker.getElement()
      if (icon) {
        icon.addEventListener("focus", () => {
          focusIdRef.current = id
          applyAdvisoryFocus(id)
        })
        icon.addEventListener("blur", () => {
          focusIdRef.current = null
          applyAdvisoryFocus(hoverIdRef.current)
        })
      }
    }

    for (const advisory of snapshot.advisories ?? []) {
      const tagColor = advisoryDoneColor(
        advisory,
        ANNOUNCEMENT_ACCENT.color,
        nowMs
      )
      const ring = geoJsonToRing(advisory.area_geometry)
      const streetRuns = joinLineRuns(
        (advisory.street_geometries ?? []).flatMap(geoJsonToLines)
      )
      if (ring.length >= 3 && streetRuns.length === 0) {
        L.polygon(ring, {
          stroke: false,
          fillColor: tagColor,
          fillOpacity: 0.16,
          interactive: false,
        }).addTo(group)
        const centroid = polygonCentroid(advisory.area_geometry)
        if (centroid) {
          const marker = L.marker(centroid, {
            icon: L.divIcon({
              className: "",
              html: advisoryMarkerHtml(
                advisory.tag,
                26,
                "light",
                false,
                tagColor
              ),
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
            keyboard: true,
          }).addTo(group)
          bindAdvisoryFocus(advisory.id, marker, {
            image: advisory.image_url,
            eyebrow: advisoryLabel(advisory.tag),
            eyebrowColor: ANNOUNCEMENT_ACCENT.color,
            badgeSvg: advisoryGlyphHtml(advisory.tag, 18),
            title: announcementTitle(advisory),
            excerpt: advisory.body,
            summary: announcementSummary(advisory),
            date: advisory.starts_at ?? advisory.expires_at,
          })
        }
        continue
      }
      const roads: Array<{ flow: leaflet.Polyline }> = []
      if (!svgRendererRef.current)
        svgRendererRef.current = L.svg({ padding: 0.5 })
      const svgRenderer = svgRendererRef.current
      const drawCorridor = (run: leaflet.LatLngTuple[]) => {
        const flow = L.polyline(run, {
          color: tagColor,
          weight: 4,
          opacity: 0.9,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "7 7",
          className: "eboses-alerts-corridor-flow",
          interactive: false,
          renderer: svgRenderer,
        }).addTo(group)
        roads.push({ flow })
      }
      let anchor: leaflet.LatLngTuple | null = null
      let anchorLat = 0
      let anchorLng = 0
      let anchorPointCount = 0
      for (const line of streetRuns) {
        drawCorridor(line)
        for (const point of line) {
          anchorLat += point[0]
          anchorLng += point[1]
          anchorPointCount += 1
        }
      }
      if (anchorPointCount > 0) {
        anchor = [anchorLat / anchorPointCount, anchorLng / anchorPointCount]
      }
      if (!anchor) {
        // Keep barangay-wide notices visible. Cache the fallback coordinate
        // per announcement: its map center can change when a community is
        // selected, but an existing pin must not jump with that rerender.
        anchor = advisoryFallbackAnchorsRef.current.get(advisory.id) ?? null
        if (!anchor) {
          const slot = Math.abs(advisory.id) % 8
          const angle = (slot * Math.PI) / 4
          anchor = [
            snapshot.map.center.latitude + Math.sin(angle) * 0.00012,
            snapshot.map.center.longitude + Math.cos(angle) * 0.00012,
          ]
          advisoryFallbackAnchorsRef.current.set(advisory.id, anchor)
        }
        const marker = L.marker(anchor, {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(
              advisory.tag,
              26,
              "light",
              false,
              tagColor
            ),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          keyboard: true,
        }).addTo(group)
        bindAdvisoryFocus(advisory.id, marker, {
          image: advisory.image_url,
          eyebrow: advisoryLabel(advisory.tag),
          eyebrowColor: ANNOUNCEMENT_ACCENT.color,
          badgeSvg: advisoryGlyphHtml(advisory.tag, 18),
          title: announcementTitle(advisory),
          excerpt: advisory.body,
          summary: announcementSummary(advisory),
          date: advisory.starts_at ?? advisory.expires_at,
        })
        advisoryRoadsRef.current.set(advisory.id, { roads: [], wide: tagColor })
      } else {
        const marker = L.marker(anchor, {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(
              advisory.tag,
              26,
              "light",
              false,
              tagColor
            ),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          zIndexOffset: 600,
          keyboard: true,
        }).addTo(group)
        bindAdvisoryFocus(advisory.id, marker, {
          image: advisory.image_url,
          eyebrow: advisoryLabel(advisory.tag),
          eyebrowColor: ANNOUNCEMENT_ACCENT.color,
          badgeSvg: advisoryGlyphHtml(advisory.tag, 18),
          title: announcementTitle(advisory),
          excerpt: advisory.body,
          summary: announcementSummary(advisory),
          date: advisory.starts_at ?? advisory.expires_at,
        })
        if (roads.length > 0)
          advisoryRoadsRef.current.set(advisory.id, { roads, wide: null })
      }
    }
  }, [
    snapshot.advisories,
    snapshot.generated_at,
    layers.advisories,
    mapReady,
    snapshot.map.boundary.geometry,
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
    applyAdvisoryFocus,
  ])

  // Incident pins. Deps are the individual snapshot slices rather than the
  // snapshot object, so a location ping (which only replaces `people`) leaves
  // all of this mounted.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const group = alertLayersRef.current
    if (!L || !map || !group) return

    const specs: MarkerSpec[] = []

    if (layers.concerns) {
      for (const concern of snapshot.concerns) {
        // The snapshot keeps closed records so an open detail panel does not
        // blank out when its subject resolves; the map only ever draws open ones.
        const concernResolved = isResolvedRecord(concern)
        if (!isMapDrawableConcern(concern)) continue
        const coord = validCoord(concern.latitude, concern.longitude)
        if (!coord) continue
        const focused =
          selected?.kind === "concern" && selected.id === concern.id
        const box = glyphPinSize(26, focused)
        const concernCritical =
          (concern.severity ?? concern.priority ?? "").toLowerCase() ===
          "critical"
        const color = concernCritical
          ? MAP_COLORS.emergency
          : concernResolved
            ? MAP_COLORS.resolved
            : MAP_COLORS.concern
        // Critical concerns always use the red alert pin, even though they are
        // normal reports and not SOS emergencies. Other concerns keep the
        // report's own icon priority: image > custom label > picked icon > glyph.
        const categoryRef = concern.category_ref
        const content =
          !concernCritical && !concernResolved && categoryRef?.icon_image_url
            ? `<img src="${escapeHtml(categoryRef.icon_image_url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:9999px" />`
            : !concernCritical && !concernResolved && categoryRef?.custom_icon_label?.trim()
              ? `<span style="font-size:${Math.round(box * 0.42)}px;font-weight:700;line-height:1">${escapeHtml(categoryRef.custom_icon_label.trim().slice(0, 2).toUpperCase())}</span>`
              : undefined
        const paths = concernCritical
          ? GLYPHS.emergency
          : concernResolved
            ? (lucideIconPaths("check") ?? concernGlyph(concern.category))
            : ((categoryRef?.icon_key
                ? lucideIconPaths(categoryRef.icon_key)
                : null) ?? concernGlyph(concern.category))
        specs.push({
          key: `concern-${concern.id}`,
          coord,
          iconKey: `concern:${concernCritical ? "critical" : concernResolved ? "resolved" : `${concern.category}:${categoryRef?.icon_key ?? ""}:${categoryRef?.icon_image_url ?? ""}:${categoryRef?.custom_icon_label ?? ""}`}:${color}:${box}`,
          box,
          html: () =>
            glyphPinHtml({
              paths,
              content,
              color,
              selected: focused,
              tone: "light",
              tint: true,
              hoverGrow: true,
            }),
          z: focused ? 700 : 200,
          tip: {
            image: concern.preview_url,
            resolutionImage: concern.resolution_preview_url,
            resolutionCount: concern.resolution_photo_count,
            resolved: concernResolved,
            resolvedAt: concern.updated_at,
            title: concern.notification_subject || concern.title,
            reporterName: concern.reporter?.full_name,
            meta:
              streetSegment(concern.address) ||
              streetSegment(concern.barangay) ||
              undefined,
            description: concern.description,
            summary: concern.summary,
            severity: concern.severity ?? concern.priority,
            date: concern.created_at,
          },
          onClick: () =>
            onSelectRef.current({ kind: "concern", id: concern.id }),
        })
      }
    }

    if (layers.concerns) {
      for (const emergency of snapshot.emergencies) {
        // Same rule as concerns: a settled emergency must not keep drawing a
        // pulsing alarm pin. "Settled" is anything not active — resolved,
        // closed, cancelled, false alarm, invalid — not just the literal
        // "resolved" status, which used to leave those other end-states red.
        const emergencySettled = !isActiveEmergency(emergency)
        const coord = validCoord(emergency.latitude, emergency.longitude)
        if (!coord) continue
        const focused =
          selected?.kind === "emergency" && selected.id === emergency.id
        const box = glyphPinSize(28, focused)
        const color = emergencySettled
          ? MAP_COLORS.resolved
          : MAP_COLORS.emergency
        specs.push({
          key: `emergency-${emergency.id}`,
          coord,
          iconKey: `emergency:${emergencySettled ? "resolved" : "live"}:${color}:${box}`,
          box,
          html: () =>
            glyphPinHtml({
              paths: GLYPHS.emergency,
              color,
              size: 28,
              selected: focused,
              tone: "light",
              tint: true,
              hoverGrow: true,
            }),
          z: focused ? 800 : 400,
          tip: {
            title: `There is an ongoing ${emergency.type.replaceAll("_", " ")} around ${
              emergency.address?.trim() ||
              emergency.barangay?.trim() ||
              "the reported area"
            }`,
            excerpt:
              emergency.display_description ||
              emergency.ai_summary ||
              emergency.note,
            excerptLabel:
              emergency.display_description || emergency.ai_summary
                ? null
                : emergency.note
                  ? "Resident report"
                  : null,
            severity: "critical",
            date: emergency.created_at,
          },
          onClick: () =>
            onSelectRef.current({ kind: "emergency", id: emergency.id }),
        })
      }
    }

    syncMarkers(L, map, group, alertMarkersRef.current, specs)
  }, [
    snapshot.concerns,
    snapshot.emergencies,
    layers.concerns,
    selected?.kind,
    selected?.id,
    mapReady,
  ])

  // Framing the selected incident is a viewport action, not a layer action. It
  // used to live inside the layer effect, so every websocket tick yanked the
  // map back to the selection with an animation. Reading the incident through a
  // ref keeps this effect keyed to the selection alone.
  const emergenciesRef = useRef(snapshot.emergencies)
  useEffect(() => {
    emergenciesRef.current = snapshot.emergencies
  }, [snapshot.emergencies])
  useEffect(() => {
    if (selected?.kind !== "emergency") return
    const map = mapRef.current
    if (!map) return
    const emergency = emergenciesRef.current.find(
      (item) => item.id === selected.id
    )
    const coord = emergency
      ? validCoord(emergency.latitude, emergency.longitude)
      : null
    if (coord)
      map.setView(coord, Math.max(map.getZoom(), 16), { animate: true })
  }, [selected?.kind, selected?.id, mapReady])

  return (
    // `absolute inset-0`, not `size-full`. A percentage height only resolves
    // when every ancestor has a definite one, and on mobile the shell's <main>
    // is `min-h-svh` with auto height -- so `height:100%` computed to auto and
    // the whole chain collapsed to zero, leaving the map unpainted. Absolute
    // insets resolve against the positioned parent's laid-out box instead, so
    // they work identically at both breakpoints.
    <div className="absolute inset-0 overflow-hidden bg-status-closed-surface">
      <div ref={containerRef} className="absolute inset-0" />

      {/* One control column using the same action order as every map. */}
      <div className="absolute top-3 right-3 z-[600] flex flex-col items-end gap-2">
        <div className="pointer-events-auto relative">
          <MapControlStack tone="light">
            <MapControlButton
              tone="light"
              label="Frame the barangay"
              onClick={goHomeOnMap}
            >
              <HomeIcon className="size-5" strokeWidth={1.9} />
            </MapControlButton>
            <MapControlButton
              tone="light"
              divider
              label="Current location"
              onClick={goToCurrentLocation}
              loading={locating}
            >
              <LocateFixedIcon className="size-5" strokeWidth={1.9} />
            </MapControlButton>
            <MapControlButton
              tone="light"
              divider
              label="Open Street View at the current pin"
              active={svPick}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", "street-view")
                event.dataTransfer.effectAllowed = "copy"
                setSvPick(true)
              }}
              onClick={openStreetViewAtPin}
            >
              <FootprintsIcon className="size-5" strokeWidth={1.9} />
            </MapControlButton>
          </MapControlStack>
        </div>

        {svPick ? (
          <div className="pointer-events-none absolute top-[calc(100%+8px)] right-0 w-max max-w-[min(15rem,calc(100vw-1.5rem))] rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-neutral-700 shadow-md">
            Click the map to start Street View · Esc cancels
          </div>
        ) : null}
      </div>

      {svCoord ? (
        <StreetViewModal coord={svCoord} onClose={() => setSvCoord(null)} />
      ) : null}
    </div>
  )
}

// Memoised because it owns the Leaflet instance: an unmemoised parent render
// used to re-run every layer effect and rebuild every polyline and pin.
export const AlertsLeafletMap = memo(AlertsLeafletMapInner)
