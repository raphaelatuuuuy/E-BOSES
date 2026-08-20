import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CrosshairIcon,
  HomeIcon,
  MinusIcon,
  NavigationIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  updateMapDispatchPolicy,
  type LiveMapEmergency,
  type LiveMapSnapshot,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import {
  MapWeatherDetails,
  useMapWeather,
} from "@/features/dashboard/components/map-weather"
import { connectorLineStyle, drawRoute, routeRenderGeometry } from "@/features/dashboard/lib/route-line"
import {
  geoJsonToRing,
  polygonCentroid,
} from "@/features/dashboard/components/community-content/area-lib"
import { advisoryMarkerHtml, advisoryMeta } from "@/features/dashboard/components/community-content/advisory-tags"
import type { GeoJsonPolygon } from "@/features/dashboard/api"
import {
  MapChip,
  MapControlButton,
  MapControlStack,
} from "@/features/dashboard/components/map/map-chrome"
import { MapLegend, type MapLegendRow } from "@/features/dashboard/components/map/map-legend"
import {
  concernGlyph,
  dotPinHtml,
  glyphPinHtml,
  glyphPinSize,
  GLYPHS,
  personDotHtml,
} from "@/features/dashboard/components/map/markers"
import {
  type LayerKey,
  type Selection,
  type StreetLine,
  geoJsonToLines,
  isActiveConcern,
  isResolvedRecord,
  isActiveEmergency,
  MAP_COLORS,
  policyNumber,
  validCoord,
} from "./lib"

import type leaflet from "leaflet"

