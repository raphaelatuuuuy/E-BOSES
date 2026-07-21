import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LocateFixedIcon,
  LoaderCircleIcon,
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  RadioIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useLocation } from "react-router-dom"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  listAssignedEmergencies,
  markEmergencyArrived,
  requestEmergencyBackup,
  sendEmergencyLocationPing,
  type EmergencyAlert,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import {
  commentOnConcern,
  listAssignedConcerns,
  listFeedConcerns,
  voteConcern,
  type Concern,
} from "@/features/dashboard/api"
import { ReportChatPanel } from "@/features/dashboard/components/report-chat-panel"
import { ConcernConversation } from "@/features/dashboard/components/concern-conversation"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import {
  MapControlButton,
} from "@/features/dashboard/components/map-weather"

import type leaflet from "leaflet"

const BARANGAY_CENTER: leaflet.LatLngTuple = [14.6507, 121.1133]
const SELECTED_DISPATCH_KEY = "eboses:responder-dispatch-id"

const statusLabel: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Responder routed",
  acknowledged: "Automatically routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

function validCoord(lat?: string | number | null, lng?: string | number | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function distanceKm(
  aLat?: string | number | null,
  aLng?: string | number | null,
  bLat?: string | number | null,
  bLng?: string | number | null,
) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function statusClass(status: EmergencyStatus) {
  if (status === "arrived" || status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "en_route" || status === "nearby") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "acknowledged" || status === "routed") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-red-200 bg-red-50 text-red-700"
}

function markerHtml(kind: "incident" | "responder", active = false) {
  const color = kind === "incident" ? "#f23b35" : "#145be7"
  const glyph = kind === "incident" ? "!" : "●"
  const size = active ? 38 : 30
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:4px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;box-shadow:0 8px 22px rgba(15,23,42,.24);font-family:Arial">${glyph}</div>`
}

function locationFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  const code = typeof error === "object" && error && "code" in error
    ? Number(error.code)
    : 0
  if (code === 1) return "Location permission was denied. Allow location for E-Boses in your browser settings, then try again."
  if (code === 2) return "Your location is unavailable. Move to an open area or turn on device location, then try again."
  if (code === 3) return "Location request timed out. Check your GPS signal and try again."
  return "Your location could not be read. Check device location access and try again."
}

function ResponderLeafletMap({
  alerts,
  concerns,
  selectedId,
  selectedConcernId,
  userPos,
  onSelect,
  onSelectConcern,
}: {
  alerts: EmergencyAlert[]
  concerns: Concern[]
  selectedId: number | null
  selectedConcernId: number | null
  userPos: GeolocationPosition | null
  onSelect: (id: number) => void
  onSelectConcern: (id: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layerRef = useRef<leaflet.LayerGroup | null>(null)
  const routeRef = useRef<leaflet.Polyline | null>(null)
  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      LRef.current = L
      map = L.map(containerRef.current, {
        center: BARANGAY_CENTER,
        zoom: 15,
        zoomControl: false,
        attributionControl: true,
      })
      mapRef.current = map
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
    }

    void init()
    return () => {
      cancelled = true
      if (map) map.remove()
      mapRef.current = null
      LRef.current = null
      layerRef.current = null
      routeRef.current = null
    }
  }, [])

  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return

    layer.clearLayers()
    if (routeRef.current) {
      routeRef.current.remove()
      routeRef.current = null
    }

    const bounds: leaflet.LatLngTuple[] = []
    const selected = alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null

    for (const alert of alerts) {
      const coord = validCoord(alert.latitude, alert.longitude)
      if (!coord) continue
      bounds.push(coord)
      const icon = L.divIcon({
        html: markerHtml("incident", alert.id === selected?.id),
        className: "",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      })
      L.marker(coord, { icon })
        .addTo(layer)
        .on("click", () => onSelect(alert.id))
        .bindTooltip(`${alert.type} emergency`, { direction: "top" })
    }

    for (const concern of concerns) {
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      bounds.push(coord)
      L.circleMarker(coord, {
        radius: concern.id === selectedConcernId ? 11 : 8,
        color: "#07145f",
        weight: 3,
        fillColor: "#ff8133",
        fillOpacity: 1,
      })
        .addTo(layer)
        .on("click", () => onSelectConcern(concern.id))
        .bindTooltip(`${concern.title} · community concern`, { direction: "top" })
    }

    if (userPos) {
      const coord: leaflet.LatLngTuple = [
        userPos.coords.latitude,
        userPos.coords.longitude,
      ]
      bounds.push(coord)
      L.marker(coord, {
        icon: L.divIcon({
          html: markerHtml("responder", true),
          className: "",
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      })
        .addTo(layer)
        .bindTooltip("Your location", { direction: "top" })

      const selectedCoord = selected ? validCoord(selected.latitude, selected.longitude) : null
      if (selectedCoord) {
        routeRef.current = L.polyline([coord, selectedCoord], {
          color: "#ff6a1a",
          dashArray: "7 7",
          weight: 4,
          opacity: 0.9,
        }).addTo(map)
      }
    }

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [42, 42], maxZoom: 17 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 16)
    } else {
      map.setView(BARANGAY_CENTER, 15)
    }
  }, [alerts, concerns, onSelect, onSelectConcern, selectedConcernId, selectedId, userPos])

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#eef3fb]">
      <div ref={containerRef} className="absolute inset-0" aria-label="Responder assignment map" />
      <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2 sm:right-4 sm:top-4">
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
      </div>
    </div>
  )
}

