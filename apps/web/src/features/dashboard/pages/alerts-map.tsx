import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  AlertTriangleIcon,
  BellIcon,
  ClockIcon,
  DownloadIcon,
  HomeIcon,
  LayersIcon,
  MapPinIcon,
  NavigationIcon,
  RefreshCwIcon,
  RouteIcon,
  SearchIcon,
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
  type LiveMapEmergency,
  type LiveMapGeometry,
  type LiveMapPerson,
  type LiveMapSnapshot,
  type LiveMapUpdate,
} from "@/features/dashboard/api"
import { resolveEmergency } from "@/features/dashboard/emergency-api"
import { Topbar } from "@/features/dashboard/components/topbar"
import { usePageTitle } from "@/hooks/use-page-title"
import { getAccessToken, websocketUrl } from "@/lib/api"

import type leaflet from "leaflet"

type LayerKey = "boundary" | "streets" | "residents" | "officials" | "responders" | "concerns" | "emergencies" | "routes"
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
}

const activeConcernStatuses = new Set(["submitted", "under_review", "in_progress", "appealed"])
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

function markerHtml(color: string, text: string, pulse = false) {
  return `<div style="width:30px;height:30px;border-radius:999px;background:${color};border:4px solid white;box-shadow:0 10px 22px rgba(7,20,95,.22),0 0 0 ${pulse ? 12 : 0}px ${color}22;display:flex;align-items:center;justify-content:center;color:white;font-size:13px;font-weight:900">${text}</div>`
}

