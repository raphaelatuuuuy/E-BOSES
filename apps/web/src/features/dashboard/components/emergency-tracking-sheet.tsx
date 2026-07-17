import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  MapPinIcon,
  NavigationIcon,
  PhoneCallIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { cancelEmergency, createEmergencyAppeal, getEmergency, type EmergencyAlert, type EmergencyStatus } from "@/features/dashboard/emergency-api"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"

import type leaflet from "leaflet"

const activeStatuses: EmergencyStatus[] = ["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"]

const statusLabels: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Routed",
  acknowledged: "Acknowledged",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

function statusText(alert: EmergencyAlert) {
  if (alert.status === "submitted") return "Waiting for barangay routing."
  if (alert.status === "routed") return "A responder has been assigned."
  if (alert.status === "acknowledged") return "Responder acknowledged your alert."
  if (alert.status === "en_route") return "Responder is on the way."
  if (alert.status === "nearby") return "Responder is near your location."
  if (alert.status === "arrived") return "Responder has arrived."
  if (alert.status === "resolved") return "Emergency has been resolved."
  return "Emergency was cancelled."
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earth = 6371000
  const toRad = (value: number) => value * Math.PI / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.max(20, Math.round(meters / 10) * 10)} m away`
  return `${(meters / 1000).toFixed(1)} km away`
}

function formatEta(meters: number) {
  const minutes = Math.max(1, Math.ceil(meters / 250))
  return `ETA ${minutes} min`
}

function EmergencyTrackingMap({ alert }: { alert: EmergencyAlert }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const leafletRef = useRef<typeof leaflet | null>(null)
  const responderMarkerRef = useRef<leaflet.Marker | null>(null)
  const routeRef = useRef<leaflet.Polyline | null>(null)
  const accuracyRef = useRef<leaflet.Circle | null>(null)
  const [mapReady, setMapReady] = useState(0)
  const lastLocation = alert.current_assignment?.last_location

  useEffect(() => {
    let cancelled = false

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      const resident: leaflet.LatLngTuple = [Number(alert.latitude), Number(alert.longitude)]
      leafletRef.current = L
      const map = L.map(containerRef.current, {
        center: resident,
        zoom: 16,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      })
      mapRef.current = map

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map)

      const residentIcon = L.divIcon({
        className: "",
        html: `<div style="width:28px;height:28px;border-radius:999px;background:#dc2626;border:4px solid white;box-shadow:0 10px 22px rgba(220,38,38,.38),0 0 0 12px rgba(220,38,38,.16)"></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      L.marker(resident, { icon: residentIcon }).addTo(map)
      setMapReady((value) => value + 1)
      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      leafletRef.current = null
      responderMarkerRef.current = null
      routeRef.current = null
      accuracyRef.current = null
    }
  }, [alert.id, alert.latitude, alert.longitude])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !lastLocation) return
    const resident: leaflet.LatLngTuple = [Number(alert.latitude), Number(alert.longitude)]
    const responder: leaflet.LatLngTuple = [Number(lastLocation.latitude), Number(lastLocation.longitude)]
    const responderIcon = L.divIcon({
      className: "",
      html: `<div style="width:28px;height:28px;border-radius:999px;background:#2447b3;border:4px solid white;box-shadow:0 4px 8px rgba(36,71,179,.32),0 0 0 8px rgba(36,71,179,.12)"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    })
    if (responderMarkerRef.current) responderMarkerRef.current.setLatLng(responder)
    else responderMarkerRef.current = L.marker(responder, { icon: responderIcon }).addTo(map)
    if (routeRef.current) routeRef.current.setLatLngs([responder, resident])
    else routeRef.current = L.polyline([responder, resident], { color: "#ff8133", opacity: 0.9, weight: 4 }).addTo(map)
    const accuracy = Math.max(0, lastLocation.accuracy ?? 0)
    if (accuracyRef.current) {
      accuracyRef.current.setLatLng(responder)
      accuracyRef.current.setRadius(accuracy)
    } else if (accuracy > 0) {
      accuracyRef.current = L.circle(responder, {
        radius: accuracy,
        color: "#2447b3",
        fillColor: "#2447b3",
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(map)
    }
    map.fitBounds(L.latLngBounds([resident, responder]), { padding: [44, 44], maxZoom: 17 })
  }, [alert.latitude, alert.longitude, lastLocation?.latitude, lastLocation?.longitude, lastLocation?.accuracy, mapReady])

  return <div ref={containerRef} className="h-full w-full bg-[#dbeafe]" />
}

export function EmergencyTrackingSheet({
  initialAlert,
  open,
  onOpenChange,
  onAlertChange,
}: {
  initialAlert: EmergencyAlert | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAlertChange?: (alert: EmergencyAlert) => void
}) {
  const [alert, setAlert] = useState<EmergencyAlert | null>(initialAlert)
  const [appealReason, setAppealReason] = useState("")
  const [appealBusy, setAppealBusy] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "degraded">("connecting")

  useEffect(() => {
    setAlert(initialAlert)
  }, [initialAlert])

  useEffect(() => {
    if (!open || !alert || !activeStatuses.includes(alert.status) || connectionState !== "degraded") return
    const interval = window.setInterval(async () => {
      try {
        const nextAlert = await getEmergency(alert.id)
        setAlert(nextAlert)
        onAlertChange?.(nextAlert)
      } catch {
        // Keep the last known state visible if a poll fails.
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [open, alert?.id, alert?.status, connectionState, onAlertChange])

  useEffect(() => {
    if (!open || !alert || !activeStatuses.includes(alert.status)) return
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closedByComponent = false
    let reconnectAttempts = 0

    async function connect() {
      if (!alert) return
      setConnectionState("connecting")
      try {
        const ticket = await websocketTicket()
        if (closedByComponent) return
        socket = new WebSocket(websocketUrl(`/ws/emergencies/${alert.id}/tracking/?ticket=${encodeURIComponent(ticket)}`))
      } catch {
        setConnectionState("degraded")
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** reconnectAttempts))
        return
      }
      socket.onopen = () => {
        reconnectAttempts = 0
        setConnectionState("live")
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: EmergencyAlert }
          if (message.type !== "emergency.update" || !message.payload) return
          setAlert(message.payload)
          onAlertChange?.(message.payload)
        } catch {
          // Ignore malformed realtime events; polling remains the fallback.
        }
      }
      socket.onclose = () => {
        setConnectionState("degraded")
        if (!closedByComponent) {
          reconnectAttempts += 1
          reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** reconnectAttempts))
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    void connect()
    return () => {
      closedByComponent = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [open, alert?.id, alert?.status, onAlertChange])

  const responder = alert?.current_assignment?.responder
  const lastLocation = alert?.current_assignment?.last_location
  const distance = alert && lastLocation
    ? distanceMeters(
        { lat: Number(lastLocation.latitude), lng: Number(lastLocation.longitude) },
        { lat: Number(alert.latitude), lng: Number(alert.longitude) },
      )
    : null
  const pendingAppeal = alert?.appeals?.find((appeal) => appeal.status === "submitted")
  const locationIsStale = Boolean(lastLocation && Date.now() - new Date(lastLocation.created_at).getTime() > 20_000)
  const canAppeal = Boolean(alert && ["resolved", "cancelled"].includes(alert.status) && !pendingAppeal)
  const appealHistory = alert?.appeals ?? []
  const canCancel = Boolean(alert && ["submitted", "routed"].includes(alert.status))

  async function submitAppeal() {
    if (!alert || !appealReason.trim()) return
    setAppealBusy(true)
    try {
      await createEmergencyAppeal(alert.id, appealReason.trim())
      const nextAlert = await getEmergency(alert.id)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      setAppealReason("")
      toast.success("Emergency review request submitted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit review request.")
    } finally {
      setAppealBusy(false)
    }
  }

  async function cancelActiveEmergency() {
    if (!alert || !canCancel) return
    setCancelBusy(true)
    try {
      const nextAlert = await cancelEmergency(alert.id)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      toast.success("Emergency alert cancelled")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel the emergency alert.")
    } finally {
      setCancelBusy(false)
    }
  }

  if (!open || !alert) return null

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg border border-border bg-background md:rounded-lg">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-full bg-red-100 text-red-700">
                <PhoneCallIcon className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Emergency Tracking</p>
                <p className="text-xs text-muted-foreground">Alert #{alert.id} &middot; {statusLabels[alert.status]}</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close emergency tracking"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="relative h-64 bg-muted">
              <EmergencyTrackingMap alert={alert} />
              <div className="absolute left-3 top-3 flex flex-col gap-2">
                <Badge className="bg-red-600 text-white">Your location</Badge>
                {lastLocation ? <Badge className="bg-[#2447b3] text-white">Responder GPS {formatTime(lastLocation.created_at)}</Badge> : null}
                <Badge className={connectionState === "live" ? "bg-emerald-700 text-white" : "bg-amber-600 text-white"}>
                  {connectionState === "live" ? "Live updates" : connectionState === "connecting" ? "Connecting" : "Polling fallback"}
                </Badge>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/95 px-3 py-2 text-xs font-semibold text-[#020c4e] shadow-sm">
                <span>{locationIsStale ? "Responder GPS is temporarily stale" : lastLocation ? `GPS accuracy ${Math.round(lastLocation.accuracy ?? 0)} m` : "Waiting for responder GPS ping"}</span>
                {distance !== null ? <span className="text-red-600">{formatDistance(distance)} · {formatEta(distance)}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <NavigationIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{statusText(alert)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {distance !== null ? `${formatDistance(distance)} · ${formatEta(distance)}` : alert.address || alert.barangay}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                  <ShieldCheckIcon className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{responder?.full_name ?? "Responder not assigned yet"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {responder ? `${responder.role.replace(/_/g, " ")}${lastLocation ? ` · GPS ${formatTime(lastLocation.created_at)}` : ""}` : "Barangay routing is pending."}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Status timeline</p>
            <ol className="mt-4 space-y-3">
              {alert.status_events.map((event, index) => (
                <li key={event.id} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2">
                  <span className={cn(
                    "flex size-7 items-center justify-center rounded-full border text-[11px] font-extrabold",
                    index === alert.status_events.length - 1
                      ? "border-[#ff6a1a] bg-[#ff6a1a] text-white"
                      : "border-[#07145f] bg-[#07145f] text-white",
                  )}>
                    <CheckIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-[#07145f]">{statusLabels[event.status]}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{event.note}</p>
                  </div>
                  <time className="text-[11px] text-muted-foreground">{formatTime(event.created_at)}</time>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">Resident location</p>
                <p className="text-xs text-muted-foreground">{Number(alert.latitude).toFixed(5)}, {Number(alert.longitude).toFixed(5)}</p>
              </div>
            </div>
          </div>

          {alert.media.length > 0 ? (
            <div className="mt-4 rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Emergency evidence</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {alert.media.map((media) => (
                  <button
                    key={media.id}
                    type="button"
                    className="overflow-hidden rounded-lg border border-border text-left"
                    onClick={() => {
                      void openAuthenticatedMedia(media.raw_url, media.original_filename).catch((error) => {
                        toast.error(error instanceof Error ? error.message : "Could not open emergency evidence.")
                      })
                    }}
                  >
                    <AuthenticatedMediaImage
                      src={media.preview_url}
                      alt={media.original_filename}
                      className="h-24 w-full object-cover"
                    />
                    <span className="block truncate px-2 py-2 text-[11px] font-semibold text-foreground">
                      {media.original_filename}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {appealHistory.length ? (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Post-incident review history</p>
              <div className="mt-3 space-y-2">
                {appealHistory.map((appeal) => (
                  <div
                    key={appeal.id}
                    className={cn(
                      "rounded-lg border p-3 text-xs font-semibold leading-5",
                      appeal.status === "approved" && "border-emerald-200 bg-emerald-50 text-emerald-800",
                      appeal.status === "denied" && "border-red-200 bg-red-50 text-red-800",
                      appeal.status === "submitted" && "border-orange-200 bg-orange-50 text-orange-800",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black">Review {appeal.status}</span>
                      <span>{formatTime(appeal.decided_at || appeal.created_at)}</span>
                    </div>
                    <p className="mt-2">{appeal.reason}</p>
                    {appeal.decision_note ? <p className="mt-2 font-bold">Decision: {appeal.decision_note}</p> : null}
                    {appeal.reviewed_by ? <p className="mt-1">Reviewed by {appeal.reviewed_by.full_name}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {canAppeal ? (
            <div className="mt-4 rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-semibold text-foreground">Request post-incident review</p>
              <p className="mt-1 text-xs text-muted-foreground">Use this only if the emergency was resolved, cancelled, or recorded incorrectly.</p>
              <textarea
                value={appealReason}
                onChange={(event) => setAppealReason(event.target.value)}
                placeholder="Explain what should be reviewed"
                className="mt-3 min-h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[#ff6a1a]"
              />
              <Button type="button" disabled={appealBusy || !appealReason.trim()} onClick={() => void submitAppeal()} className="mt-3 bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
                {appealBusy ? "Submitting" : "Submit review request"}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          {canCancel ? (
            <Button type="button" variant="outline" disabled={cancelBusy} onClick={() => void cancelActiveEmergency()} className="border-red-200 text-red-700 hover:bg-red-50">
              {cancelBusy ? "Cancelling" : "Cancel alert"}
            </Button>
          ) : <span />}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Keep tracking
          </Button>
        </div>
      </div>
    </div>
  )
}
