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
import { getAccessToken, websocketUrl } from "@/lib/api"
import { createEmergencyAppeal, getEmergency, type EmergencyAlert, type EmergencyStatus } from "@/features/dashboard/emergency-api"

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

function activeStepIndex(status: EmergencyStatus) {
  if (status === "submitted") return 0
  if (status === "routed" || status === "acknowledged") return 1
  if (status === "en_route" || status === "nearby") return 2
  return 3
}

function EmergencyTrackingMap({ alert }: { alert: EmergencyAlert }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const lastLocation = alert.current_assignment?.last_location

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      const resident: leaflet.LatLngTuple = [Number(alert.latitude), Number(alert.longitude)]
      const responder: leaflet.LatLngTuple | null = lastLocation
        ? [Number(lastLocation.latitude), Number(lastLocation.longitude)]
        : null

      mapRef.current?.remove()
      map = L.map(containerRef.current, {
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

      if (responder) {
        const responderIcon = L.divIcon({
          className: "",
          html: `<div style="width:28px;height:28px;border-radius:999px;background:#2447b3;border:4px solid white;box-shadow:0 10px 22px rgba(36,71,179,.35),0 0 0 10px rgba(36,71,179,.14)"></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        })
        L.polyline([responder, resident], {
          color: "#ef4444",
          dashArray: "8 8",
          opacity: 0.9,
          weight: 4,
        }).addTo(map)
        L.marker(responder, { icon: responderIcon }).addTo(map)
        map.fitBounds(L.latLngBounds([resident, responder]), { padding: [40, 40], maxZoom: 17 })
      } else {
        map.setView(resident, 16)
      }

      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      map?.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [alert.id, alert.latitude, alert.longitude, lastLocation?.latitude, lastLocation?.longitude])

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

  useEffect(() => {
    setAlert(initialAlert)
  }, [initialAlert])

  useEffect(() => {
    if (!open || !alert || !activeStatuses.includes(alert.status)) return
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
  }, [open, alert?.id, alert?.status])

  useEffect(() => {
    if (!open || !alert || !activeStatuses.includes(alert.status)) return
    const token = getAccessToken()
    if (!token) return

    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let closedByComponent = false

    function connect() {
      socket = new WebSocket(websocketUrl(`/ws/emergencies/${alert?.id}/tracking/?token=${encodeURIComponent(token)}`))
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
        if (!closedByComponent) {
          reconnectTimer = window.setTimeout(connect, 5000)
        }
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()
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
  const canAppeal = Boolean(alert && ["resolved", "cancelled"].includes(alert.status) && !pendingAppeal)
  const appealHistory = alert?.appeals ?? []

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

  if (!open || !alert) return null

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/40 p-0 md:items-center md:p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl md:rounded-2xl">
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
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="relative h-64 bg-muted">
              <EmergencyTrackingMap alert={alert} />
              <div className="absolute left-3 top-3 flex flex-col gap-2">
                <Badge className="bg-red-600 text-white">Your location</Badge>
                {lastLocation ? <Badge className="bg-[#2447b3] text-white">Responder GPS {formatTime(lastLocation.created_at)}</Badge> : null}
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/95 px-3 py-2 text-xs font-semibold text-[#07145f] shadow-sm">
                <span>{lastLocation ? "Responder path fallback" : "Waiting for responder GPS ping"}</span>
                {distance !== null ? <span className="text-red-600">{formatDistance(distance)} · {formatEta(distance)}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
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

            <div className="rounded-xl border border-border bg-card p-4">
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

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Status timeline</p>
            {(function EmergencyStatusLine() {
              const steps = [
                { key: "submitted" as const, label: "Submitted" },
                { key: "routed" as const, label: "Routed" },
                { key: "en_route" as const, label: "En route" },
                { key: "arrived" as const, label: "Arrived" },
              ]
              const currentIdx = activeStepIndex(alert.status)

              return (
                <div className="relative mt-4 grid grid-cols-4 gap-2">
                  <div className="absolute left-[10%] right-[10%] top-[13px] h-0.5 bg-[#dfe7f5]" />
                  <div className="absolute left-[10%] right-[10%] top-[13px] h-0.5">
                    <div
                      className="h-full bg-[#07145f]"
                      style={{ width: `${(Math.min(currentIdx, 3) / 3) * 100}%` }}
                    />
                  </div>
                  {steps.map((step, index) => {
                    const done = index < currentIdx
                    const current = index === currentIdx
                    return (
                      <div key={step.key} className="relative z-10 flex flex-col items-center text-center">
                        <div
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full border text-[11px] font-extrabold",
                            done && "border-[#07145f] bg-[#07145f] text-white",
                            current && "border-[#ff6a1a] bg-[#ff6a1a] text-white",
                            !done && !current && "border-[#cbd8ee] bg-white text-[#68739c]",
                          )}
                        >
                          {done ? <CheckIcon className="size-4" /> : index + 1}
                        </div>
                        <p className="mt-2 text-[11px] font-extrabold text-[#07145f]">{step.label}</p>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          <div className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">Resident location</p>
                <p className="text-xs text-muted-foreground">{Number(alert.latitude).toFixed(5)}, {Number(alert.longitude).toFixed(5)}</p>
              </div>
            </div>
          </div>

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

        <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Keep tracking
          </Button>
        </div>
      </div>
    </div>
  )
}