function AlertsLeafletMapInner({
  snapshot,
  layers,
  selected,
  selectedStreetNames,
  onSelect,
  onToggleLayer,
  onResetLayers,
  onPolicyUpdated,
  counts,
}: {
  snapshot: LiveMapSnapshot
  layers: Record<LayerKey, boolean>
  selected: Selection
  selectedStreetNames: Set<string>
  onSelect: (selection: Selection) => void
  onToggleLayer: (key: LayerKey) => void
  onResetLayers: () => void
  onPolicyUpdated: (policy: MapDispatchPolicy) => void
  counts: { residents: number; responders: number; officials: number; emergencies: number; concerns: number; advisories: number; resolved?: number }
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
  const peopleLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const streetLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const routeLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const advisoryLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const advisoryRoadsRef = useRef<
    Map<number, { roads: Array<{ casing: leaflet.Polyline; core: leaflet.Polyline }>; wide: string | null }>
  >(new Map())
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
        for (const { casing, core } of entry.roads) {
          casing.setStyle({ opacity: strong ? 0.95 : 0.5 })
          core.setStyle({ opacity: strong ? 0.95 : 0.35 })
        }
      }
      const entry = id != null ? advisoryRoadsRef.current.get(id) : null
      if (entry?.wide) {
        const geometry = snapshot.map.boundary.geometry as GeoJsonPolygon | null
        const ring = geometry ? geoJsonToRing(geometry) : []
        if (ring.length >= 3) {
          L.polygon(ring, {
            color: entry.wide,
            weight: 2,
            opacity: 0.9,
            fillColor: entry.wide,
            fillOpacity: 0.15,
            interactive: false,
          }).addTo(highlight)
        }
      }
    },
    [snapshot.map.boundary.geometry],
  )
  // Whether the view has been framed against a container that actually had
  // a size. Guards the one-time re-fit in the ResizeObserver below.
  const framedRef = useRef(false)
  // Set once the async Leaflet import + map construction finishes. Every
  // layer effect depends on it; without it they run against a null map on
  // first paint, bail, and never re-run -- which is why the boundary,
  // acceptance zone and legend layers intermittently never appeared.
  const [mapReady, setMapReady] = useState(false)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  // Both overlay panels start collapsed to an icon. On a phone the expanded
  // pair covered most of the map, which is the one thing this screen exists
  // to show.
  const [zoneOpen, setZoneOpen] = useState(false)
  const [zoneDraft, setZoneDraft] = useState<MapDispatchPolicy>(snapshot.map.dispatch_policy)
  const [zoneSaving, setZoneSaving] = useState(false)
  const weather = useMapWeather(
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
    snapshot.map.boundary.name,
  )
  const streetLines = useMemo<StreetLine[]>(() => {
    return snapshot.map.streets.streets.flatMap((street) =>
      (street.geometries ?? []).flatMap((geometry) => geoJsonToLines(geometry).map((line) => ({ name: street.name, line }))),
    )
  }, [snapshot.map.streets.streets])
  const zoneDraftKey = [
    zoneDraft.acceptance_center_latitude,
    zoneDraft.acceptance_center_longitude,
    zoneDraft.acceptance_radius_meters,
  ].join(":")
  const savedZoneKey = [
    snapshot.map.dispatch_policy.acceptance_center_latitude,
    snapshot.map.dispatch_policy.acceptance_center_longitude,
    snapshot.map.dispatch_policy.acceptance_radius_meters,
  ].join(":")
  const zoneDirty = zoneDraftKey !== savedZoneKey

  function updateZoneDraft(center: leaflet.LatLng, radius: number) {
    setZoneDraft((current) => ({
      ...current,
      acceptance_center_latitude: Number(center.lat.toFixed(7)),
      acceptance_center_longitude: Number(center.lng.toFixed(7)),
      acceptance_radius_meters: Math.max(100, Math.min(5000, Math.round(radius))),
    }))
  }

  async function saveZoneDraft() {
    setZoneSaving(true)
    try {
      const saved = await updateMapDispatchPolicy({
        acceptance_center_latitude: zoneDraft.acceptance_center_latitude,
        acceptance_center_longitude: zoneDraft.acceptance_center_longitude,
        acceptance_radius_meters: zoneDraft.acceptance_radius_meters,
        out_of_zone_action: zoneDraft.out_of_zone_action,
        witness_radius_meters: zoneDraft.witness_radius_meters,
        responder_nearby_radius_meters: zoneDraft.responder_nearby_radius_meters,
      })
      setZoneDraft(saved)
      onPolicyUpdated(saved)
      toast.success("Acceptance zone saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save acceptance zone.")
    } finally {
      setZoneSaving(false)
    }
  }

  function goHomeOnMap() {
    const map = mapRef.current
    if (!map) return
    const boundary = boundaryRef.current
    if (boundary) {
      map.fitBounds(boundary.getBounds(), { padding: [18, 18], animate: true })
      return
    }
    map.setView([snapshot.map.center.latitude, snapshot.map.center.longitude], snapshot.map.center.zoom, {
      animate: true,
    })
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
        map.setView([coords.latitude, coords.longitude], Math.max(map.getZoom(), 17), {
          animate: true,
        })
        // Drop a marker. Without one the button just moved the viewport, which
        // is indistinguishable from it having done nothing.
        if (L) {
          if (myLocationRef.current) map.removeLayer(myLocationRef.current)
          myLocationRef.current = L.marker([coords.latitude, coords.longitude], {
            icon: L.divIcon({
              className: "",
              html: dotPinHtml({ color: MAP_COLORS.you, size: 14, tone: "dark" }),
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            }),
            interactive: false,
            zIndexOffset: 1200,
          }).addTo(map)
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
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
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
        .eboses-map-dark.leaflet-container {
          width: 100%;
          height: 100%;
          background: #0b1020;
          font-family: inherit;
        }
        .eboses-map-dark .leaflet-tile-pane { isolation: isolate; }
        .eboses-map-dark img.leaflet-tile,
        .eboses-map-dark .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
      `
      document.head.appendChild(styleEl)

      map = L.map(containerRef.current, {
        center: [initialSnapshotRef.current.map.center.latitude, initialSnapshotRef.current.map.center.longitude],
        zoom: initialSnapshotRef.current.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      containerRef.current.classList.add("eboses-map-dark")
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
        keepBuffer: 6,
        updateWhenIdle: true,
      }).addTo(map)
      streetLayersRef.current = L.layerGroup().addTo(map)
      // Hover-only barangay fill: sits beneath every advisory road/marker.
      highlightGroupRef.current = L.layerGroup().addTo(map)
      advisoryLayersRef.current = L.layerGroup().addTo(map)
      routeLayersRef.current = L.layerGroup().addTo(map)
      alertLayersRef.current = L.layerGroup().addTo(map)
      peopleLayersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
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
          if (boundary) current.fitBounds(boundary.getBounds(), { padding: [14, 14] })
        }
      })
      observer.observe(containerRef.current)
      resizeObserverRef.current = observer

      requestAnimationFrame(() => map?.invalidateSize())
      if (!cancelled) setMapReady(true)
    }

    void init()
    return () => {
      cancelled = true
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
  const boundaryFittedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return
    if (boundaryRef.current) {
      map.removeLayer(boundaryRef.current)
      boundaryRef.current = null
    }
    if (!boundaryGeometry) return
    const layer = L.geoJSON(boundaryGeometry as Parameters<typeof L.geoJSON>[0], {
      style: {
        color: MAP_COLORS.structure,
        weight: 1.5,
        fillColor: MAP_COLORS.structure,
        fillOpacity: 0.05,
        opacity: 0.5,
      },
      interactive: false,
    })
    boundaryRef.current = layer
    if (layers.boundary) layer.addTo(map)
    if (!boundaryFittedRef.current) {
      const bounds = layer.getBounds()
      if (bounds.isValid()) {
        boundaryFittedRef.current = true
        map.fitBounds(bounds, { padding: [18, 18] })
      }
    }
    // layers.boundary is handled by the toggle effect below; keeping it out of
    // here stops a checkbox from rebuilding a few-hundred-point polygon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundaryGeometry, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const boundary = boundaryRef.current
    if (!map || !boundary) return
    if (layers.boundary && !map.hasLayer(boundary)) boundary.addTo(map)
    if (!layers.boundary && map.hasLayer(boundary)) map.removeLayer(boundary)
  }, [layers.boundary, boundaryGeometry, mapReady])

  // Acceptance zone circle — grey ring showing the pin-acceptance limit, draggable & resizable
  const acceptanceZoneRef = useRef<leaflet.Circle | null>(null)
  const zoneHandleRef = useRef<leaflet.Marker | null>(null)
  const zoneCenterRef = useRef<leaflet.Marker | null>(null)
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return undefined

    // Cleanup previous
    if (acceptanceZoneRef.current) { map.removeLayer(acceptanceZoneRef.current); acceptanceZoneRef.current = null }
    if (zoneHandleRef.current) { map.removeLayer(zoneHandleRef.current); zoneHandleRef.current = null }
    if (zoneCenterRef.current) { map.removeLayer(zoneCenterRef.current); zoneCenterRef.current = null }

    if (!layers.acceptance_zone) return undefined

    const centerLat = policyNumber(zoneDraft.acceptance_center_latitude, snapshot.map.center.latitude)
    const centerLng = policyNumber(zoneDraft.acceptance_center_longitude, snapshot.map.center.longitude)
    const centerLatLng = L.latLng(centerLat, centerLng)
    const radius = Math.max(100, Math.min(5000, Number(zoneDraft.acceptance_radius_meters) || 800))

    // Non-draggable circle — moved via center marker or direct drag on circle
    const circle = L.circle(centerLatLng, {
      radius,
      color: MAP_COLORS.structure,
      fillColor: MAP_COLORS.structure,
      fillOpacity: 0.05,
      weight: 1.25,
      dashArray: "5 6",
    }).addTo(map)
    acceptanceZoneRef.current = circle

    // Drag the circle by its body. The move/up listeners are attached on press
    // and dropped on release: leaving a `mousemove` handler on the map made
    // Leaflet resolve a container point into a LatLng on every single pointer
    // move across the whole map, which is what made this screen feel heavy
    // next to the coverage-area editor.
    let dragging = false
    let dragOffset = { lat: 0, lng: 0 }

    const onMapMouseMove = (e: leaflet.LeafletMouseEvent) => {
      if (!dragging) return
      const newLat = e.latlng.lat - dragOffset.lat
      const newLng = e.latlng.lng - dragOffset.lng
      const newCenter = L.latLng(newLat, newLng)
      circle.setLatLng(newCenter)
      centerMarker.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    }

    const onMapMouseUp = () => {
      if (!dragging) return
      dragging = false
      map.off("mousemove", onMapMouseMove)
      map.off("mouseup", onMapMouseUp)
      map.dragging.enable()
      updateZoneDraft(circle.getLatLng(), circle.getRadius())
    }

    const onCircleMouseDown = (e: leaflet.LeafletMouseEvent) => {
      dragging = true
      const circleCenter = circle.getLatLng()
      dragOffset = { lat: e.latlng.lat - circleCenter.lat, lng: e.latlng.lng - circleCenter.lng }
      map.dragging.disable()
      map.on("mousemove", onMapMouseMove)
      map.on("mouseup", onMapMouseUp)
    }
    circle.on("mousedown", onCircleMouseDown)

    // Center draggable marker (moves the circle)
    const centerMarker = L.marker(centerLatLng, {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;border-radius:999px;background:var(--color-subtle-foreground);border:2px solid var(--color-card);box-shadow:0 0 0 6px rgba(120,132,159,.22);cursor:grab"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
    }).addTo(map)
    zoneCenterRef.current = centerMarker

    // Resize handle on the east edge
    const handleLat = centerLatLng.lat
    const handleLng = centerLatLng.lng + (radius / 111320) * Math.cos(centerLatLng.lat * Math.PI / 180)
    const handle = L.marker([handleLat, handleLng], {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:999px;background:var(--color-subtle-foreground);border:2px solid var(--color-card);box-shadow:0 2px 8px rgba(0,0,0,.45);cursor:grab"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map)
    zoneHandleRef.current = handle

    // Drag center marker → move circle + keep resize handle on east edge
    const onCenterDrag = () => {
      const newCenter = centerMarker.getLatLng()
      circle.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    }
    centerMarker.on("drag", onCenterDrag)
    const onCenterDragEnd = () => updateZoneDraft(circle.getLatLng(), circle.getRadius())
    centerMarker.on("dragend", onCenterDragEnd)

    // Drag resize handle → resize circle (center stays)
    const onHandleDrag = () => {
      const handlePos = handle.getLatLng()
      const centerPos = circle.getLatLng()
      const newRadius = centerPos.distanceTo(handlePos)
      circle.setRadius(newRadius)
    }
    handle.on("drag", onHandleDrag)
    const onHandleDragEnd = () => updateZoneDraft(circle.getLatLng(), circle.getRadius())
    handle.on("dragend", onHandleDragEnd)

    // Fixed leak: the inline version never removed these listeners on rerender/unmount.
    return () => {
      circle.off("mousedown", onCircleMouseDown)
      map.off("mousemove", onMapMouseMove)
      map.off("mouseup", onMapMouseUp)
      centerMarker.off("drag", onCenterDrag)
      centerMarker.off("dragend", onCenterDragEnd)
      handle.off("drag", onHandleDrag)
      handle.off("dragend", onHandleDragEnd)
    }
  }, [
    layers.acceptance_zone,
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
    zoneDraft.acceptance_center_latitude,
    zoneDraft.acceptance_center_longitude,
    zoneDraft.acceptance_radius_meters,
    mapReady,
  ])

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
    if (!layers.emergencies) return

    const byId = new Map(snapshot.emergencies.map((item) => [item.id, item]))
    const liveAlertIds = new Set(
      snapshot.emergencies.filter(isActiveEmergency).map((emergency) => emergency.id),
    )
    const focusId = selected?.kind === "emergency" ? selected.id : null

    for (const route of snapshot.routes) {
      if (route.status === "unavailable" || !route.geometry) continue
      const incident = byId.get(route.alert_id)
      if (!incident) continue
      if (!isActiveEmergency(incident) && !layers.resolved) continue
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
    layers.emergencies,
    layers.resolved,
    selected?.kind,
    selected?.id,
    mapReady,
  ])

  // Advisory areas: the same street corridors the Community tab publishes, not
  // a shape invented for the map. An advisory with no corridor (one street, or
  // none) highlights its street lines instead of drawing an arbitrary blob.
  useEffect(() => {
    const L = LRef.current
    const group = advisoryLayersRef.current
    if (!L || !group) return
    group.clearLayers()
    advisoryRoadsRef.current.clear()
    highlightGroupRef.current?.clearLayers()
    hoverIdRef.current = null
    focusIdRef.current = null
    if (!layers.advisories) return

    const bindAdvisoryFocus = (id: number, marker: leaflet.Marker) => {
      marker.on("mouseover", () => {
        hoverIdRef.current = id
        applyAdvisoryFocus(id)
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
      const tagColor = advisoryMeta(advisory.tag).color
      const ring = geoJsonToRing(advisory.area_geometry)
      if (ring.length >= 3) {
        L.polygon(ring, {
          color: tagColor,
          weight: 1.25,
          opacity: 0.55,
          fillColor: tagColor,
          fillOpacity: 0.16,
          interactive: false,
        }).addTo(group)
        const centroid = polygonCentroid(advisory.area_geometry)
        if (centroid) {
          const marker = L.marker(centroid, {
            icon: L.divIcon({
              className: "",
              html: advisoryMarkerHtml(advisory.tag, 26, "dark"),
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            }),
            keyboard: true,
          }).addTo(group)
          bindAdvisoryFocus(advisory.id, marker)
        }
        continue
      }
      const roads: Array<{ casing: leaflet.Polyline; core: leaflet.Polyline }> = []
      let anchor: leaflet.LatLngTuple | null = null
      for (const geometry of advisory.street_geometries ?? []) {
        const runs = geoJsonToLines(geometry)
        for (const line of runs) {
          const casing = L.polyline(line, {
            color: "#ffffff",
            weight: 7,
            opacity: 0.5,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(group)
          const core = L.polyline(line, {
            color: tagColor,
            weight: 2.5,
            opacity: 0.35,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(group)
          roads.push({ casing, core })
          if (!anchor && line.length > 0) anchor = line[Math.floor(line.length / 2)] ?? null
        }
      }
      if (!anchor) {
        const bGeometry = snapshot.map.boundary.geometry as GeoJsonPolygon | null
        const ring = bGeometry ? geoJsonToRing(bGeometry) : []
        const centroid = ring.length > 2 ? polygonCentroid(bGeometry) : null
        const marker = L.marker(centroid ?? [snapshot.map.center.latitude, snapshot.map.center.longitude], {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(advisory.tag, 26, "dark"),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          keyboard: true,
        }).addTo(group)
        bindAdvisoryFocus(advisory.id, marker)
        advisoryRoadsRef.current.set(advisory.id, { roads: [], wide: tagColor })
      } else {
        const marker = L.marker(anchor, {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(advisory.tag, 26, "dark"),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          zIndexOffset: 600,
          keyboard: true,
        }).addTo(group)
        bindAdvisoryFocus(advisory.id, marker)
        if (roads.length > 0) advisoryRoadsRef.current.set(advisory.id, { roads, wide: null })
      }
    }
  }, [snapshot.advisories, layers.advisories, mapReady, snapshot.map.boundary.geometry, snapshot.map.center.latitude, snapshot.map.center.longitude, applyAdvisoryFocus])

  // Incident pins. Deps are the individual snapshot slices rather than the
  // snapshot object, so a location ping (which only replaces `people`) leaves
  // all of this mounted.
  useEffect(() => {
    const L = LRef.current
    const group = alertLayersRef.current
    if (!L || !group) return undefined
    const cleanups: Array<() => void> = []
    group.clearLayers()

    for (const concern of snapshot.concerns) {
      if (!layers.concerns) continue
      // The snapshot keeps closed records so an open detail panel does not
      // blank out when its subject resolves; the map only ever draws open ones.
      const concernResolved = isResolvedRecord(concern)
      if (!isActiveConcern(concern) && !(layers.resolved && concernResolved)) continue
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      const focused = selected?.kind === "concern" && selected.id === concern.id
      const box = glyphPinSize(26, focused)
      const marker = L.marker(coord, {
        icon: L.divIcon({
          className: "",
          html: glyphPinHtml({
            paths: concernResolved ? GLYPHS.resolved : concernGlyph(concern.category),
            color: concernResolved ? MAP_COLORS.resolved : MAP_COLORS.concern,
            selected: focused,
            tone: "dark",
          }),
          iconSize: [box, box],
          iconAnchor: [box / 2, box / 2],
        }),
        zIndexOffset: focused ? 700 : 200,
      })
      const handleClick = () => onSelect({ kind: "concern", id: concern.id })
      marker.on("click", handleClick)
      cleanups.push(() => marker.off("click", handleClick))
      marker.addTo(group)
    }

    for (const emergency of snapshot.emergencies) {
      if (!layers.emergencies) continue
      // Same rule as concerns: a resolved or cancelled emergency must not keep
      // drawing a pulsing alarm pin. The pulse means "someone needs help now".
      const emergencyResolved = isResolvedRecord(emergency)
      if (!isActiveEmergency(emergency) && !(layers.resolved && emergencyResolved)) continue
      const coord = validCoord(emergency.latitude, emergency.longitude)
      if (!coord) continue
      const focused = selected?.kind === "emergency" && selected.id === emergency.id
      const box = glyphPinSize(28, focused)
      const marker = L.marker(coord, {
        icon: L.divIcon({
          className: "",
          html: glyphPinHtml({
            paths: emergencyResolved ? GLYPHS.resolved : GLYPHS.emergency,
            color: emergencyResolved ? MAP_COLORS.resolved : MAP_COLORS.emergency,
            size: 28,
            selected: focused,
            live: !emergencyResolved,
            tone: "dark",
          }),
          iconSize: [box, box],
          iconAnchor: [box / 2, box / 2],
        }),
        zIndexOffset: focused ? 800 : 400,
      })
      const handleClick = () => onSelect({ kind: "emergency", id: emergency.id })
      marker.on("click", handleClick)
      cleanups.push(() => marker.off("click", handleClick))
      marker.addTo(group)
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [
    snapshot.concerns,
    snapshot.emergencies,
    layers.concerns,
    layers.emergencies,
    layers.resolved,
    selected?.kind,
    selected?.id,
    onSelect,
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
    const emergency = emergenciesRef.current.find((item) => item.id === selected.id)
    const coord = emergency ? validCoord(emergency.latitude, emergency.longitude) : null
    if (coord) map.setView(coord, Math.max(map.getZoom(), 16), { animate: true })
  }, [selected?.kind, selected?.id, mapReady])

  // People. Re-runs on every location ping, which is why it owns its own layer
  // group and touches nothing else on the map.
  useEffect(() => {
    const L = LRef.current
    const group = peopleLayersRef.current
    if (!L || !group) return undefined
    const cleanups: Array<() => void> = []
    group.clearLayers()

    // Every responder committed to an open incident, not only the one on the
    // selected incident. A dispatcher must be able to see who is going where
    // without clicking each emergency in turn; selection only decides which leg
    // is lifted and which are held back.
    const assignmentByResponder = new Map<number, LiveMapEmergency>()
    for (const emergency of snapshot.emergencies) {
      if (!isActiveEmergency(emergency)) continue
      const responderId = emergency.current_assignment?.responder.id
      if (responderId != null) assignmentByResponder.set(responderId, emergency)
    }
    const focusId = selected?.kind === "emergency" ? selected.id : null

    for (const person of snapshot.people) {
      const coord = validCoord(person.latitude, person.longitude)
      if (!coord) continue
      if (person.role === "resident" && !layers.residents) continue
      if (person.role === "barangay_official" && !layers.officials) continue
      if (person.role === "first_responder" && !layers.responders) continue

      const isResponder = person.role === "first_responder"
      const incident = isResponder ? assignmentByResponder.get(person.id) ?? null : null
      const isAssigned = incident != null
      const isFocused = isAssigned && incident.id === focusId

      // Residents and officials are context. Responders are the resource a
      // dispatcher allocates, so they get their own hue, and the one assigned
      // to the selected incident is lifted out of the rest.
      const color = !isResponder
        ? person.role === "barangay_official"
          ? MAP_COLORS.official
          : MAP_COLORS.structure
        : isAssigned
          ? MAP_COLORS.responderAssigned
          : person.is_on_duty
            ? MAP_COLORS.responder
            : MAP_COLORS.responderOffDuty

      const box = isFocused ? 13 : 10
      const marker = L.marker(coord, {
        icon: L.divIcon({
          className: "",
          html: personDotHtml(color, isFocused, "dark"),
          iconSize: [box, box],
          iconAnchor: [box / 2, box / 2],
        }),
        title: isResponder
          ? `${person.full_name}${person.is_on_duty ? "" : " (off duty)"}`
          : person.full_name,
        zIndexOffset: isFocused ? 500 : isAssigned ? 250 : 0,
      })
      const handleClick = () => onSelect({ kind: "person", id: person.id })
      marker.on("click", handleClick)
      cleanups.push(() => marker.off("click", handleClick))
      marker.addTo(group)

      // The leg from a committed responder to their incident, so "who is going
      // to this" is answered by looking at the map rather than reading a panel.
      // It lives here rather than with the route because it has to follow the
      // responder's position, which updates on every ping.
      if (incident) {
        // Onto the route when there is one, straight to the incident when
        // there is not.
        const assignedRoute = snapshot.routes.find(
          (item) => item.responder_id === person.id && item.alert_id === incident.id,
        )
        const target = validCoord(incident.latitude, incident.longitude)
        const { connectors } = routeRenderGeometry(assignedRoute, { origin: coord })
        const link = connectors[0] ?? (target ? [coord, target] : null)
        if (link) {
          L.polyline(link, connectorLineStyle(focusId != null && !isFocused)).addTo(group)
        }
      }
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [
    snapshot.people,
    snapshot.emergencies,
    snapshot.routes,
    layers.residents,
    layers.officials,
    layers.responders,
    selected?.kind,
    selected?.id,
    onSelect,
    mapReady,
  ])


  const layerRows: MapLegendRow<LayerKey>[] = [
    { key: "emergencies", label: "Emergencies", hint: "Live incidents and their routes", count: counts.emergencies, tone: MAP_COLORS.emergency },
    { key: "concerns", label: "Concerns", hint: "Reports neighbours have filed", count: counts.concerns, tone: MAP_COLORS.concern },
    { key: "responders", label: "Responders", hint: "Crews on and off duty", count: counts.responders, tone: MAP_COLORS.responder },
    { key: "residents", label: "Residents", hint: "Devices reporting a location", count: counts.residents, tone: MAP_COLORS.structure },
    { key: "officials", label: "Officials", count: counts.officials, tone: MAP_COLORS.structure },
    { key: "advisories", label: "Advisory areas", hint: "Streets a barangay advisory covers", count: counts.advisories, tone: MAP_COLORS.advisory },
    { key: "resolved", label: "Resolved", hint: "Closed records, kept off the map by default", count: counts.resolved ?? 0, tone: MAP_COLORS.resolved },
  ]
  const referenceRows: MapLegendRow<LayerKey>[] = [
    { key: "boundary", label: "Boundary" },
    { key: "streets", label: "Streets" },
    { key: "acceptance_zone", label: "Acceptance zone" },
  ]

  return (
    // `absolute inset-0`, not `size-full`. A percentage height only resolves
    // when every ancestor has a definite one, and on mobile the shell's <main>
    // is `min-h-svh` with auto height -- so `height:100%` computed to auto and
    // the whole chain collapsed to zero, leaving the map unpainted. Absolute
    // insets resolve against the positioned parent's laid-out box instead, so
    // they work identically at both breakpoints.
    <div className="absolute inset-0 overflow-hidden bg-nav-bg">
      <div ref={containerRef} className="absolute inset-0" />

      {/* One control column. Locate sits below the zoom controls. */}
      <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2">
        <MapControlStack tone="dark">
          <MapControlButton tone="dark" label="Frame the barangay" onClick={goHomeOnMap}>
            <HomeIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
          <MapControlButton tone="dark" divider label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <PlusIcon className="size-5" strokeWidth={2.1} />
          </MapControlButton>
          <MapControlButton tone="dark" divider label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <MinusIcon className="size-5" strokeWidth={2.1} />
          </MapControlButton>
          <MapControlButton
            tone="dark"
            divider
            label="Current location"
            onClick={goToCurrentLocation}
            loading={locating}
          >
            <NavigationIcon className="size-5" strokeWidth={1.9} />
          </MapControlButton>
        </MapControlStack>

        <MapChip
          tone="dark"
          label="Weather"
          expanded={weatherOpen}
          onClick={() => setWeatherOpen((value) => !value)}
        >
          <span>{weather.temperature != null ? `${Math.round(weather.temperature)}°C` : "—"}</span>
        </MapChip>

        {weatherOpen ? (
          <div className="w-[min(19rem,calc(100vw-1.5rem))] rounded-xl border border-white/10 bg-nav-bg/95 p-4 text-white shadow-lg backdrop-blur-md">
            <p className="text-[15px] font-semibold">{weather.placeName}</p>
            <p className="mt-0.5 text-[13px] text-white/50">Live barangay weather</p>
            <div className="mt-3 [&_*]:!text-white/70">
              <MapWeatherDetails weather={weather} />
            </div>
          </div>
        ) : null}

        {layers.acceptance_zone ? (
          zoneOpen ? (
            <div className="w-[min(16rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-white/10 bg-nav-bg/85 shadow-lg backdrop-blur-md">
              <div className="flex items-start gap-2 border-b border-white/10 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-white">Acceptance zone</span>
                  <span className="mt-1 block text-[19px] font-semibold leading-none tabular-nums text-white">
                    {Math.round(Number(zoneDraft.acceptance_radius_meters) || 0)}
                    <span className="ml-1 text-[13px] font-medium text-white/50">m</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setZoneOpen(false)}
                  aria-label="Collapse the acceptance zone panel"
                  className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="size-4" strokeWidth={2.2} />
                </button>
              </div>
              <div className="px-3.5 py-3">
                <p className="text-[13px] leading-relaxed text-white/50">
                  Drag the centre or the edge handle on the map, then save.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!zoneDirty || zoneSaving}
                  onClick={() => void saveZoneDraft()}
                  className="mt-3 h-9 w-full rounded-lg bg-brand-orange text-[13px] font-semibold text-brand-orange-ink hover:bg-brand-orange-strong disabled:bg-white/10 disabled:text-white/35"
                >
                  {zoneSaving ? "Saving" : zoneDirty ? "Save zone" : "Saved"}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setZoneOpen(true)}
              aria-label="Open the acceptance zone panel"
              title="Acceptance zone"
              className="relative flex size-10 items-center justify-center rounded-xl border border-white/10 bg-nav-bg/85 text-white shadow-md backdrop-blur-md transition-colors hover:bg-white/10"
            >
              <CrosshairIcon className="size-5" strokeWidth={1.9} />
              {zoneDirty ? (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand-orange" />
              ) : null}
            </button>
          )
        ) : null}
      </div>

      {/* Below the map, clear of the control column. Collapsed it is one icon,
          so the legend never covers the barangay. */}
      <div className="absolute bottom-3 right-3 z-[500] flex flex-col items-end">
        <MapLegend
          tone="dark"
          rows={layerRows}
          reference={referenceRows}
          active={layers}
          onToggle={onToggleLayer}
          onReset={onResetLayers}
        />
      </div>
    </div>
  )
}

// Memoised because it owns the Leaflet instance: an unmemoised parent render
// used to re-run every layer effect and rebuild every polyline and pin.
export const AlertsLeafletMap = memo(AlertsLeafletMapInner)