function AlertsLeafletMap({
  snapshot,
  layers,
  selected,
  selectedStreetNames,
  onSelect,
  onToggleLayer,
  onResetLayers,
}: {
  snapshot: LiveMapSnapshot
  layers: Record<LayerKey, boolean>
  selected: Selection
  selectedStreetNames: Set<string>
  onSelect: (selection: Selection) => void
  onToggleLayer: (key: LayerKey) => void
  onResetLayers: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const dynamicLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryRef = useRef<leaflet.GeoJSON | null>(null)
  const streetLines = useMemo<StreetLine[]>(() => {
    return snapshot.map.streets.streets.flatMap((street) =>
      (street.geometries ?? []).flatMap((geometry) => geoJsonToLines(geometry).map((line) => ({ name: street.name, line }))),
    )
  }, [snapshot.map.streets.streets])
  const streetKey = [...selectedStreetNames].sort().join("|")

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
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      map.zoomControl.setPosition("topleft")
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
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
      const color = concern.priority === "high" ? "#dc2626" : "#f97316"
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerHtml(color, "!", concern.priority === "high"), iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).on("click", () => onSelect({ kind: "concern", id: concern.id })).addTo(group)
    }

    for (const emergency of snapshot.emergencies) {
      if (!layers.emergencies) continue
      const coord = validCoord(emergency.latitude, emergency.longitude)
      if (!coord) continue
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerHtml("#dc2626", "⚠", true), iconSize: [30, 30], iconAnchor: [15, 15] }),
      }).on("click", () => onSelect({ kind: "emergency", id: emergency.id })).addTo(group)
    }

    for (const person of snapshot.people) {
      const coord = validCoord(person.latitude, person.longitude)
      if (!coord) continue
      if (person.role === "resident" && !layers.residents) continue
      if (person.role === "barangay_official" && !layers.officials) continue
      if (person.role === "first_responder" && !layers.responders) continue
      const color = person.role === "resident" ? "#2563eb" : person.role === "barangay_official" ? "#7c3aed" : "#0f3f9e"
      const text = person.role === "resident" ? "⌂" : person.role === "barangay_official" ? "★" : "🛡"
      L.marker(coord, {
        icon: L.divIcon({ className: "", html: markerHtml(color, text), iconSize: [30, 30], iconAnchor: [15, 15] }),
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
    <div className="relative h-full min-h-[560px] overflow-hidden rounded-2xl border border-[#dfe7f5] bg-[#dbeafe]">
      <div ref={containerRef} className="h-full min-h-[560px] w-full" />
      <div className="absolute right-4 top-4 z-[500] max-h-[calc(100%-2rem)] w-64 overflow-y-auto rounded-xl bg-white/95 p-4 text-xs font-bold text-[#43507f] shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black text-[#07145f]">Legend</h2>
          <button type="button" onClick={onResetLayers} className="text-[11px] font-black text-[#2447b3]">Reset All</button>
        </div>
        <div className="grid gap-2">
          <LayerToggle checked={layers.boundary} label="Barangay Boundary" color="#ef4444" onChange={() => onToggleLayer("boundary")} />
          <LayerToggle checked={layers.streets} label={layers.streets ? "Street catalog" : "Streets hidden"} color="#2563eb" onChange={() => onToggleLayer("streets")} />
          <LayerToggle checked={layers.residents} label="Residents" color="#2563eb" onChange={() => onToggleLayer("residents")} />
          <LayerToggle checked={layers.officials} label="Officials" color="#7c3aed" onChange={() => onToggleLayer("officials")} />
          <LayerToggle checked={layers.concerns} label="Concerns" color="#f97316" onChange={() => onToggleLayer("concerns")} />
          <LayerToggle checked={layers.emergencies} label="Emergencies" color="#dc2626" onChange={() => onToggleLayer("emergencies")} />
          <LayerToggle checked={layers.responders} label="Responders / Checkpoints" color="#0f3f9e" onChange={() => onToggleLayer("responders")} />
          <LayerToggle checked={layers.routes} label="OSM Emergency Routes / Paths" color="#2563eb" dashed onChange={() => onToggleLayer("routes")} />
        </div>
      </div>
      {selectedStreetNames.size ? (
        <div className="absolute bottom-4 right-4 z-[500] max-w-xs rounded-xl bg-white/95 px-4 py-3 text-xs font-semibold text-[#43507f] shadow-lg">
          Street filter: {[...selectedStreetNames].slice(0, 3).join(", ")}{selectedStreetNames.size > 3 ? ` +${selectedStreetNames.size - 3}` : ""}
        </div>
      ) : null}
    </div>
  )
}

function StatPill({ icon, label, value, active = false }: { icon: ReactNode; label: string; value: number; active?: boolean }) {
  return (
    <button type="button" className={cn("flex h-11 items-center gap-3 rounded-xl border px-4 text-xs font-extrabold shadow-sm", active ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-[#dfe7f5] bg-white text-[#07145f]")}>
      {icon}
      <span>{label}</span>
      <span className={cn("rounded-full px-2 py-0.5", active ? "bg-white/20" : "bg-[#eef3ff] text-[#2447b3]")}>{value}</span>
    </button>
  )
}

function LayerToggle({ checked, label, color, dashed = false, onChange }: { checked: boolean; label: string; color: string; dashed?: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-[#43507f]">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[#07145f]" />
      <span className={cn("h-0.5 w-5", dashed && "border-t-2 border-dashed bg-transparent")} style={{ background: dashed ? undefined : color, borderColor: color }} />
      {label}
    </label>
  )
}

function DetailPanel({
  selected,
  snapshot,
  onClose,
  onEmergencyResolved,
}: {
  selected: Selection
  snapshot: LiveMapSnapshot
  onClose: () => void
  onEmergencyResolved: (emergency: LiveMapEmergency) => void
}) {
  const navigate = useNavigate()
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
  const route = snapshot.routes.find((item) => item.alert_id === emergency.id)
  async function resolveSelected() {
    try {
      const next = await resolveEmergency(currentEmergency.id, "Marked resolved from Alerts Map.")
      onEmergencyResolved({ ...currentEmergency, status: next.status, updated_at: next.updated_at, resolved_at: next.resolved_at })
      toast.success("Emergency marked resolved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark resolved.")
    }
  }
  return (
    <PanelShell title={`${emergency.type} emergency`} badge="Emergency" onClose={onClose}>
      <InfoRow icon={<AlertTriangleIcon className="size-4" />} label="Status" value={emergency.status.replace(/_/g, " ")} />
      <InfoRow icon={<UserIcon className="size-4" />} label="Reported by" value={emergency.reporter.full_name} />
      <InfoRow icon={<ShieldCheckIcon className="size-4" />} label="Responder" value={emergency.current_assignment?.responder.full_name || "Unassigned"} />
      <InfoRow icon={<NavigationIcon className="size-4" />} label="Route" value={`${formatDistance(route?.distance_meters ?? null)} · ${formatEta(route?.eta_seconds ?? null)}`} />
      <InfoRow icon={<MapPinIcon className="size-4" />} label="Location" value={emergency.address || emergency.barangay} />
      <p className="text-xs font-semibold leading-5 text-[#43507f]">{emergency.note || "No note provided."}</p>
      <div className="grid gap-2">
        <Button type="button" onClick={() => navigate("/dashboard/emergencies")} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">View Full Details</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => toast.info("Use Emergency Ops to assign a specific responder.")}>Assign Responder</Button>
          <Button type="button" variant="outline" onClick={() => toast.info("Resident push alert workflow is managed in Notifications.")}>Send Alert</Button>
        </div>
        <Button type="button" variant="outline" onClick={() => void resolveSelected()} className="border-emerald-200 text-emerald-700 hover:bg-emerald-50">Mark Resolved</Button>
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
  const [search, setSearch] = useState("")
  const [layers, setLayers] = useState(defaultLayers)
  const [selected, setSelected] = useState<Selection>(null)
  const [selectedStreetMode, setSelectedStreetMode] = useState(false)
  const [selectedStreetNames, setSelectedStreetNames] = useState<Set<string>>(() => new Set(["Champagnat Street", "Santa Elena Street", "Narra Street"]))
  const [socketState, setSocketState] = useState("Connecting")

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
    void load()
    const interval = window.setInterval(() => void load(), 30000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const accessToken = getAccessToken() ?? ""
    if (!accessToken) return
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closed = false

    function connect() {
      setSocketState("Connecting")
      socket = new WebSocket(websocketUrl(`/ws/dashboard/live-map/?token=${encodeURIComponent(accessToken)}`))
      socket.onopen = () => setSocketState("Live")
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          setSnapshot((current) => current ? mergeUpdate(current, message) : current)
        } catch {
          // Polling keeps the page correct if a live patch is malformed.
        }
      }
      socket.onclose = () => {
        if (!closed) {
          setSocketState("Reconnecting")
          reconnectTimer = window.setTimeout(connect, 5000)
        }
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [user?.id])

  const filteredStreets = useMemo(() => {
    const streets = snapshot?.map.streets.streets ?? []
    const q = search.trim().toLowerCase()
    if (!q) return streets
    return streets.filter((street) => street.name.toLowerCase().includes(q))
  }, [snapshot, search])

  const visibleConcerns = snapshot?.concerns.filter((item) => activeConcernStatuses.has(item.status)) ?? []
  const responders = snapshot?.people.filter((item) => item.role === "first_responder") ?? []
  const mapSelectedStreetNames = useMemo(() => selectedStreetMode ? selectedStreetNames : new Set<string>(), [selectedStreetMode, selectedStreetNames])

  function toggleLayer(key: LayerKey) {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }

  function toggleStreet(name: string) {
    setSelectedStreetNames((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function updateEmergency(next: LiveMapEmergency) {
    setSnapshot((current) => current ? { ...current, emergencies: current.emergencies.map((item) => item.id === next.id ? next : item) } : current)
  }

  if (!loaded) {
    return (
      <div className="flex flex-col">
        <Topbar />
        <main className="min-h-screen bg-[#f7f8fc] p-4 md:p-6">
          <Skeleton className="h-20 rounded-2xl" />
          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]"><Skeleton className="h-[620px] rounded-2xl" /><Skeleton className="h-[620px] rounded-2xl" /></div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <Topbar />
      <main className="min-h-screen bg-[#f7f8fc] p-4 md:p-6">
        <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_560px_auto] xl:items-center">
          <div>
            <h1 className="font-heading text-3xl font-black text-[#07145f]">Alerts Map</h1>
            <p className="mt-1 text-sm font-semibold text-[#43507f]">Live monitoring and response for Marikina Heights</p>
          </div>
          <label className="flex h-12 items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white px-4 shadow-sm">
            <SearchIcon className="size-4 text-[#68739c]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search streets, residents, reports, or emergencies..." className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8]" />
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => toast.info("Create alerts from resident SOS or Emergency Ops.")}><BellIcon className="mr-2 size-4" />Create Alert</Button>
            <Button type="button" variant="outline" onClick={() => toast.info("Export will be added when report format is finalized.")}><DownloadIcon className="mr-2 size-4" />Export</Button>
            <Button type="button" variant="outline" onClick={() => void load()}><RefreshCwIcon className="mr-2 size-4" />Refresh</Button>
          </div>
        </div>

        {error ? <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        {snapshot ? (
          <>
            <div className="mb-4 flex gap-3 overflow-x-auto pb-1">
              <StatPill icon={<BellIcon className="size-4" />} label="All Alerts" value={snapshot.summary.active_alerts} active />
              <StatPill icon={<AlertTriangleIcon className="size-4 text-orange-600" />} label="Concerns" value={visibleConcerns.length} />
              <StatPill icon={<SirenIcon className="size-4 text-red-600" />} label="Emergencies" value={snapshot.emergencies.length} />
              <StatPill icon={<UsersIcon className="size-4 text-blue-600" />} label="Residents" value={snapshot.summary.residents} />
              <StatPill icon={<ShieldCheckIcon className="size-4 text-[#07145f]" />} label="Responders" value={snapshot.summary.responders} />
              <StatPill icon={<RouteIcon className="size-4 text-purple-600" />} label="Routes" value={snapshot.routes.filter((route) => route.status === "ok").length} />
              <span className={cn("ml-auto flex h-11 shrink-0 items-center rounded-xl border px-4 text-xs font-black", socketState === "Live" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{socketState}</span>
            </div>

            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0">
                <AlertsLeafletMap snapshot={snapshot} layers={layers} selected={selected} selectedStreetNames={mapSelectedStreetNames} onSelect={setSelected} onToggleLayer={toggleLayer} onResetLayers={() => setLayers(defaultLayers)} />
                <div className="mt-4 grid gap-3 md:grid-cols-6">
                  <SummaryCard icon={<BellIcon className="size-5" />} label="Total Active Alerts" value={snapshot.summary.active_alerts} />
                  <SummaryCard icon={<AlertTriangleIcon className="size-5" />} label="Community Concerns" value={visibleConcerns.length} />
                  <SummaryCard icon={<SirenIcon className="size-5" />} label="Active Emergencies" value={snapshot.emergencies.length} />
                  <SummaryCard icon={<ShieldCheckIcon className="size-5" />} label="Active Responders" value={responders.filter((person) => person.is_on_duty).length} />
                  <SummaryCard icon={<HomeIcon className="size-5" />} label="Residents Monitored" value={snapshot.summary.residents} />
                  <SummaryCard icon={<RouteIcon className="size-5" />} label="OSM Routes" value={snapshot.routes.filter((route) => route.status === "ok").length} />
                </div>
              </section>

              <aside className="space-y-4">
                <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-black text-[#07145f]">Street Visibility</h2>
                    <LayersIcon className="size-4 text-[#68739c]" />
                  </div>
                  <label className="flex items-center gap-2 text-xs font-bold text-[#43507f]"><input type="radio" checked={!selectedStreetMode} onChange={() => setSelectedStreetMode(false)} />Show All Streets</label>
                  <label className="mt-2 flex items-center gap-2 text-xs font-bold text-[#43507f]"><input type="radio" checked={selectedStreetMode} onChange={() => setSelectedStreetMode(true)} />Selected Streets <span className="rounded-full bg-[#eef3ff] px-2 py-0.5 text-[#2447b3]">{selectedStreetNames.size}</span></label>
                  <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
                    {filteredStreets.map((street) => (
                      <label key={street.id} className="flex items-center justify-between rounded-lg bg-[#f8fafc] px-3 py-2 text-xs font-bold text-[#43507f]">
                        <span>{street.name}{street.type ? ` (${street.type})` : ""}</span>
                        <input type="checkbox" checked={selectedStreetNames.has(street.name)} onChange={() => { setSelectedStreetMode(true); toggleStreet(street.name) }} />
                      </label>
                    ))}
                  </div>
                </section>

                <DetailPanel selected={selected} snapshot={snapshot} onClose={() => setSelected(null)} onEmergencyResolved={updateEmergency} />

                <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black text-[#07145f]">Recent Alerts</h2><span className="text-xs font-black text-[#2447b3]">View all</span></div>
                  <div className="space-y-3">
                    {[...snapshot.emergencies.map((item) => ({ kind: "emergency" as const, id: item.id, title: `${item.type} emergency`, sub: item.address || item.barangay, time: item.created_at })), ...visibleConcerns.map((item) => ({ kind: "concern" as const, id: item.id, title: item.title, sub: item.address || item.barangay, time: item.created_at }))].slice(0, 4).map((item) => (
                      <button key={`${item.kind}-${item.id}`} type="button" onClick={() => setSelected({ kind: item.kind, id: item.id })} className="flex w-full items-center gap-3 rounded-xl bg-[#f8fafc] p-3 text-left">
                        <span className={cn("flex size-8 items-center justify-center rounded-full text-white", item.kind === "emergency" ? "bg-red-600" : "bg-orange-500")}>!</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-[#07145f]">{item.title}</span><span className="block truncate text-[11px] font-semibold text-[#68739c]">{item.sub}</span></span>
                        <span className="text-[11px] font-bold text-[#68739c]">{formatTime(item.time).split(",").at(-1)?.trim()}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
                  <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black text-[#07145f]">Active Routes</h2><NavigationIcon className="size-4 text-[#68739c]" /></div>
                  <div className="space-y-3">
                    {snapshot.routes.slice(0, 3).map((route) => {
                      const emergency = snapshot.emergencies.find((item) => item.id === route.alert_id)
                      return (
                        <button key={route.assignment_id} type="button" onClick={() => setSelected({ kind: "emergency", id: route.alert_id })} className="flex w-full items-center gap-3 rounded-xl bg-[#f8fafc] p-3 text-left">
                          <span className="h-0.5 w-10 border-t-2 border-dashed border-[#2563eb]" />
                          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-black text-[#07145f]">{emergency?.current_assignment?.responder.full_name || "Responder"}</span><span className="block text-[11px] font-semibold text-[#68739c]">{formatDistance(route.distance_meters)} · {formatEta(route.eta_seconds)}</span></span>
                        </button>
                      )
                    })}
                    {snapshot.routes.length === 0 ? <p className="rounded-xl bg-[#f8fafc] p-4 text-center text-xs font-semibold text-[#68739c]">No active route yet.</p> : null}
                  </div>
                </section>
              </aside>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#dfe7f5] bg-white p-4 text-center shadow-sm">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full text-[#2447b3]">{icon}</div>
      <p className="mt-2 text-2xl font-black text-[#07145f]">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-[#68739c]">{label}</p>
    </div>
  )
}
