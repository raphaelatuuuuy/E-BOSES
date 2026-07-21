import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangleIcon,
  BellRingIcon,
  ChevronLeftIcon,
  ClockIcon,
  FileImageIcon,
  HomeIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MinusIcon,
  NavigationIcon,
  PlusIcon,
  ShieldCheckIcon,
  SirenIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  getOfficialLiveMap,
  updateMapDispatchPolicy,
  type LiveMapEmergency,
  type LiveMapGeometry,
  type LiveMapPerson,
  type LiveMapSnapshot,
  type LiveMapUpdate,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import {
  assignEmergency,
  getEmergency,
  reassignEmergency,
  removeEmergencyAssignment,
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"
import {
  MapControlButton,
  MapWeatherButton,
  MapWeatherDetails,
  useMapWeather,
} from "@/features/dashboard/components/map-weather"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import { usePageTitle } from "@/hooks/use-page-title"
import { websocketTicket, websocketUrl } from "@/lib/api"

import type leaflet from "leaflet"

type LayerKey = "boundary" | "streets" | "residents" | "officials" | "responders" | "concerns" | "emergencies" | "routes" | "acceptance_zone"
type Selection = { kind: "person" | "concern" | "emergency"; id: number } | null
type StreetLine = { name: string; line: leaflet.LatLngTuple[] }

const defaultLayers: Record<LayerKey, boolean> = {
  boundary: true,
  streets: true,
  residents: true,
  officials: true,
  responders: true,
  concerns: true,
  emergencies: true,
  routes: true,
  acceptance_zone: true,
}

const activeConcernStatuses = new Set(["submitted", "under_review", "assigned", "in_progress", "appealed"])
const activeEmergencyStatuses = new Set(["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"])

function validCoord(lat?: string | null, lng?: string | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function formatTime(value?: string | null) {
  if (!value) return "No update"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function formatDistance(meters: number | null) {
  if (meters == null) return "Route unavailable"
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatEta(seconds: number | null) {
  if (seconds == null) return "ETA unavailable"
  return `ETA ${Math.max(1, Math.round(seconds / 60))} min`
}

function policyNumber(value: number | string, fallback: number) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

function roleLabel(role: LiveMapPerson["role"]) {
  if (role === "barangay_official") return "Official"
  if (role === "first_responder") return "Responder"
  return "Resident"
}

function lineCoordinates(coordinates: unknown): leaflet.LatLngTuple[] {
  if (!Array.isArray(coordinates)) return []
  return coordinates.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const longitude = Number(point[0])
    const latitude = Number(point[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    return [[latitude, longitude] as leaflet.LatLngTuple]
  })
}

function geoJsonToLines(geometry?: LiveMapGeometry | null): leaflet.LatLngTuple[][] {
  if (!geometry) return []
  if (geometry.type === "LineString") {
    const line = lineCoordinates(geometry.coordinates)
    return line.length > 1 ? [line] : []
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map(lineCoordinates).filter((line) => line.length > 1)
  }
  return []
}

function markerDotHtml(color: string, pulse = false) {
  const size = pulse ? 26 : 22
  const border = pulse ? 3 : 2.5
  const shadow = pulse
    ? `0 0 0 10px ${color}22, 0 2px 10px rgba(220,38,38,.45)`
    : "0 4px 14px rgba(15,23,42,.28)"
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:${border}px solid #fff;box-shadow:${shadow}"></div>`
}

function AlertsLeafletMap({
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
  const dynamicLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryRef = useRef<leaflet.GeoJSON | null>(null)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)
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
  const streetKey = [...selectedStreetNames].sort().join("|")
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
        map.setView([coords.latitude, coords.longitude], Math.max(map.getZoom(), 17), {
          animate: true,
        })
        setLocating(false)
      },
      () => {
        toast.error("Unable to read your current location.")
        setLocating(false)
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
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
        center: [snapshot.map.center.latitude, snapshot.map.center.longitude],
        zoom: snapshot.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)
      dynamicLayersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      if (snapshot.map.boundary.geometry) {
        boundaryRef.current = L.geoJSON(snapshot.map.boundary.geometry as Parameters<typeof L.geoJSON>[0], {
          style: { color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.08, opacity: 0.9 },
        }).addTo(map)
        map.fitBounds(boundaryRef.current.getBounds(), { padding: [18, 18] })
        if (!layers.boundary && boundaryRef.current) map.removeLayer(boundaryRef.current)
      }
      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
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
  }, [layers.boundary])

  // Acceptance zone circle — grey ring showing the pin-acceptance limit, draggable & resizable
  const acceptanceZoneRef = useRef<leaflet.Circle | null>(null)
  const zoneHandleRef = useRef<leaflet.Marker | null>(null)
  const zoneCenterRef = useRef<leaflet.Marker | null>(null)
  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return

    // Cleanup previous
    if (acceptanceZoneRef.current) { map.removeLayer(acceptanceZoneRef.current); acceptanceZoneRef.current = null }
    if (zoneHandleRef.current) { map.removeLayer(zoneHandleRef.current); zoneHandleRef.current = null }
    if (zoneCenterRef.current) { map.removeLayer(zoneCenterRef.current); zoneCenterRef.current = null }

    if (!layers.acceptance_zone) return

    const centerLat = policyNumber(zoneDraft.acceptance_center_latitude, snapshot.map.center.latitude)
    const centerLng = policyNumber(zoneDraft.acceptance_center_longitude, snapshot.map.center.longitude)
    const centerLatLng = L.latLng(centerLat, centerLng)
    const radius = Math.max(100, Math.min(5000, Number(zoneDraft.acceptance_radius_meters) || 800))

    // Non-draggable circle — moved via center marker or direct drag on circle
    const circle = L.circle(centerLatLng, {
      radius,
      color: "#94a3b8",
      fillColor: "#94a3b8",
      fillOpacity: 0.06,
      weight: 1.5,
      dashArray: "6 6",
    }).addTo(map)
    acceptanceZoneRef.current = circle

    // Drag circle directly — capture mouse events to move the circle
    let dragging = false
    let dragOffset = { lat: 0, lng: 0 }
    circle.on("mousedown", (e: leaflet.LeafletMouseEvent) => {
      dragging = true
      const circleCenter = circle.getLatLng()
      dragOffset = { lat: e.latlng.lat - circleCenter.lat, lng: e.latlng.lng - circleCenter.lng }
      map.dragging.disable()
    })
    map.on("mousemove", (e: leaflet.LeafletMouseEvent) => {
      if (!dragging) return
      const newLat = e.latlng.lat - dragOffset.lat
      const newLng = e.latlng.lng - dragOffset.lng
      const newCenter = L.latLng(newLat, newLng)
      circle.setLatLng(newCenter)
      centerMarker.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    })
    map.on("mouseup", () => {
      if (!dragging) return
      dragging = false
      map.dragging.enable()
      updateZoneDraft(circle.getLatLng(), circle.getRadius())
    })

    // Center draggable marker (moves the circle)
    const centerMarker = L.marker(centerLatLng, {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;border-radius:999px;background:#94a3b8;border:2px solid #fff;box-shadow:0 0 0 6px rgba(148,163,184,.2);cursor:grab"></div>`,
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
        html: `<div style="width:14px;height:14px;border-radius:999px;background:#94a3b8;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:grab"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map)
    zoneHandleRef.current = handle

    // Drag center marker → move circle + keep resize handle on east edge
    centerMarker.on("drag", () => {
      const newCenter = centerMarker.getLatLng()
      circle.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    })
    centerMarker.on("dragend", () => updateZoneDraft(circle.getLatLng(), circle.getRadius()))

    // Drag resize handle → resize circle (center stays)
    handle.on("drag", () => {
      const handlePos = handle.getLatLng()
      const centerPos = circle.getLatLng()
      const newRadius = centerPos.distanceTo(handlePos)
      circle.setRadius(newRadius)
    })
    handle.on("dragend", () => updateZoneDraft(circle.getLatLng(), circle.getRadius()))
  }, [layers.acceptance_zone, snapshot.map.center.latitude, snapshot.map.center.longitude, zoneDraftKey])

  useEffect(() => {
    const L = LRef.current
    const group = dynamicLayersRef.current
    if (!L || !group) return
    group.clearLayers()

    if (layers.streets) {
      for (const { name, line } of streetLines) {
        const selectedStreet = selectedStreetNames.has(name)
        if (selectedStreetNames.size && !selectedStreet) continue
        L.polyline(line, {
          color: selectedStreet ? "#2447b3" : "#2563eb",
          opacity: selectedStreet ? 0.95 : 0.5,
          weight: selectedStreet ? 3.5 : 2,
        }).addTo(group)
      }
    }

    if (layers.routes) {
      for (const route of snapshot.routes) {
        if (route.status === "ok" && route.geometry) {
          L.polyline(route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as leaflet.LatLngTuple), {
            color: "#2563eb",
            dashArray: "8 8",
            opacity: 0.85,
            weight: 4,
          }).addTo(group)
        }
      }
    }

    for (const concern of snapshot.concerns) {
      if (!layers.concerns) continue
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      const color = "#f97316"
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerDotHtml(color), iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).on("click", () => onSelect({ kind: "concern", id: concern.id })).addTo(group)
    }

    for (const emergency of snapshot.emergencies) {
      if (!layers.emergencies) continue
      const coord = validCoord(emergency.latitude, emergency.longitude)
      if (!coord) continue
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerDotHtml("#dc2626", true), iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).on("click", () => onSelect({ kind: "emergency", id: emergency.id })).addTo(group)
    }

    for (const person of snapshot.people) {
      const coord = validCoord(person.latitude, person.longitude)
      if (!coord) continue
      if (person.role === "resident" && !layers.residents) continue
      if (person.role === "barangay_official" && !layers.officials) continue
      if (person.role === "first_responder" && !layers.responders) continue
      const color = person.role === "resident" ? "#22c55e" : person.role === "barangay_official" ? "#7c3aed" : "#2563eb"
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerDotHtml(color), iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).on("click", () => onSelect({ kind: "person", id: person.id })).addTo(group)
    }

    if (selected?.kind === "emergency") {
      const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
      const coord = emergency ? validCoord(emergency.latitude, emergency.longitude) : null
      const map = mapRef.current
      if (coord && map) map.setView(coord, Math.max(map.getZoom(), 16), { animate: true })
    }
  }, [snapshot, layers, selected?.kind, selected?.id, streetKey, streetLines, onSelect])

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2 sm:right-4 sm:top-4">
        <MapControlButton
          label="Barangay"
          icon={<HomeIcon className="size-4" />}
          onClick={goHomeOnMap}
        />
        <MapControlButton
          label="Current location"
          icon={<NavigationIcon className="size-4" />}
          onClick={goToCurrentLocation}
          loading={locating}
        />
        <div className="relative">
          <MapWeatherButton
            weather={weather}
            open={weatherOpen}
            onClick={() => setWeatherOpen((value) => !value)}
          />
          {weatherOpen ? (
            <div className="absolute right-0 top-12 z-[650] w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-[#dfe7f5] bg-white p-4 text-[#07145f] shadow-2xl">
              <div className="border-b border-neutral-100 pb-3">
                <p className="text-base font-black">{weather.placeName}</p>
                <p className="text-xs font-semibold text-[#687599]">Live barangay weather</p>
              </div>
              <MapWeatherDetails weather={weather} />
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MapControlButton
            label="Zoom in"
            icon={<PlusIcon className="size-5" />}
            onClick={() => mapRef.current?.zoomIn()}
            showLabel={false}
          />
          <MapControlButton
            label="Zoom out"
            icon={<MinusIcon className="size-5" />}
            onClick={() => mapRef.current?.zoomOut()}
            showLabel={false}
          />
        </div>
        {layers.acceptance_zone ? (
          <div className="w-[min(15rem,calc(100vw-2rem))] rounded-lg border border-[#dfe7f5] bg-white/95 p-3 text-left shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase text-[#68739c]">Acceptance Zone</p>
                <p className="mt-0.5 text-sm font-black text-[#07145f]">{Math.round(Number(zoneDraft.acceptance_radius_meters) || 0)} m</p>
                <p className="mt-0.5 text-[11px] font-bold capitalize text-[#68739c]">{zoneDraft.out_of_zone_action.replace(/_/g, " ")}</p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!zoneDirty || zoneSaving}
                onClick={() => void saveZoneDraft()}
                className="h-8 rounded-md bg-[#07145f] px-3 text-xs font-black text-white hover:bg-[#0d217e]"
              >
                Save
              </Button>
            </div>
            <p className="mt-2 text-[11px] font-semibold leading-4 text-[#68739c]">Drag the center or edge handle, then save.</p>
          </div>
        ) : null}
      </div>
      <div className="absolute bottom-4 right-4 z-[500] w-auto min-w-[140px] rounded-xl bg-white/95 p-3 text-xs font-bold text-[#43507f] shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setLegendOpen((v) => !v)} className="flex items-center gap-1.5 text-sm font-black text-[#07145f]">
            {legendOpen ? <MinusIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
            Legend
          </button>
          {legendOpen && (
            <button type="button" onClick={onResetLayers} className="text-[11px] font-black text-[#2447b3]">Reset All</button>
          )}
        </div>
        {legendOpen && (
        <div className="mt-2 flex flex-col gap-1">
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("boundary")}>
            <span className="flex items-center gap-2">
              <span className={cn("h-0.5 w-4", layers.boundary ? "bg-red-500" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.boundary ? "text-[#43507f]" : "text-neutral-400")}>Boundary</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("streets")}>
            <span className="flex items-center gap-2">
              <span className={cn("h-0.5 w-4", layers.streets ? "bg-blue-500" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.streets ? "text-[#43507f]" : "text-neutral-400")}>Streets</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("routes")}>
            <span className="flex items-center gap-2">
              <span className={cn("h-0 w-4 border-t-2", layers.routes ? "border-blue-500 border-dashed" : "border-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.routes ? "text-[#43507f]" : "text-neutral-400")}>Routes</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.routes ? "text-[#2447b3]" : "text-neutral-400")}>{counts.routes}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("acceptance_zone")}>
            <span className="flex items-center gap-2">
              <span className={cn("h-0 w-4 rounded-full border", layers.acceptance_zone ? "border-[#94a3b8] bg-[#94a3b8]/20" : "border-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.acceptance_zone ? "text-[#43507f]" : "text-neutral-400")}>Acceptance Zone</span>
            </span>
          </label>
          <div className="my-1 border-t border-neutral-200" />
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("residents")}>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.residents ? "bg-emerald-500" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.residents ? "text-[#43507f]" : "text-neutral-400")}>Residents</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.residents ? "text-[#2447b3]" : "text-neutral-400")}>{counts.residents}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("responders")}>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.responders ? "bg-blue-600" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.responders ? "text-[#43507f]" : "text-neutral-400")}>Responders</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.responders ? "text-[#2447b3]" : "text-neutral-400")}>{counts.responders}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("officials")}>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.officials ? "bg-purple-600" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.officials ? "text-[#43507f]" : "text-neutral-400")}>Officials</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.officials ? "text-[#2447b3]" : "text-neutral-400")}>{counts.officials}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("emergencies")}>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.emergencies ? "bg-red-600" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.emergencies ? "text-[#43507f]" : "text-neutral-400")}>Emergencies</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.emergencies ? "text-[#2447b3]" : "text-neutral-400")}>{counts.emergencies}</span>
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-2" onClick={() => onToggleLayer("concerns")}>
            <span className="flex items-center gap-2">
              <span className={cn("flex size-3 shrink-0 items-center justify-center rounded-full", layers.concerns ? "bg-orange-500" : "bg-neutral-300")} />
              <span className={cn("text-xs font-bold", layers.concerns ? "text-[#43507f]" : "text-neutral-400")}>Concerns</span>
            </span>
            <span className={cn("text-[11px] font-bold", layers.concerns ? "text-[#2447b3]" : "text-neutral-400")}>{counts.concerns}</span>
          </label>
        </div>
        )}
      </div>
      {selectedStreetNames.size ? (
        <div className="absolute bottom-4 right-4 z-[500] max-w-xs rounded-xl bg-white/95 px-4 py-3 text-xs font-semibold text-[#43507f] shadow-lg">
          Street filter: {[...selectedStreetNames].slice(0, 3).join(", ")}{selectedStreetNames.size > 3 ? ` +${selectedStreetNames.size - 3}` : ""}
        </div>
      ) : null}
    </div>
  )
}

function DetailPanel({
  selected,
  snapshot,
  onClose,
  onEmergencyUpdated,
}: {
  selected: Selection
  snapshot: LiveMapSnapshot
  onClose: () => void
  onEmergencyUpdated: (emergency: LiveMapEmergency) => void
}) {
  const navigate = useNavigate()
  const [assigningResponderId, setAssigningResponderId] = useState<number | null>(null)
  const [emergencyDetail, setEmergencyDetail] = useState<EmergencyAlert | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")
  const [detailRefreshKey, setDetailRefreshKey] = useState(0)
  const [teamAction, setTeamAction] = useState<
    | { kind: "replace"; responder: LiveMapPerson }
    | { kind: "remove"; assignmentId: number; responderName: string }
    | null
  >(null)
  const [teamReason, setTeamReason] = useState("")
  const [teamBusy, setTeamBusy] = useState(false)
  const selectedEmergency = selected?.kind === "emergency"
    ? snapshot.emergencies.find((item) => item.id === selected.id) ?? null
    : null
  const selectedEmergencyId = selectedEmergency?.id ?? null
  const selectedEmergencyUpdatedAt = selectedEmergency?.updated_at ?? null

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTeamAction(null)
      setTeamReason("")
    }, 0)
    return () => window.clearTimeout(timer)
  }, [selectedEmergencyId])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (!selectedEmergencyId) {
        setEmergencyDetail(null)
        setDetailError("")
        setDetailLoading(false)
        return
      }
      setDetailLoading(true)
      setDetailError("")
      void getEmergency(selectedEmergencyId)
        .then((next) => {
          if (!cancelled) setEmergencyDetail(next)
        })
        .catch((error) => {
          if (!cancelled) {
            setEmergencyDetail(null)
            setDetailError(error instanceof Error ? error.message : "Could not load complete incident details.")
          }
        })
        .finally(() => {
          if (!cancelled) setDetailLoading(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [selectedEmergencyId, selectedEmergencyUpdatedAt, detailRefreshKey])

  if (!selected) return null
  if (selected.kind === "person") {
    const person = snapshot.people.find((item) => item.id === selected.id)
    if (!person) return null
    return (
      <PanelShell title={person.full_name} badge={roleLabel(person.role)} onClose={onClose}>
        <InfoRow icon={<UserIcon className="size-4" />} label="Role" value={roleLabel(person.role)} />
        <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={person.address || person.barangay} />
        <InfoRow icon={<ClockIcon className="size-4" />} label="Last GPS" value={formatTime(person.location_updated_at)} />
        <InfoRow icon={<ShieldCheckIcon className="size-4" />} label="Duty" value={person.role === "first_responder" ? (person.is_on_duty ? "On duty" : "Off duty") : "Verified"} />
      </PanelShell>
    )
  }
  if (selected.kind === "concern") {
    const concern = snapshot.concerns.find((item) => item.id === selected.id)
    if (!concern) return null
    return (
      <PanelShell title={concern.title} badge="Concern" onClose={onClose}>
        <InfoRow icon={<AlertTriangleIcon className="size-4" />} label="Priority" value={concern.priority === "high" ? "High Priority" : "Normal"} />
        <InfoRow icon={<UserIcon className="size-4" />} label="Reported by" value={concern.reporter.full_name} />
        <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={concern.address || concern.barangay} />
        <p className="text-xs font-semibold leading-5 text-[#43507f]">{concern.description || "No description provided."}</p>
        <Button type="button" onClick={() => navigate(`/dashboard/reports/${concern.id}`)} className="w-full bg-[#07145f] text-white hover:bg-[#0b1b75]">View Full Details</Button>
      </PanelShell>
    )
  }
  const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
  if (!emergency) return null
  const currentEmergency = emergency
  const fullEmergency = emergencyDetail?.id === emergency.id ? emergencyDetail : null
  const activeTeamAssignments = fullEmergency?.assignments.filter(
    (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
  ) ?? []
  const route = snapshot.routes.find((item) => item.alert_id === emergency.id)
  const eligibleResponderUnits = emergency.type === "medical"
    ? ["bhw"]
    : emergency.type === "fire" || emergency.type === "disaster"
      ? ["bdrrmo"]
      : emergency.type === "crime"
        ? ["tanod"]
        : ["tanod", "bhw", "bdrrmo"]
  const availableResponders = snapshot.people.filter(
    (person) => person.role === "first_responder" && person.is_on_duty && eligibleResponderUnits.includes(person.responder_unit || ""),
  )
  function patchFromEmergencyAlert(next: EmergencyAlert, responder?: LiveMapPerson) {
    setEmergencyDetail(next)
    const assignment = next.current_assignment
    const liveResponder =
      responder ??
      (assignment
        ? snapshot.people.find((person) => person.id === assignment.responder.id) ?? {
            id: assignment.responder.id,
            full_name: assignment.responder.full_name,
            role: "first_responder" as const,
            barangay: assignment.responder.barangay || currentEmergency.barangay,
            address: assignment.responder.street || "",
            responder_unit: assignment.responder.responder_unit || "",
            is_on_duty: Boolean(assignment.responder.is_on_duty),
            latitude: null,
            longitude: null,
            location_updated_at: assignment.responder.last_seen_at,
          }
        : null)
    onEmergencyUpdated({
      ...currentEmergency,
      status: next.status,
      updated_at: next.updated_at,
      resolved_at: next.resolved_at,
      current_assignment:
        assignment && liveResponder
          ? {
              id: assignment.id,
              responder: liveResponder,
              status: assignment.status,
              last_location: assignment.last_location,
            }
          : null,
    })
  }
  async function assignResponder(responder: LiveMapPerson) {
    setAssigningResponderId(responder.id)
    try {
      const next = await assignEmergency(currentEmergency.id, responder.id)
      patchFromEmergencyAlert(next, responder)
      toast.success(`Assigned to ${responder.full_name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign responder.")
    } finally {
      setAssigningResponderId(null)
    }
  }
  async function confirmTeamAction() {
    if (!fullEmergency || !teamAction) return
    const reason = teamReason.trim()
    if (reason.length < 5) {
      toast.error("Add a brief operational reason before changing the response team.")
      return
    }
    setTeamBusy(true)
    try {
      const next = teamAction.kind === "replace"
        ? await reassignEmergency(fullEmergency.id, teamAction.responder.id, reason, fullEmergency.status_version)
        : await removeEmergencyAssignment(fullEmergency.id, teamAction.assignmentId, {
            reason,
            status_version: fullEmergency.status_version,
          })
      patchFromEmergencyAlert(
        next,
        teamAction.kind === "replace" ? teamAction.responder : undefined,
      )
      toast.success(teamAction.kind === "replace" ? "Primary responder replaced" : "Support responder removed")
      setTeamAction(null)
      setTeamReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the response team.")
    } finally {
      setTeamBusy(false)
    }
  }
  async function resolveSelected() {
    try {
      const next = await resolveEmergency(currentEmergency.id, "Marked resolved from Alerts Map.")
      patchFromEmergencyAlert(next)
      toast.success("Emergency marked resolved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark resolved.")
    }
  }
  async function copySummary() {
    const summary = [
      `${currentEmergency.type.replace(/_/g, " ")} emergency`,
      `Status: ${currentEmergency.status.replace(/_/g, " ")}`,
      `Reporter: ${currentEmergency.reporter.full_name}`,
      `Responder: ${currentEmergency.current_assignment?.responder.full_name || "Unassigned"}`,
      `Location: ${currentEmergency.address || currentEmergency.barangay}`,
      currentEmergency.note ? `Note: ${currentEmergency.note}` : "",
    ].filter(Boolean).join("\n")
    await navigator.clipboard?.writeText(summary)
    toast.success("Emergency summary copied")
  }
  return (
    <PanelShell title={`${emergency.type} emergency`} badge="Emergency" onClose={onClose}>
      <InfoRow icon={<AlertTriangleIcon className="size-4" />} label="Status" value={emergency.status.replace(/_/g, " ")} />
      <InfoRow icon={<UserIcon className="size-4" />} label="Reported by" value={emergency.reporter.full_name} />
      <InfoRow icon={<ShieldCheckIcon className="size-4" />} label="Responder" value={emergency.current_assignment?.responder.full_name || "Unassigned"} />
      <InfoRow icon={<NavigationIcon className="size-4" />} label="Route" value={`${formatDistance(route?.distance_meters ?? null)} · ${formatEta(route?.eta_seconds ?? null)}`} />
      <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={emergency.address || emergency.barangay} />
      <p className="text-xs font-semibold leading-5 text-[#43507f]">{emergency.note || "No note provided."}</p>
      {detailLoading && !fullEmergency ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] px-3 py-3 text-xs font-bold text-[#43507f]">
          <LoaderCircleIcon className="size-4 animate-spin text-[#2447b3]" />
          Loading complete incident record…
        </div>
      ) : null}
      {detailError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-bold text-red-800">{detailError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setDetailRefreshKey((value) => value + 1)} className="mt-2 border-red-200 bg-white text-red-700">
            Retry details
          </Button>
        </div>
      ) : null}
      {fullEmergency ? (
        <>
          <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
              <UsersIcon className="size-4 text-[#2447b3]" /> Response team
            </div>
            <div className="mt-2 grid gap-2">
              {fullEmergency.assignments.length ? fullEmergency.assignments.map((assignment) => {
                const active = !["cancelled", "declined", "resolved"].includes(assignment.status)
                return (
                <div key={assignment.id} className={cn("flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2", !active && "opacity-60")}>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black text-[#07145f]">{assignment.responder.full_name}</p>
                    <p className="text-[11px] font-semibold text-[#68739c]">{assignment.responder.responder_unit || "Responder"} · assigned {formatTime(assignment.assigned_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded-md bg-[#e8efff] px-2 py-1 text-[10px] font-black capitalize text-[#2447b3]">{assignment.status.replace(/_/g, " ")}</span>
                    {active && activeTeamAssignments.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTeamAction({ kind: "remove", assignmentId: assignment.id, responderName: assignment.responder.full_name })
                          setTeamReason("")
                        }}
                        className="rounded-md px-2 py-1 text-[10px] font-black text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              )}) : (
                <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#68739c]">No responder assignment has been recorded.</p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-[#dfe7f5] bg-white p-3">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
              <ClockIcon className="size-4 text-[#2447b3]" /> Incident timeline
            </div>
            <div className="mt-3 grid gap-0">
              {fullEmergency.status_events.length ? fullEmergency.status_events.slice(-6).map((event, index, events) => (
                <div key={event.id} className="relative grid grid-cols-[18px_1fr] gap-2 pb-3 last:pb-0">
                  {index < events.length - 1 ? <span className="absolute left-[6px] top-3 h-full w-px bg-[#dfe7f5]" /> : null}
                  <span className="relative mt-1 size-3 rounded-full border-2 border-white bg-[#2447b3] ring-1 ring-[#b9c9f4]" />
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <p className="text-xs font-black capitalize text-[#07145f]">{event.status.replace(/_/g, " ")}</p>
                      <time className="text-[10px] font-semibold text-[#68739c]">{formatTime(event.created_at)}</time>
                    </div>
                    <p className="mt-0.5 text-[11px] font-semibold leading-4 text-[#68739c]">{event.note || `Status updated by ${event.actor?.full_name || "system"}.`}</p>
                  </div>
                </div>
              )) : (
                <p className="text-xs font-semibold text-[#68739c]">No lifecycle events recorded.</p>
              )}
            </div>
          </div>

          {fullEmergency.media.length ? (
            <div className="rounded-xl border border-[#dfe7f5] bg-white p-3">
              <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
                <FileImageIcon className="size-4 text-[#2447b3]" /> Protected evidence
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {fullEmergency.media.map((media) => (
                  <button key={media.id} type="button" onClick={() => void openAuthenticatedMedia(media.raw_url, media.original_filename)} className="overflow-hidden rounded-lg border border-[#dfe7f5] bg-[#f8fafc] text-left">
                    {media.mime_type.startsWith("image/") ? (
                      <AuthenticatedMediaImage src={media.preview_url || media.raw_url} alt={media.original_filename} className="h-24 w-full object-cover" />
                    ) : (
                      <span className="flex h-24 items-center justify-center px-2 text-center text-xs font-bold text-[#2447b3]">Open video evidence</span>
                    )}
                    <span className="block truncate px-2 py-2 text-[10px] font-bold text-[#43507f]">{media.original_filename}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {fullEmergency.escalations.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-black uppercase text-amber-800">Escalation history</p>
              <div className="mt-2 grid gap-2">
                {fullEmergency.escalations.map((escalation) => (
                  <div key={escalation.id} className="text-xs font-semibold leading-5 text-amber-950">
                    <span className="font-black">{formatTime(escalation.created_at)}</span> · {escalation.reason}
                    {escalation.escalated_to ? ` · Routed to ${escalation.escalated_to.full_name}` : ""}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[#68739c]">
              <BellRingIcon className="size-4 text-[#2447b3]" /> Nearby resident notification
            </div>
            {fullEmergency.witness_notification_summary?.triggered ? (
              <div className="mt-2 grid gap-1 text-xs font-semibold leading-5 text-[#43507f]">
                <p>Selected <strong>{fullEmergency.witness_notification_summary.recipient_count}</strong> verified nearby resident{fullEmergency.witness_notification_summary.recipient_count === 1 ? "" : "s"}; <strong>{fullEmergency.witness_notification_summary.in_app_delivered_count}</strong> received an in-app notice and <strong>{fullEmergency.witness_notification_summary.read_count}</strong> opened it.</p>
                <p><strong>{fullEmergency.witness_notification_summary.push_delivered_count}</strong> browser push deliver{fullEmergency.witness_notification_summary.push_delivered_count === 1 ? "y" : "ies"}{fullEmergency.witness_notification_summary.push_failure_count ? `; ${fullEmergency.witness_notification_summary.push_failure_count} push attempt${fullEmergency.witness_notification_summary.push_failure_count === 1 ? "" : "s"} failed` : ""}.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs font-semibold text-[#68739c]">No nearby-resident safety notification was triggered.</p>
            )}
          </div>
        </>
      ) : null}
      <EmergencyChatPanel
        alertId={emergency.id}
        open
        theme="light"
        participantHint={
          activeTeamAssignments.length
            ? `Group · resident + ${activeTeamAssignments.length} responder${activeTeamAssignments.length === 1 ? "" : "s"}`
            : emergency.current_assignment
              ? `Group · resident + ${emergency.current_assignment.responder.full_name}`
              : "Group chat opens after a responder is assigned"
        }
        disabled={
          !emergency.current_assignment ||
          emergency.status === "cancelled" ||
          emergency.status === "resolved"
        }
        className="min-h-[320px]"
      />
      <div className="grid gap-2">
        <Button type="button" onClick={() => navigate(`/dashboard/emergencies?alert=${emergency.id}`)} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">Open in Emergency Operations</Button>
        <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
          <p className="text-[11px] font-black uppercase text-[#68739c]">Assign responder</p>
          <div className="mt-2 grid gap-2">
            {availableResponders.length === 0 ? (
              <p className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#68739c]">
                No on-duty responders with live status.
              </p>
            ) : (
              availableResponders.slice(0, 4).map((responder) => {
                const alreadyActive = activeTeamAssignments.some((assignment) => assignment.responder.id === responder.id)
                return (
                <div
                  key={responder.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-bold text-[#07145f]"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{responder.full_name}</span>
                    <span className="block text-[11px] font-semibold text-[#68739c]">
                      {responder.responder_unit || "responder"} · on duty
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={assigningResponderId !== null || alreadyActive}
                      onClick={() => void assignResponder(responder)}
                      className="rounded-md px-2 py-1 text-[#ff6a1a] hover:bg-orange-50 disabled:text-neutral-400"
                    >
                      {assigningResponderId === responder.id ? "Adding" : alreadyActive ? "Assigned" : "Add"}
                    </button>
                    {!alreadyActive && activeTeamAssignments.length ? (
                      <button
                        type="button"
                        disabled={assigningResponderId !== null}
                        onClick={() => {
                          setTeamAction({ kind: "replace", responder })
                          setTeamReason("")
                        }}
                        className="rounded-md px-2 py-1 text-[#2447b3] hover:bg-[#e8efff]"
                      >
                        Replace
                      </button>
                    ) : null}
                  </span>
                </div>
              )})
            )}
          </div>
          {teamAction ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-black text-amber-950">
                {teamAction.kind === "replace"
                  ? `Replace the active response team with ${teamAction.responder.full_name}?`
                  : `Remove ${teamAction.responderName} from this response?`}
              </p>
              <label className="mt-2 block text-[11px] font-bold text-amber-900" htmlFor={`team-reason-${currentEmergency.id}`}>
                Operational reason
              </label>
              <textarea
                id={`team-reason-${currentEmergency.id}`}
                value={teamReason}
                onChange={(event) => setTeamReason(event.target.value)}
                maxLength={255}
                rows={2}
                placeholder="Explain why this assignment is changing"
                className="mt-1 w-full resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-[#07145f] outline-none focus:border-[#ff6a1a]"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant="outline" disabled={teamBusy} onClick={() => { setTeamAction(null); setTeamReason("") }}>
                  Keep team
                </Button>
                <Button type="button" size="sm" disabled={teamBusy || teamReason.trim().length < 5} onClick={() => void confirmTeamAction()} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">
                  {teamBusy ? "Updating" : "Confirm change"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => void copySummary()}>Copy Summary</Button>
          <Button type="button" variant="outline" onClick={() => void resolveSelected()} className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">Mark Resolved</Button>
        </div>
      </div>
    </PanelShell>
  )
}

function PanelShell({ title, badge, onClose, children }: { title: string; badge: string; onClose: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase text-[#2447b3]">Alert Details</p>
          <h2 className="mt-1 text-base font-black capitalize text-[#07145f]">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-black text-red-700">{badge}</span>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-[#68739c] hover:bg-[#f8fafc]" aria-label="Close details"><XIcon className="size-4" /></button>
        </div>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  )
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-xs font-semibold text-[#43507f]">
      <span className="mt-0.5 text-[#2447b3]">{icon}</span>
      <span className="min-w-24 text-[#68739c]">{label}</span>
      <span className="flex-1 font-bold text-[#07145f]">{value}</span>
    </div>
  )
}

function mergeUpdate(snapshot: LiveMapSnapshot, message: LiveMapUpdate): LiveMapSnapshot {
  if (message.type === "location.updated") {
    const person = message.payload.person
    const people = snapshot.people.some((item) => item.id === person.id)
      ? snapshot.people.map((item) => item.id === person.id ? person : item)
      : [...snapshot.people, person]
    return { ...snapshot, people }
  }
  if (message.type === "concern.created" || message.type === "concern.updated") {
    const concern = message.payload.concern
    const concerns = snapshot.concerns.some((item) => item.id === concern.id)
      ? snapshot.concerns.map((item) => item.id === concern.id ? concern : item)
      : [concern, ...snapshot.concerns]
    return { ...snapshot, concerns }
  }
  if (message.type === "emergency.created" || message.type === "emergency.updated") {
    const emergency = message.payload.emergency
    const emergencies = activeEmergencyStatuses.has(emergency.status)
      ? snapshot.emergencies.some((item) => item.id === emergency.id)
        ? snapshot.emergencies.map((item) => item.id === emergency.id ? emergency : item)
        : [emergency, ...snapshot.emergencies]
      : snapshot.emergencies.filter((item) => item.id !== emergency.id)
    const route = message.payload.route
    const routes = route
      ? snapshot.routes.some((item) => item.alert_id === route.alert_id)
        ? snapshot.routes.map((item) => item.alert_id === route.alert_id ? route : item)
        : [...snapshot.routes, route]
      : snapshot.routes
    return { ...snapshot, emergencies, routes }
  }
  if (message.type === "route.updated") {
    const route = message.payload.route
    const routes = snapshot.routes.some((item) => item.alert_id === route.alert_id)
      ? snapshot.routes.map((item) => item.alert_id === route.alert_id ? route : item)
      : [...snapshot.routes, route]
    return { ...snapshot, routes }
  }
  return snapshot
}

export default function AlertsMapPage() {
  usePageTitle("Alerts Map")
  const { user } = useAuthSession()
  const [snapshot, setSnapshot] = useState<LiveMapSnapshot | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [layers, setLayers] = useState(defaultLayers)
  const [selected, setSelected] = useState<Selection>(() => {
    const alertId = Number(new URLSearchParams(window.location.search).get("alert"))
    return Number.isInteger(alertId) && alertId > 0 ? { kind: "emergency", id: alertId } : null
  })
  const [feedChip, setFeedChip] = useState<string>("all")

  async function load() {
    setError("")
    try {
      setSnapshot(await getOfficialLiveMap())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load official live map.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0)
    const interval = window.setInterval(() => void load(), 30000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false

    async function connect() {
      try {
        const ticket = await websocketTicket()
        if (closed) return
        socket = new WebSocket(
          websocketUrl(`/ws/dashboard/live-map/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), 5000)
        }
        return
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          if (message.type === "concern.ai_assessment.updated") {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", {
                detail: { concernId: message.payload.concern_id, source: "ai_assessment" },
              }),
            )
          }
          setSnapshot((current) => current ? mergeUpdate(current, message) : current)
        } catch {
          // Polling keeps the page correct if a live patch is malformed.
        }
      }
      socket.onclose = () => {
        if (!closed) {
          reconnectTimer = window.setTimeout(() => void connect(), 5000)
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [user?.id])

  const visibleConcerns = snapshot?.concerns.filter((item) => activeConcernStatuses.has(item.status)) ?? []
  const mapSelectedStreetNames = useMemo(() => new Set<string>(), [])

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  function updateEmergency(next: LiveMapEmergency) {
    setSnapshot((current) => current ? { ...current, emergencies: current.emergencies.map((item) => item.id === next.id ? next : item) } : current)
  }

  function updatePolicy(next: MapDispatchPolicy) {
    setSnapshot((current) => current ? { ...current, map: { ...current.map, dispatch_policy: next } } : current)
  }

  const filteredConcerns = useMemo(() => {
    if (!snapshot) return []
    let items = visibleConcerns
    if (feedChip === "emergencies") return []
    if (feedChip !== "all") items = items.filter((c) => c.category === feedChip)
    return items
  }, [snapshot, visibleConcerns, feedChip])

  const feedItems = useMemo(() => {
    if (!snapshot) return []
    const items: Array<{ kind: "emergency" | "concern"; id: number; title: string; sub: string; time: string; priority?: string }> = []
    if (feedChip === "all" || feedChip === "emergencies") {
      for (const em of snapshot.emergencies) {
        items.push({ kind: "emergency", id: em.id, title: `${em.type} emergency`, sub: em.address || em.barangay, time: em.created_at })
      }
    }
    if (feedChip !== "emergencies") {
      for (const c of filteredConcerns) {
        items.push({ kind: "concern", id: c.id, title: c.title, sub: c.address || c.barangay, time: c.created_at, priority: c.priority })
      }
    }
    items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    return items.slice(0, 20)
  }, [snapshot, filteredConcerns, feedChip])

  const feedChips = ["all", "concerns", "emergencies"] as const

  if (!loaded) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    )
  }

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col bg-white text-neutral-900">
      {/* Selected detail view */}
      {selected ? (
        selected.kind === "emergency" || selected.kind === "concern" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-1 px-2 pb-1 pt-3">
              <button type="button" onClick={() => setSelected(null)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100" aria-label="Back to list"><ChevronLeftIcon className="size-5" strokeWidth={2.25} /></button>
              <p className="min-w-0 flex-1 truncate text-left text-[15px] font-semibold text-neutral-600">{selected.kind === "emergency" ? "Emergency" : "Report"}</p>
              <button type="button" onClick={() => setSelected(null)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-100" aria-label="Close"><XIcon className="size-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
              {snapshot ? <DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyUpdated={updateEmergency} /> : null}
            </div>
          </div>
        ) : (
          snapshot ? <DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyUpdated={updateEmergency} /> : null
        )
      ) : (
        <>
          <div className="shrink-0 bg-white px-4 pb-2 pt-3 sm:pt-4">
            <h1 className="text-[18px] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[20px]">Alerts in Marikina Heights</h1>
          </div>
          <div className="relative shrink-0 px-3 pb-2 sm:pb-3">
            <div className="flex min-w-0 gap-1.5 overflow-x-auto overscroll-contain pb-0.5 [scrollbar-width:thin]">
              {feedChips.map((chip) => (
                <button key={chip} type="button" onClick={() => setFeedChip(chip)} className={cn("flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[12px] font-semibold whitespace-nowrap transition-colors sm:text-[13px]", feedChip === chip ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50")}>
                  {chip === "all" ? "All" : chip.charAt(0).toUpperCase() + chip.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
            {feedItems.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <p className="text-[14px] font-semibold text-neutral-800">No alerts</p>
                <p className="mt-1 text-[12px] text-neutral-500">No matching alerts right now.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {feedItems.map((item) => (
                  <button key={`${item.kind}-${item.id}`} type="button" onClick={() => setSelected({ kind: item.kind, id: item.id })} className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-neutral-300">
                    <div className="flex items-start gap-2.5">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10", item.kind === "emergency" ? "bg-red-100 text-red-600" : "bg-orange-100 text-orange-600")}>
                        {item.kind === "emergency" ? <SirenIcon className="size-4 sm:size-5" /> : <AlertTriangleIcon className="size-4 sm:size-5" />}
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="min-w-0 truncate text-[13px] font-bold text-neutral-900 sm:text-[14px]">{item.title}</p>
                        <p className="mt-0.5 text-[11px] text-neutral-500 sm:text-[12px]">{item.sub} · {formatTime(item.time).split(",").at(-1)?.trim()}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 bg-white">
      {/* Desktop: left panel */}
      <div className="hidden w-80 shrink-0 border-r border-neutral-200 md:block">
        {panelBody}
      </div>

      {/* Map area */}
      <div className="relative min-w-0 flex-1">
        {error ? (
          <div role="alert" className="absolute left-3 right-3 top-3 z-[700] rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 shadow-sm">
            {error}
          </div>
        ) : null}
        {snapshot ? (
          <AlertsLeafletMap snapshot={snapshot} layers={layers} selected={selected} selectedStreetNames={mapSelectedStreetNames} onSelect={setSelected} onToggleLayer={toggleLayer} onResetLayers={() => setLayers(defaultLayers)} onPolicyUpdated={updatePolicy} counts={{ residents: snapshot.summary.residents, responders: snapshot.summary.responders, officials: snapshot.summary.officials, emergencies: snapshot.emergencies.length, concerns: visibleConcerns.length, routes: snapshot.routes.filter((r) => r.status === "ok").length }} />
        ) : null}

        {/* Mobile: bottom sheet */}
        <div className="absolute inset-x-0 bottom-0 z-40 md:hidden">
          <div className="mx-auto -mb-1 flex h-6 w-full items-center justify-center">
            <span className="h-1 w-10 rounded-full bg-neutral-400" />
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded-t-2xl border border-neutral-200 border-b-0 bg-white shadow-[0_-12px_40px_rgba(15,23,42,.14)]">
            {panelBody}
          </div>
        </div>
      </div>
    </div>
  )
}
