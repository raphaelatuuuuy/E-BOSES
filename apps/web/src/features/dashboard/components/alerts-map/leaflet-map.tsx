import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  CrosshairIcon,
  HomeIcon,
  LayersIcon,
  MinusIcon,
  NavigationIcon,
  PlusIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  updateMapDispatchPolicy,
  type LiveMapSnapshot,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import {
  MapWeatherDetails,
  useMapWeather,
} from "@/features/dashboard/components/map-weather"
import { applyRouteMotion, routeLineStyle } from "@/features/dashboard/lib/route-line"
import {
  type LayerKey,
  type Selection,
  type StreetLine,
  geoJsonToLines,
  isActiveConcern,
  isActiveEmergency,
  MAP_COLORS,
  markerDotHtml,
  policyNumber,
  validCoord,
} from "./lib"

import type leaflet from "leaflet"

export function AlertsLeafletMap({
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
  counts: { residents: number; responders: number; officials: number; emergencies: number; concerns: number; routes: number }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  // Mount-time values for the one-shot map construction effect. Reading them
  // through refs keeps that effect stable while still seeing the props the
  // page loaded with.
  const initialSnapshotRef = useRef(snapshot)
  const initialLayersRef = useRef(layers)
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
  const boundaryRef = useRef<leaflet.GeoJSON | null>(null)
  const myLocationRef = useRef<leaflet.Marker | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
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
  const [legendOpen, setLegendOpen] = useState(false)
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
              html: markerDotHtml("var(--color-ice)", true),
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            }),
            interactive: false,
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

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      LRef.current = L
      map = L.map(containerRef.current, {
        center: [initialSnapshotRef.current.map.center.latitude, initialSnapshotRef.current.map.center.longitude],
        zoom: initialSnapshotRef.current.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      containerRef.current.classList.add("eboses-map-dark")
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)
      alertLayersRef.current = L.layerGroup().addTo(map)
      peopleLayersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      if (initialSnapshotRef.current.map.boundary.geometry) {
        boundaryRef.current = L.geoJSON(initialSnapshotRef.current.map.boundary.geometry as Parameters<typeof L.geoJSON>[0], {
          style: { color: MAP_COLORS.structure, weight: 1.5, fillColor: MAP_COLORS.structure, fillOpacity: 0.05, opacity: 0.5 },
        }).addTo(map)
        map.fitBounds(boundaryRef.current.getBounds(), { padding: [18, 18] })
        if (!initialLayersRef.current.boundary && boundaryRef.current) map.removeLayer(boundaryRef.current)
      }
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
      map?.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const boundary = boundaryRef.current
    if (!map || !boundary) return
    if (layers.boundary && !map.hasLayer(boundary)) boundary.addTo(map)
    if (!layers.boundary && map.hasLayer(boundary)) map.removeLayer(boundary)
  }, [layers.boundary, mapReady])

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

    // Drag circle directly — capture mouse events to move the circle
    let dragging = false
    let dragOffset = { lat: 0, lng: 0 }
    const onCircleMouseDown = (e: leaflet.LeafletMouseEvent) => {
      dragging = true
      const circleCenter = circle.getLatLng()
      dragOffset = { lat: e.latlng.lat - circleCenter.lat, lng: e.latlng.lng - circleCenter.lng }
      map.dragging.disable()
    }
    circle.on("mousedown", onCircleMouseDown)

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
    map.on("mousemove", onMapMouseMove)

    const onMapMouseUp = () => {
      if (!dragging) return
      dragging = false
      map.dragging.enable()
      updateZoneDraft(circle.getLatLng(), circle.getRadius())
    }
    map.on("mouseup", onMapMouseUp)

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

  // Alerts + reference geometry. Deps are the individual snapshot slices rather
  // than the snapshot object, so a location ping (which only replaces `people`)
  // leaves all of this mounted.
  useEffect(() => {
    const L = LRef.current
    const group = alertLayersRef.current
    if (!L || !group) return undefined
    const cleanups: Array<() => void> = []
    group.clearLayers()

    if (layers.streets) {
      for (const { name, line } of streetLines) {
        const selectedStreet = selectedStreetNames.has(name)
        if (selectedStreetNames.size && !selectedStreet) continue
        L.polyline(line, {
          color: selectedStreet ? MAP_COLORS.concern : MAP_COLORS.structure,
          opacity: selectedStreet ? 0.9 : 0.28,
          weight: selectedStreet ? 3 : 1.2,
        }).addTo(group)
      }
    }

    if (layers.routes) {
      // A route is live only while its incident is still open. Previously every
      // route in the snapshot drew the same solid orange dash forever, so the
      // map kept showing journeys to emergencies that had already been resolved
      // exactly as prominently as the one crew currently driving.
      const liveAlertIds = new Set(
        snapshot.emergencies.filter(isActiveEmergency).map((emergency) => emergency.id),
      )
      for (const route of snapshot.routes) {
        if (route.status === "ok" && route.geometry) {
          const live = liveAlertIds.has(route.alert_id)
          const line = L.polyline(
            route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as leaflet.LatLngTuple),
            routeLineStyle({ live }),
          ).addTo(group)
          applyRouteMotion(line, live)
        }
      }
    }

    for (const concern of snapshot.concerns) {
      if (!layers.concerns) continue
      // The snapshot keeps closed records so an open detail panel does not
      // blank out when its subject resolves; the map only ever draws open ones.
      if (!isActiveConcern(concern)) continue
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      const color = MAP_COLORS.concern
      const marker = L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerDotHtml(color), iconSize: [30, 30], iconAnchor: [15, 15] }),
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
      if (!isActiveEmergency(emergency)) continue
      const coord = validCoord(emergency.latitude, emergency.longitude)
      if (!coord) continue
      const marker = L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerDotHtml(MAP_COLORS.emergency, true), iconSize: [30, 30], iconAnchor: [15, 15] }),
      })
      const handleClick = () => onSelect({ kind: "emergency", id: emergency.id })
      marker.on("click", handleClick)
      cleanups.push(() => marker.off("click", handleClick))
      marker.addTo(group)
    }

    if (selected?.kind === "emergency") {
      const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
      const coord = emergency ? validCoord(emergency.latitude, emergency.longitude) : null
      const map = mapRef.current
      if (coord && map) map.setView(coord, Math.max(map.getZoom(), 16), { animate: true })
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [
    snapshot.concerns,
    snapshot.emergencies,
    snapshot.routes,
    layers,
    selected?.kind,
    selected?.id,
    selectedStreetNames,
    streetLines,
    onSelect,
    mapReady,
  ])

  // People. Re-runs on every location ping, which is why it owns its own layer
  // group and touches nothing else on the map.
  useEffect(() => {
    const L = LRef.current
    const group = peopleLayersRef.current
    if (!L || !group) return undefined
    const cleanups: Array<() => void> = []
    group.clearLayers()

    // Who is committed to the incident on screen. Drives the assigned-responder
    // pin below and the link line to the incident.
    const selectedEmergency =
      selected?.kind === "emergency"
        ? snapshot.emergencies.find((item) => item.id === selected.id) ?? null
        : null
    const assignedResponderId = selectedEmergency?.current_assignment?.responder.id ?? null

    for (const person of snapshot.people) {
      const coord = validCoord(person.latitude, person.longitude)
      if (!coord) continue
      if (person.role === "resident" && !layers.residents) continue
      if (person.role === "barangay_official" && !layers.officials) continue
      if (person.role === "first_responder" && !layers.responders) continue

      const isResponder = person.role === "first_responder"
      const isAssigned = isResponder && person.id === assignedResponderId

      // Residents and officials are context. Responders are the resource a
      // dispatcher allocates, so they get their own hue, and the one assigned
      // to the selected incident is lifted out of the rest.
      const color = !isResponder
        ? MAP_COLORS.structure
        : isAssigned
          ? MAP_COLORS.responderAssigned
          : person.is_on_duty
            ? MAP_COLORS.responder
            : MAP_COLORS.responderOffDuty

      const marker = L.marker(coord, {
        icon: L.divIcon({
          className: "",
          html: markerDotHtml(color, isAssigned),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        title: isResponder
          ? `${person.full_name}${person.is_on_duty ? "" : " (off duty)"}`
          : person.full_name,
        zIndexOffset: isAssigned ? 500 : 0,
      })
      const handleClick = () => onSelect({ kind: "person", id: person.id })
      marker.on("click", handleClick)
      cleanups.push(() => marker.off("click", handleClick))
      marker.addTo(group)

      // A line from the assigned responder to the incident, so "who is going to
      // this" is answered by looking at the map rather than reading a panel.
      if (isAssigned && selectedEmergency) {
        const target = validCoord(selectedEmergency.latitude, selectedEmergency.longitude)
        if (target) {
          // Straight-line bearing, not a road route — thinner and fainter, and
          // it only crawls while the incident is still open.
          const live = isActiveEmergency(selectedEmergency)
          const link = L.polyline(
            [coord, target],
            routeLineStyle({ live, approximate: true }),
          ).addTo(group)
          applyRouteMotion(link, live)
        }
      }
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [
    snapshot.people,
    snapshot.emergencies,
    layers.residents,
    layers.officials,
    layers.responders,
    selected?.kind,
    selected?.id,
    onSelect,
    mapReady,
  ])


  const layerRows: Array<{ key: LayerKey; label: string; count?: number; tone: string }> = [
    { key: "emergencies", label: "Emergencies", count: counts.emergencies, tone: MAP_COLORS.emergency },
    { key: "concerns", label: "Concerns", count: counts.concerns, tone: MAP_COLORS.concern },
    { key: "responders", label: "Responders", count: counts.responders, tone: MAP_COLORS.responder },
    { key: "residents", label: "Residents", count: counts.residents, tone: MAP_COLORS.structure },
    { key: "officials", label: "Officials", count: counts.officials, tone: MAP_COLORS.structure },
    { key: "routes", label: "Routes", count: counts.routes, tone: MAP_COLORS.route },
  ]
  const referenceRows: Array<{ key: LayerKey; label: string }> = [
    { key: "boundary", label: "Barangay boundary" },
    { key: "streets", label: "Streets" },
    { key: "acceptance_zone", label: "Acceptance zone" },
  ]
  const peak = Math.max(1, counts.emergencies, counts.concerns, counts.responders, counts.residents)

  /**
   * The layer panel, rendered in two places: bottom-right on desktop, and
   * stacked under the acceptance zone on mobile where the bottom edge
   * belongs to the alert sheet. Collapsed it is a single icon in the same
   * 40px glass style as the controls.
   */
  function renderLayerPanel() {
    return (
      <>
          {!legendOpen ? (
            <button
              type="button"
              onClick={() => setLegendOpen(true)}
              aria-label="Show the map layers"
              title="Layers"
              className="flex size-10 items-center justify-center rounded-panel border border-white/10 bg-nav-bg/80 text-white/70 backdrop-blur-md transition-colors hover:bg-nav-raised/80 hover:text-white"
            >
              <LayersIcon className="size-4" />
            </button>
          ) : (
          <div className="w-[min(15.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-panel border border-white/10 bg-nav-bg/85 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
                On the map
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onResetLayers}
                  className="text-[10.5px] font-bold text-brand-orange transition-opacity hover:opacity-80"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setLegendOpen(false)}
                  aria-label="Hide the map layers"
                  className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-control text-white/40 transition-colors hover:bg-card/10 hover:text-white"
                >
                  <MinusIcon className="size-3.5" strokeWidth={2.6} />
                </button>
              </span>
            </div>

            <div className="px-3.5 pb-3.5 pt-2">
              {layerRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => onToggleLayer(row.key)}
                  aria-pressed={layers[row.key]}
                  className="group flex w-full flex-col gap-1 py-[5px] text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-[11.5px] font-bold transition-colors",
                        layers[row.key] ? "text-white/85" : "text-white/25",
                      )}
                    >
                      {row.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[11.5px] font-semibold tabular-nums transition-colors",
                        layers[row.key] ? "text-white" : "text-white/25",
                      )}
                    >
                      {row.count ?? 0}
                    </span>
                  </span>
                  {/* The bar IS the legend swatch: colour identifies the layer,
                      length compares it to the busiest one. */}
                  <span className="h-[3px] w-full overflow-hidden rounded-full bg-card/8">
                    <span
                      className="block h-full rounded-full transition-[width,opacity] duration-500"
                      style={{
                        width: `${Math.max(((row.count ?? 0) / peak) * 100, row.count ? 6 : 0)}%`,
                        backgroundColor: row.tone,
                        opacity: layers[row.key] ? 1 : 0.25,
                      }}
                    />
                  </span>
                </button>
              ))}

              <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2.5">
                {referenceRows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => onToggleLayer(row.key)}
                    aria-pressed={layers[row.key]}
                    className={cn(
                      "rounded-full px-2 py-1 text-[10px] font-bold transition-colors",
                      layers[row.key]
                        ? "bg-card/12 text-white/80"
                        : "bg-card/5 text-white/30 hover:text-white/55",
                    )}
                  >
                    {row.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          )}
      </>
    )
  }

  return (
    // `absolute inset-0`, not `size-full`. A percentage height only resolves
    // when every ancestor has a definite one, and on mobile the shell's <main>
    // is `min-h-svh` with auto height -- so `height:100%` computed to auto and
    // the whole chain collapsed to zero, leaving the map unpainted. Absolute
    // insets resolve against the positioned parent's laid-out box instead, so
    // they work identically at both breakpoints.
    <div className="absolute inset-0 overflow-hidden bg-nav-bg">
      <div ref={containerRef} className="absolute inset-0" />

      {/* One control column, not five scattered clusters. Zoom sits at the
          bottom of the same stack so the whole set is one target area. */}
      <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-panel border border-white/10 bg-nav-bg/80 backdrop-blur-md">
          <GlassControl label="Frame the barangay" onClick={goHomeOnMap}>
            <HomeIcon className="size-4" />
          </GlassControl>
          <GlassControl label="My current location" onClick={goToCurrentLocation} busy={locating}>
            <NavigationIcon className="size-4" />
          </GlassControl>
          <GlassControl label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <PlusIcon className="size-4" />
          </GlassControl>
          <GlassControl label="Zoom out" onClick={() => mapRef.current?.zoomOut()} last>
            <MinusIcon className="size-4" />
          </GlassControl>
        </div>

        <button
          type="button"
          onClick={() => setWeatherOpen((value) => !value)}
          aria-expanded={weatherOpen}
          className="flex items-center gap-1.5 rounded-panel border border-white/10 bg-nav-bg/80 px-2.5 py-2 text-[12px] font-bold text-white backdrop-blur-md transition-colors hover:bg-nav-raised/80"
        >
          <span className="text-brand-orange">{Math.round(weather.temperature ?? 0)}&deg;</span>
          <span className="text-white/50">C</span>
        </button>

        {weatherOpen ? (
          <div className="w-[min(19rem,calc(100vw-1.5rem))] rounded-panel border border-white/10 bg-nav-bg/95 p-4 text-white backdrop-blur-md">
            <p className="text-[14px] font-semibold">{weather.placeName}</p>
            <p className="text-[11px] font-semibold text-white/45">Live barangay weather</p>
            <div className="mt-3 [&_*]:!text-white/70">
              <MapWeatherDetails weather={weather} />
            </div>
          </div>
        ) : null}

        {/* Collapses to a single icon in the same 40px glass style as the
            controls above it, so a collapsed panel reads as another button in
            the stack rather than as a shrunken card. */}
        {layers.acceptance_zone ? (
          zoneOpen ? (
            <div className="w-[min(15rem,calc(100vw-1.5rem))] overflow-hidden rounded-panel border border-white/10 bg-nav-bg/85 backdrop-blur-md">
              <div className="flex items-start gap-2 px-3 pt-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/40">
                    Acceptance zone
                  </span>
                  <span className="mt-0.5 block text-[17px] font-semibold leading-none text-white tabular-nums">
                    {Math.round(Number(zoneDraft.acceptance_radius_meters) || 0)}
                    <span className="ml-1 text-[11px] font-bold text-white/50">m</span>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setZoneOpen(false)}
                  aria-label="Collapse the acceptance zone panel"
                  className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-control text-white/40 transition-colors hover:bg-card/10 hover:text-white"
                >
                  <MinusIcon className="size-3.5" strokeWidth={2.6} />
                </button>
              </div>
              <div className="px-3 pb-3 pt-2">
                <p className="text-[11px] font-medium leading-snug text-white/45">
                  Drag the centre or the edge handle on the map, then save.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!zoneDirty || zoneSaving}
                  onClick={() => void saveZoneDraft()}
                  className="mt-2.5 h-8 w-full rounded-control bg-brand-orange text-[12px] font-semibold text-brand-orange-ink hover:bg-brand-orange-strong disabled:bg-card/10 disabled:text-white/35"
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
              className="relative flex size-10 items-center justify-center rounded-panel border border-white/10 bg-nav-bg/80 text-white/70 backdrop-blur-md transition-colors hover:bg-nav-raised/80 hover:text-white"
            >
              <CrosshairIcon className="size-4" />
              {zoneDirty ? (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-brand-orange" />
              ) : null}
            </button>
          )
        ) : null}

        {/* On phones the bottom edge belongs to the alert sheet, so the
            layer panel stacks under the acceptance zone instead. */}
        <div className="flex flex-col items-end gap-2 lg:hidden">{renderLayerPanel()}</div>
      </div>

      {/* Layer panel. Counts double as the bar chart, so the legend and the
          summary are one object instead of two competing cards. */}
      <div className="absolute bottom-3 right-3 z-[500] hidden justify-end lg:flex">
        {renderLayerPanel()}
      </div>
    </div>
  )
}

/** One row of the control stack. Hairline divider except on the last. */
function GlassControl({
  label,
  onClick,
  children,
  busy = false,
  last = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  busy?: boolean
  last?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-10 items-center justify-center text-white/70 transition-colors hover:bg-card/10 hover:text-white",
        !last && "border-b border-white/10",
        busy && "animate-pulse text-brand-orange",
      )}
    >
      {children}
    </button>
  )
}