export default function ResponderMapPage() {
  usePageTitle("Responder Map")
  const location = useLocation()
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [assignedConcerns, setAssignedConcerns] = useState<Concern[]>([])
  const [assignedChatId, setAssignedChatId] = useState<number | null>(null)
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [selectedConcernId, setSelectedConcernId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [concernBusy, setConcernBusy] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [userPos, setUserPos] = useState<GeolocationPosition | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [detailsExpanded, setDetailsExpanded] = useState(true)
  const autoPingInFlightRef = useRef(false)
  const lastAutoPingRef = useRef<Record<number, number>>({})
  const concernCardRefs = useRef<Record<number, HTMLElement | null>>({})

  const preferredDispatchId = useMemo(() => {
    const queryId = Number(new URLSearchParams(location.search).get("alert"))
    const storedId = Number(window.localStorage.getItem(SELECTED_DISPATCH_KEY))
    return Number.isInteger(queryId) && queryId > 0
      ? queryId
      : Number.isInteger(storedId) && storedId > 0
        ? storedId
        : null
  }, [location.search])

  const selected = useMemo(
    () => alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null,
    [alerts, selectedId],
  )
  const selectedActiveTeam = useMemo(
    () => selected?.assignments.filter(
      (assignment) => !["cancelled", "declined", "resolved"].includes(assignment.status),
    ) ?? [],
    [selected],
  )

  const selectedDistance = useMemo(() => {
    if (!selected || !userPos) return null
    return distanceKm(
      userPos.coords.latitude,
      userPos.coords.longitude,
      selected.latitude,
      selected.longitude,
    )
  }, [selected, userPos])

  const visibleConcerns = useMemo(() => {
    if (!userPos) return concerns
    return concerns.filter((concern) => {
      const distance = distanceKm(
        userPos.coords.latitude,
        userPos.coords.longitude,
        concern.latitude,
        concern.longitude,
      )
      return distance == null || distance <= 10
    })
  }, [concerns, userPos])

  const mapConcerns = useMemo(() => {
    const byId = new Map<number, Concern>()
    for (const concern of [...visibleConcerns, ...assignedConcerns]) byId.set(concern.id, concern)
    return [...byId.values()]
  }, [visibleConcerns, assignedConcerns])

  const refresh = useCallback(async () => {
    setError("")
    const [next, nearbyConcerns, nextAssignedConcerns] = await Promise.all([
      listAssignedEmergencies(),
      listFeedConcerns(undefined, undefined, undefined, undefined).catch(() => []),
      listAssignedConcerns().catch(() => []),
    ])
    setAlerts(next)
    setConcerns(nearbyConcerns.filter((concern) => concern.visibility === "community").slice(0, 12))
    setAssignedConcerns(nextAssignedConcerns)
    setSelectedId((current) => {
      const nextId = [preferredDispatchId, current, next[0]?.id]
        .find((candidate) => candidate != null && next.some((alert) => alert.id === candidate)) ?? null
      if (nextId) window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(nextId))
      return nextId
    })
  }, [preferredDispatchId])

  const selectConcernFromMap = useCallback((concernId: number) => {
    setSelectedConcernId(concernId)
    window.requestAnimationFrame(() => {
      concernCardRefs.current[concernId]?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }, [])

  const selectDispatch = useCallback((alertId: number) => {
    window.localStorage.setItem(SELECTED_DISPATCH_KEY, String(alertId))
    setSelectedId(alertId)
    setDetailsExpanded(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => void refresh()
      .catch(() => {
        if (!cancelled) setError("Could not load assigned emergencies.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      }), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [refresh])

  useEffect(() => {
    function handleNotification(event: Event) {
      const notification = (event as CustomEvent<{ concern_id?: number | null }>).detail
      if (!notification?.concern_id) return
      void refresh().catch(() => setError("A concern assignment arrived, but the map could not refresh."))
    }
    window.addEventListener("eboses:notification-created", handleNotification)
    return () => window.removeEventListener("eboses:notification-created", handleNotification)
  }, [refresh])

  async function likeConcern(concern: Concern) {
    setConcernBusy(concern.id)
    try {
      const result = await voteConcern(concern.id, concern.user_vote === 1 ? 0 : 1)
      setConcerns((current) => current.map((item) => item.id === concern.id
        ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count }
        : item))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update support.")
    } finally {
      setConcernBusy(null)
    }
  }

  async function replyToConcern(concern: Concern) {
    const body = replyDraft.trim()
    if (!body) return
    setConcernBusy(concern.id)
    try {
      const comment = await commentOnConcern(concern.id, { body })
      setConcerns((current) => current.map((item) => item.id === concern.id
        ? { ...item, comments: [...item.comments, comment], comment_count: item.comment_count + 1 }
        : item))
      setReplyDraft("")
      setReplyOpenId(null)
      toast.success("Response posted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post response.")
    } finally {
      setConcernBusy(null)
    }
  }

  const requestPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!window.isSecureContext) {
        reject(new Error("Location requires a secure HTTPS connection. Open the secure E-Boses address and try again."))
        return
      }
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      })
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) setError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!cancelled) setUserPos(position)
      },
      (positionError) => {
        if (!cancelled) setError(locationFailureMessage(positionError))
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => {
      cancelled = true
      navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  useEffect(() => {
    if (!selected || !userPos || !["routed", "acknowledged", "en_route", "nearby", "arrived"].includes(selected.status)) {
      return
    }
    const alertId = selected.id
    const publish = async () => {
      const now = Date.now()
      if (autoPingInFlightRef.current || now - (lastAutoPingRef.current[alertId] ?? 0) < 15_000) return
      autoPingInFlightRef.current = true
      try {
        const next = await sendEmergencyLocationPing(alertId, {
          latitude: userPos.coords.latitude,
          longitude: userPos.coords.longitude,
          accuracy: userPos.coords.accuracy,
        })
        lastAutoPingRef.current[alertId] = Date.now()
        setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
        setError((current) => current === "Live GPS could not sync to this dispatch." ? "" : current)
      } catch {
        setError("Live GPS could not sync to this dispatch.")
      } finally {
        autoPingInFlightRef.current = false
      }
    }
    void publish()
    const timer = window.setInterval(() => void publish(), 15_000)
    return () => window.clearInterval(timer)
  }, [selected, userPos])

  async function locateMe() {
    setBusy("locate")
    try {
      const pos = await requestPosition()
      setUserPos(pos)
      toast.success("Location updated")
    } catch (positionError) {
      const message = locationFailureMessage(positionError)
      setError(message)
      toast.error(message)
    } finally {
      setBusy("")
    }
  }

  async function pingSelected() {
    if (!selected) return
    setBusy("ping")
    let pos: GeolocationPosition
    try {
      pos = await requestPosition()
      setUserPos(pos)
    } catch (positionError) {
      const message = locationFailureMessage(positionError)
      setError(message)
      toast.error(message)
      setBusy("")
      return
    }
    try {
      const next = await sendEmergencyLocationPing(selected.id, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      lastAutoPingRef.current[selected.id] = Date.now()
      setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
      setError("")
      toast.success("GPS sent to dispatch")
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
      const message = `GPS was found, but dispatch could not receive the update. Check your connection and try again.${detail}`
      setError(message)
      toast.error(message)
    } finally {
      setBusy("")
    }
  }

  async function arrivedSelected() {
    if (!selected) return
    setBusy("arrived")
    try {
      const next = await markEmergencyArrived(selected.id)
      setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
      toast.success("Marked arrived on scene")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update arrival.")
    } finally {
      setBusy("")
    }
  }

  async function requestBackup() {
    if (!selected) return
    setBusy("backup")
    try {
      const next = await requestEmergencyBackup(selected.id)
      setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
      const teamSize = next.assignments?.length ?? 0
      toast.success(
        teamSize > 1
          ? `Backup responder routed. ${teamSize} responders are now assigned.`
          : "Backup request recorded.",
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not request backup.")
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="relative h-[calc(100svh-3.5rem)] min-h-[500px] overflow-hidden bg-[#eef3fb] md:h-[calc(100svh-4rem)] md:min-h-[560px]">
      <section className="absolute inset-0">
        {loading ? (
          <div className="flex h-full items-center justify-center bg-white">
            <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
          </div>
        ) : (
          <ResponderLeafletMap
            alerts={alerts}
            concerns={mapConcerns}
            selectedId={selected?.id ?? null}
            selectedConcernId={selectedConcernId}
            userPos={userPos}
            onSelect={selectDispatch}
            onSelectConcern={selectConcernFromMap}
          />
        )}
        <div className="absolute left-3 top-3 z-[650] max-w-[calc(100%-5.5rem)] rounded-2xl border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:left-4 sm:top-4 sm:max-w-md sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-wide text-[#ff6a1a]">Responder map</p>
          <div className="mt-1 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-black text-[#07145f] sm:text-lg">Assigned incidents near you</h1>
              <p className="mt-0.5 hidden text-xs font-semibold text-neutral-600 sm:block">Your live GPS pin updates automatically while responding.</p>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void locateMe()} aria-label="Recenter on my current location">
              {busy === "locate" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <LocateFixedIcon className="size-4" />}
              <span className="hidden sm:inline">Recenter</span>
            </Button>
          </div>
          {error ? <p className="mt-2 text-xs font-bold leading-5 text-red-700">{error}</p> : null}
        </div>
      </section>

      <aside className={cn(
        "absolute inset-x-0 bottom-0 z-[700] space-y-3 overflow-y-auto rounded-t-3xl border border-neutral-200 bg-[#f8fafc]/98 p-3 shadow-2xl transition-[max-height] duration-200 lg:inset-y-4 lg:right-4 lg:left-auto lg:w-[390px] lg:max-h-none lg:rounded-3xl lg:p-3",
        detailsExpanded ? "max-h-[56svh]" : "max-h-[76px]",
      )}>
        <button
          type="button"
          onClick={() => setDetailsExpanded((current) => !current)}
          className="sticky top-0 z-10 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2 text-xs font-black text-[#07145f] shadow-sm lg:hidden"
          aria-expanded={detailsExpanded}
        >
          {detailsExpanded ? <ChevronDownIcon className="size-4" /> : <ChevronUpIcon className="size-4" />}
          {selected ? `${selected.type} dispatch` : `${alerts.length} active dispatches`}
        </button>
          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#07145f]">Selected dispatch</p>
                <p className="mt-1 text-xs font-semibold text-neutral-500">
                  {alerts.length} assigned incident{alerts.length === 1 ? "" : "s"}
                </p>
              </div>
              <RadioIcon className="size-5 text-[#ff6a1a]" />
            </div>

            {!selected ? (
              <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 p-5 text-center">
                <CheckCircleIcon className="mx-auto size-8 text-emerald-600" />
                <p className="mt-2 text-sm font-bold text-neutral-900">
                  No active assignments
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  New dispatches will appear here.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-neutral-200 bg-[#fffaf7] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-black uppercase text-red-600">
                        {selected.type} emergency
                      </p>
                      <h2 className="mt-1 text-lg font-black text-[#07145f]">
                        {selected.address || selected.barangay}
                      </h2>
                    </div>
                    <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-black", statusClass(selected.status))}>
                      {statusLabel[selected.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-neutral-600">
                    {selected.note || "No note provided."}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-neutral-500">
                    <MapPinIcon className="size-3.5" />
                    {selectedDistance == null
                      ? "Distance pending GPS"
                      : `${selectedDistance.toFixed(1)} km away`}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void pingSelected()}
                    className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
                  >
                    {busy === "ping" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <LocateFixedIcon className="size-4" />
                    )}
                    Send GPS · Mark en route
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busy) || !["en_route", "nearby"].includes(selected.status)}
                    onClick={() => void arrivedSelected()}
                  >
                    {busy === "arrived" ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <MapPinIcon className="size-4" />
                    )}
                    I have arrived on scene
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busy) || ["resolved", "cancelled"].includes(selected.status)}
                    onClick={() => void requestBackup()}
                  >
                    {busy === "backup" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <RadioIcon className="size-4" />}
                    Request backup
                  </Button>
                </div>

                <EmergencyChatPanel
                  alertId={selected.id}
                  open
                  theme="light"
                  disabled={["resolved", "cancelled"].includes(selected.status)}
                  participantHint={
                    selectedActiveTeam.length > 0
                      ? `Group · resident + ${selectedActiveTeam.length} responder${selectedActiveTeam.length === 1 ? "" : "s"}`
                      : "Group chat opens after an active responder is assigned"
                  }
                  className="min-h-[320px]"
                />
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#07145f]">Assigned concerns</p>
                <p className="mt-1 text-xs font-semibold text-neutral-500">
                  Field reports assigned to you by barangay officials.
                </p>
              </div>
              <span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-xs font-black text-[#07145f]">
                {assignedConcerns.length}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {assignedConcerns.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-neutral-200 p-4 text-xs font-semibold text-neutral-500">
                  No active concern assignments.
                </p>
              ) : assignedConcerns.map((concern) => (
                <article key={concern.id} className="rounded-2xl border border-neutral-200 bg-[#f8fafc] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-[#07145f]">{concern.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{concern.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-[#43507f] ring-1 ring-neutral-200">
                      {concern.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] font-bold text-neutral-500">
                    {concern.address || concern.barangay} · {concern.tracking_id}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => setAssignedChatId((current) => current === concern.id ? null : concern.id)}
                  >
                    {assignedChatId === concern.id ? "Close report chat" : "Open report chat"}
                  </Button>
                  {assignedChatId === concern.id ? (
                    <div className="mt-3 space-y-3">
                      <ConcernConversation items={concern.conversation ?? []} />
                      <ReportChatPanel
                        concernId={concern.id}
                        open
                        disabled={false}
                        showHistory={false}
                        title="Message this case"
                        subtitle="Your message is added to the shared case conversation."
                        onMessageSent={refresh}
                      />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-[#07145f]">Nearby community alerts</p>
                <p className="mt-1 text-xs font-semibold text-neutral-500">Like, respond, or open a nearby thread without leaving the map.</p>
              </div>
              <MapPinIcon className="size-5 text-[#ff6a1a]" />
            </div>
            <div className="mt-3 space-y-3">
              {visibleConcerns.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-neutral-200 p-4 text-xs font-semibold text-neutral-500">No nearby community alerts available.</p>
              ) : visibleConcerns.map((concern) => (
                <article
                  key={concern.id}
                  ref={(node) => { concernCardRefs.current[concern.id] = node }}
                  className={cn(
                    "rounded-2xl border bg-[#f8fafc] p-3 transition-colors",
                    selectedConcernId === concern.id ? "border-[#ff6a1a] ring-2 ring-[#ff6a1a]/15" : "border-neutral-200",
                  )}
                >
                  <p className="text-sm font-black text-[#07145f]">{concern.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{concern.description}</p>
                  <p className="mt-2 text-[11px] font-bold text-neutral-500">{concern.address || concern.barangay} · {concern.vote_count} support · {concern.comment_count} replies</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={concernBusy === concern.id} onClick={() => void likeConcern(concern)}>
                      {concern.user_vote === 1 ? "Supported" : "Like"}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReplyOpenId((value) => value === concern.id ? null : concern.id)}>
                      Respond / Reply
                    </Button>
                  </div>
                  {replyOpenId === concern.id ? (
                    <div className="mt-3 space-y-2">
                      <textarea value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Write a useful response…" rows={2} className="w-full resize-none rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#ff6a1a]" />
                      <Button type="button" size="sm" disabled={concernBusy === concern.id || !replyDraft.trim()} onClick={() => void replyToConcern(concern)} className="bg-[#07145f] text-white hover:bg-[#10227a]">Post response</Button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-black text-[#07145f]">Dispatch list</p>
            <div className="mt-3 space-y-2">
              {alerts.length === 0 ? (
                <p className="rounded-2xl bg-neutral-50 p-3 text-xs font-semibold text-neutral-500">
                  No assigned incidents.
                </p>
              ) : (
                alerts.map((alert) => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => selectDispatch(alert.id)}
                    className={cn(
                      "w-full rounded-2xl border p-3 text-left transition-colors",
                      selected?.id === alert.id
                        ? "border-[#ff6a1a] bg-[#fff4ed]"
                        : "border-neutral-200 bg-white hover:border-neutral-300",
                    )}
                  >
                    <p className="truncate text-sm font-black capitalize text-[#07145f]">
                      {alert.type} emergency
                    </p>
                    <p className="mt-1 truncate text-xs font-semibold text-neutral-500">
                      {alert.address || alert.barangay}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
  )
}
