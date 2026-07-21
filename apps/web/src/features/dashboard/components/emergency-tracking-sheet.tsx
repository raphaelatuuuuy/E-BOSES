import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  CheckIcon,
  CircleDotIcon,
  MapPinIcon,
  Maximize2Icon,
  Minimize2Icon,
  NavigationIcon,
  RadioIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { websocketTicket, websocketUrl } from "@/lib/api"
import {
  cancelEmergency,
  createEmergencyAppeal,
  getEmergency,
  type EmergencyAlert,
  type EmergencyChatMessage,
  type EmergencyStatus,
} from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import {
  AuthenticatedMediaImage,
  openAuthenticatedMedia,
} from "@/features/dashboard/components/authenticated-media"

import type leaflet from "leaflet"

const activeStatuses: EmergencyStatus[] = [
  "submitted",
  "routed",
  "en_route",
  "nearby",
  "arrived",
]

const statusLabels: Record<EmergencyStatus, string> = {
  submitted: "Alert sent",
  routed: "Responder assigned",
  acknowledged: "Responder routed",
  en_route: "On the way",
  nearby: "Nearby",
  arrived: "On scene",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

/** Unit aligned to SOS category (matches backend auto-route). */
function unitForEmergencyType(type: string) {
  if (type === "medical") return "BHW"
  if (type === "crime") return "Barangay Tanod"
  if (type === "fire" || type === "disaster") return "BDRRMO"
  return "on-duty responder"
}

/**
 * Resident-facing pipeline.
 * No “barangay desk / manual review” step — after send, system auto-routes
 * to the nearest on-duty responder for this emergency type.
 */
const PIPELINE: Array<{
  status: EmergencyStatus
  label: string
  defaultNote: (alert: EmergencyAlert) => string
  pendingHint: (alert: EmergencyAlert) => string
}> = [
  {
    status: "submitted",
    label: "Alert sent",
    defaultNote: () => "Your SOS was received by E-Boses.",
    pendingHint: () => "Waiting to send",
  },
  {
    status: "routed",
    label: "Responder assigned",
    defaultNote: (alert) =>
      `Auto-routed to the nearest on-duty ${unitForEmergencyType(alert.type)} for this ${alert.type} case.`,
    pendingHint: (alert) =>
      `Finding nearest on-duty ${unitForEmergencyType(alert.type)} for this case…`,
  },
  {
    status: "en_route",
    label: "On the way",
    defaultNote: () => "Responder is traveling to your location.",
    pendingHint: () => "Responder is preparing to travel",
  },
  {
    status: "nearby",
    label: "Nearby",
    defaultNote: () => "Responder is close to your location.",
    pendingHint: () => "Almost there",
  },
  {
    status: "arrived",
    label: "On scene",
    defaultNote: () => "Responder has arrived.",
    pendingHint: () => "Waiting for arrival",
  },
  {
    status: "resolved",
    label: "Resolved",
    defaultNote: () => "This emergency was closed.",
    pendingHint: () => "Closes when help finishes",
  },
]

type TimelineRow = {
  key: string
  status: EmergencyStatus
  label: string
  note: string
  time: string | null
  state: "done" | "current" | "pending" | "cancelled"
}

function buildStatusTimeline(alert: EmergencyAlert): TimelineRow[] {
  const events = [...(alert.status_events ?? [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const byStatus = new Map<EmergencyStatus, { note: string; time: string }>()
  for (const event of events) {
    const existing = byStatus.get(event.status)
    // Prefer the most useful note; keep earliest timestamp for the stage
    if (!existing) {
      byStatus.set(event.status, {
        note: event.note?.trim() || "",
        time: event.created_at,
      })
    } else {
      const note = event.note?.trim()
      if (note && note !== existing.note) {
        // Keep first time; append distinct later notes briefly
        if (!existing.note) existing.note = note
        else if (!existing.note.includes(note)) existing.note = `${existing.note} · ${note}`
      }
    }
  }

  const pipelineIndex = (status: EmergencyStatus) =>
    PIPELINE.findIndex((step) => step.status === status)

  let currentIdx = pipelineIndex(alert.status)
  if (alert.status === "cancelled") {
    // Mark progress up to last non-cancelled event
    const last = [...events].reverse().find((e) => e.status !== "cancelled")
    currentIdx = last ? Math.max(0, pipelineIndex(last.status)) : 0
  }

  const rows: TimelineRow[] = PIPELINE.map((step, index) => {
    const hit = byStatus.get(step.status)
    let state: TimelineRow["state"] = "pending"

    if (alert.status === "resolved") {
      state = "done"
    } else if (alert.status === "cancelled") {
      if (index <= Math.max(0, currentIdx)) state = "done"
      else state = "pending"
    } else if (currentIdx < 0) {
      state = index === 0 ? "current" : "pending"
    } else if (index < currentIdx) {
      state = "done"
    } else if (index === currentIdx) {
      state = "current"
    } else {
      state = "pending"
    }

    const rawNote = hit?.note?.trim() || ""
    const lower = rawNote.toLowerCase()
    // Drop desk/manual-dispatch noise — routing is automatic by category unit
    const isDeskNoise =
      lower.includes("manual dispatch") ||
      lower.includes("barangay desk") ||
      lower.includes("emergency desk") ||
      lower.includes("no on-duty")
    const looksLikeStatusOnly =
      !rawNote ||
      isDeskNoise ||
      lower === step.status ||
      lower === step.label.toLowerCase() ||
      lower === statusLabels[step.status].toLowerCase() ||
      lower === "submitted" ||
      lower === "emergency alert submitted." ||
      lower === "emergency alert submitted"
    // Prefer backend auto-route note when present; else category-aware defaults
    const note =
      state === "pending"
        ? step.pendingHint(alert)
        : looksLikeStatusOnly
          ? step.defaultNote(alert)
          : rawNote

    return {
      key: step.status,
      status: step.status,
      label: step.label,
      note,
      time: hit?.time ?? (state !== "pending" && index === 0 ? alert.created_at : null),
      state,
    }
  })

  if (alert.status === "cancelled") {
    const cancelHit = byStatus.get("cancelled")
    rows.push({
      key: "cancelled",
      status: "cancelled",
      label: "Cancelled",
      note: cancelHit?.note || "This alert was closed.",
      time: cancelHit?.time ?? alert.updated_at,
      state: "cancelled",
    })
  }

  return rows
}

function statusText(alert: EmergencyAlert) {
  const unit = unitForEmergencyType(alert.type)
  if (alert.status === "submitted") {
    return `Finding nearest on-duty ${unit} for this ${alert.type} case…`
  }
  if (alert.status === "routed") {
    return `Assigned to on-duty ${unit} for this ${alert.type} case.`
  }
  if (alert.status === "acknowledged") return "Responder routed; location updates will appear when travel begins."
  if (alert.status === "en_route") return "Responder is on the way."
  if (alert.status === "nearby") return "Responder is near your location."
  if (alert.status === "arrived") return "Responder has arrived."
  if (alert.status === "resolved") return "Emergency has been resolved."
  return "Emergency was cancelled."
}

function headline(alert: EmergencyAlert) {
  if (["en_route", "nearby", "arrived"].includes(alert.status)) return "Help is on the way"
  if (alert.status === "resolved") return "Emergency resolved"
  if (alert.status === "cancelled") return "Alert closed"
  return "Emergency active"
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const earth = 6371000
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat)
  const dLng = toRad(to.lng - from.lng)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
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

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  )
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => setDesktop(mq.matches)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return desktop
}

function EmergencyTrackingMap({
  alert,
  expanded,
  className,
}: {
  alert: EmergencyAlert
  expanded: boolean
  className?: string
}) {
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

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map)

      const residentIcon = L.divIcon({
        className: "",
        html: `<div style="width:16px;height:16px;border-radius:999px;background:#2b7fff;border:3px solid white;box-shadow:0 2px 10px rgba(37,99,235,.45),0 0 0 8px rgba(43,127,255,.18)"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
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
    mapRef.current?.invalidateSize()
    window.setTimeout(() => mapRef.current?.invalidateSize(), 200)
  }, [expanded])

  useEffect(() => {
    const map = mapRef.current
    const L = leafletRef.current
    if (!map || !L || !lastLocation) return
    const resident: leaflet.LatLngTuple = [Number(alert.latitude), Number(alert.longitude)]
    const responder: leaflet.LatLngTuple = [
      Number(lastLocation.latitude),
      Number(lastLocation.longitude),
    ]
    const responderIcon = L.divIcon({
      className: "",
      html: `<div style="width:22px;height:22px;border-radius:999px;background:#07145f;border:3px solid white;box-shadow:0 4px 10px rgba(7,20,95,.35)"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    })
    if (responderMarkerRef.current) responderMarkerRef.current.setLatLng(responder)
    else responderMarkerRef.current = L.marker(responder, { icon: responderIcon }).addTo(map)
    if (routeRef.current) routeRef.current.setLatLngs([responder, resident])
    else
      routeRef.current = L.polyline([responder, resident], {
        color: "#ff6a1a",
        opacity: 0.9,
        weight: 4,
      }).addTo(map)
    const accuracy = Math.max(0, lastLocation.accuracy ?? 0)
    if (accuracyRef.current) {
      accuracyRef.current.setLatLng(responder)
      accuracyRef.current.setRadius(accuracy)
    } else if (accuracy > 0) {
      accuracyRef.current = L.circle(responder, {
        radius: accuracy,
        color: "#07145f",
        fillColor: "#07145f",
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(map)
    }
    map.fitBounds(L.latLngBounds([resident, responder]), { padding: [44, 44], maxZoom: 17 })
  }, [
    alert.latitude,
    alert.longitude,
    lastLocation?.latitude,
    lastLocation?.longitude,
    lastLocation?.accuracy,
    mapReady,
  ])

  return <div ref={containerRef} className={cn("h-full w-full bg-[#e8eef5]", className)} />
}

function DetailsColumn({
  alert,
  connectionState,
  distance,
  locationIsStale,
  lastLocation,
  responder,
  canAppeal,
  appealReason,
  setAppealReason,
  appealBusy,
  submitAppeal,
  appealHistory,
  chatOpen,
  chatMessage,
}: {
  alert: EmergencyAlert
  connectionState: "connecting" | "live" | "degraded"
  distance: number | null
  locationIsStale: boolean
  lastLocation: EmergencyAlert["current_assignment"] extends infer A
    ? A extends { last_location: infer L }
      ? L
      : null
    : null
  responder: EmergencyAlert["current_assignment"] extends infer A
    ? A extends { responder: infer R }
      ? R
      : null
    : null
  canAppeal: boolean
  appealReason: string
  setAppealReason: (v: string) => void
  appealBusy: boolean
  submitAppeal: () => void
  appealHistory: EmergencyAlert["appeals"]
  chatOpen: boolean
  chatMessage: EmergencyChatMessage | null
}) {
  return (
    <div className="space-y-3 pb-2">
      <div className="rounded-xl border border-white/10 bg-white/10 p-4 text-white">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-200">
            <NavigationIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">{statusText(alert)}</p>
            <p className="mt-1 text-[12px] text-white/70">
              {distance !== null
                ? `${formatDistance(distance)} · ${formatEta(distance)}`
                : alert.address || alert.barangay}
            </p>
            <p className="mt-1 text-[11px] text-white/50">
              {connectionState === "live"
                ? "Live updates"
                : connectionState === "connecting"
                  ? "Connecting…"
                  : "Polling for updates"}
              {locationIsStale ? " · GPS temporarily stale" : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/10 p-4 text-white">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
            <ShieldCheckIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold">
              {responder && typeof responder === "object" && "full_name" in responder
                ? String((responder as { full_name: string }).full_name)
                : "Responder not assigned yet"}
            </p>
            <p className="mt-1 text-[12px] text-white/70">
              {responder && typeof responder === "object" && "role" in responder
                ? `${String((responder as { role: string }).role).replace(/_/g, " ")}${
                    lastLocation && typeof lastLocation === "object" && lastLocation && "created_at" in lastLocation
                      ? ` · GPS ${formatTime(String((lastLocation as { created_at: string }).created_at))}`
                      : ""
                  }`
                : "Barangay routing is pending."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">Status timeline</p>
          <span className="text-[11px] font-medium text-white/45">
            {statusLabels[alert.status]}
          </span>
        </div>
        <ol className="relative mt-4 space-y-0">
          {buildStatusTimeline(alert).map((row, index, arr) => {
            const isLast = index === arr.length - 1
            return (
              <li key={row.key} className="relative flex gap-3 pb-4 last:pb-0">
                {/* Connector line */}
                {!isLast ? (
                  <span
                    className={cn(
                      "absolute left-[11px] top-7 bottom-0 w-px",
                      row.state === "done" || row.state === "current"
                        ? "bg-[#ff6a1a]/55"
                        : "bg-white/15",
                    )}
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px]",
                    row.state === "done" && "bg-emerald-500 text-white",
                    row.state === "current" &&
                      "bg-[#ff6a1a] text-white shadow-[0_0_0_4px_rgba(255,106,26,0.25)]",
                    row.state === "pending" && "border-2 border-white/25 bg-transparent text-white/40",
                    row.state === "cancelled" && "bg-red-600 text-white",
                  )}
                  aria-hidden
                >
                  {row.state === "done" ? (
                    <CheckIcon className="size-3.5" strokeWidth={3} />
                  ) : row.state === "current" ? (
                    <RadioIcon className="size-3.5" strokeWidth={2.5} />
                  ) : row.state === "cancelled" ? (
                    <XIcon className="size-3.5" strokeWidth={3} />
                  ) : (
                    <CircleDotIcon className="size-3 opacity-50" />
                  )}
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={cn(
                        "text-[13px] font-semibold",
                        row.state === "pending" ? "text-white/45" : "text-white",
                      )}
                    >
                      {row.label}
                      {row.state === "current" ? (
                        <span className="ml-2 text-[10px] font-bold tracking-wide text-[#ffb380] uppercase">
                          Now
                        </span>
                      ) : null}
                    </p>
                    {row.time ? (
                      <time className="shrink-0 text-[11px] tabular-nums text-white/50">
                        {formatTime(row.time)}
                      </time>
                    ) : row.state === "pending" ? (
                      <span className="shrink-0 text-[11px] text-white/30">Pending</span>
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 text-[12px] leading-5",
                      row.state === "pending" ? "text-white/35" : "text-white/70",
                    )}
                  >
                    {row.note}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/10 p-4 text-white">
        <div className="flex items-start gap-3">
          <MapPinIcon className="mt-0.5 size-4 shrink-0 text-white/70" />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-white/60 uppercase">Your location</p>
            <p className="mt-1 text-[14px] font-medium">
              {alert.address?.trim() || alert.barangay || "Pinned location"}
            </p>
          </div>
        </div>
      </div>

      {/* Group chat only after a responder is assigned */}
      {(alert.assignments?.length > 0 || alert.current_assignment) &&
      alert.status !== "submitted" ? (
        <EmergencyChatPanel
          alertId={alert.id}
          open={chatOpen}
          disabled={alert.status === "cancelled" || alert.status === "resolved"}
          incomingMessage={chatMessage}
          realtime={false}
          participantHint={
            alert.assignments?.length
              ? `Group · you + ${alert.assignments.length} responder${alert.assignments.length === 1 ? "" : "s"}`
              : "Group · you + assigned responders"
          }
          className="min-h-[280px]"
        />
      ) : (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-3 text-[12px] leading-5 text-white/55">
          Live chat opens once a responder is assigned to this emergency (auto-routed by case type).
        </div>
      )}

      {alert.media.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/10 p-4">
          <p className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">Evidence</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {alert.media.map((media) => (
              <button
                key={media.id}
                type="button"
                className="overflow-hidden rounded-lg border border-white/15 text-left"
                onClick={() => {
                  void openAuthenticatedMedia(media.raw_url, media.original_filename).catch((error) => {
                    toast.error(error instanceof Error ? error.message : "Could not open evidence.")
                  })
                }}
              >
                <AuthenticatedMediaImage
                  src={media.preview_url}
                  alt={media.original_filename}
                  className="h-24 w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {appealHistory?.length ? (
        <div className="rounded-xl border border-white/10 bg-white/10 p-4 text-white">
          <p className="text-[12px] font-semibold tracking-wide text-white/60 uppercase">Review history</p>
          <div className="mt-3 space-y-2">
            {appealHistory.map((appeal) => (
              <div key={appeal.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">Review {appeal.status}</span>
                  <span className="text-white/50">{formatTime(appeal.decided_at || appeal.created_at)}</span>
                </div>
                <p className="mt-1 text-white/80">{appeal.reason}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {canAppeal ? (
        <div className="rounded-xl border border-white/10 bg-white/10 p-4">
          <p className="text-[14px] font-semibold text-white">Request post-incident review</p>
          <p className="mt-1 text-[12px] text-white/65">
            Use only if this emergency was resolved or recorded incorrectly.
          </p>
          <textarea
            value={appealReason}
            onChange={(e) => setAppealReason(e.target.value)}
            placeholder="Explain what should be reviewed"
            className="mt-3 min-h-20 w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#ff6a1a]"
          />
          <Button
            type="button"
            disabled={appealBusy || !appealReason.trim()}
            onClick={() => void submitAppeal()}
            className="mt-3 h-11 w-full rounded-full bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
          >
            {appealBusy ? "Submitting" : "Submit review request"}
          </Button>
        </div>
      ) : null}
    </div>
  )
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
  const isDesktop = useIsDesktop()
  const [expanded, setExpanded] = useState(false)
  const [alert, setAlert] = useState<EmergencyAlert | null>(initialAlert)
  const [appealReason, setAppealReason] = useState("")
  const [appealBusy, setAppealBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelBusy, setCancelBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<"connecting" | "live" | "degraded">("connecting")
  const [chatMessage, setChatMessage] = useState<EmergencyChatMessage | null>(null)

  useEffect(() => {
    setAlert(initialAlert)
  }, [initialAlert])

  useEffect(() => {
    if (!open) {
      setExpanded(false)
      setChatMessage(null)
      setCancelOpen(false)
      setCancelReason("")
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open || !alert || !activeStatuses.includes(alert.status) || connectionState !== "degraded") return
    const interval = window.setInterval(async () => {
      try {
        const nextAlert = await getEmergency(alert.id)
        setAlert(nextAlert)
        onAlertChange?.(nextAlert)
      } catch {
        /* keep last */
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
        socket = new WebSocket(
          websocketUrl(`/ws/emergencies/${alert.id}/tracking/?ticket=${encodeURIComponent(ticket)}`),
        )
      } catch {
        setConnectionState("degraded")
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(
          () => void connect(),
          Math.min(30_000, 1500 * 2 ** reconnectAttempts),
        )
        return
      }
      socket.onopen = () => {
        reconnectAttempts = 0
        setConnectionState("live")
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string
            payload?: EmergencyAlert | EmergencyChatMessage
          }
          if (message.type === "emergency.chat" && message.payload) {
            setChatMessage(message.payload as EmergencyChatMessage)
            return
          }
          if (message.type !== "emergency.update" || !message.payload) return
          setAlert(message.payload as EmergencyAlert)
          onAlertChange?.(message.payload as EmergencyAlert)
        } catch {
          /* ignore */
        }
      }
      socket.onclose = () => {
        setConnectionState("degraded")
        if (!closedByComponent) {
          reconnectAttempts += 1
          reconnectTimer = window.setTimeout(
            () => void connect(),
            Math.min(30_000, 1500 * 2 ** reconnectAttempts),
          )
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closedByComponent = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [open, alert?.id, alert?.status, onAlertChange])

  if (!open || !alert || typeof document === "undefined") return null

  const responder = alert.current_assignment?.responder ?? null
  const lastLocation = alert.current_assignment?.last_location ?? null
  const distance =
    lastLocation
      ? distanceMeters(
          { lat: Number(lastLocation.latitude), lng: Number(lastLocation.longitude) },
          { lat: Number(alert.latitude), lng: Number(alert.longitude) },
        )
      : null
  const pendingAppeal = alert.appeals?.find((a) => a.status === "submitted")
  const locationIsStale = Boolean(
    lastLocation && Date.now() - new Date(lastLocation.created_at).getTime() > 20_000,
  )
  const canAppeal = Boolean(alert && ["resolved", "cancelled"].includes(alert.status) && !pendingAppeal)
  const appealHistory = alert.appeals ?? []
  const isLive = activeStatuses.includes(alert.status)
  const canCancel = ["submitted", "routed"].includes(alert.status)

  async function submitCancellation() {
    const reason = cancelReason.trim()
    if (!alert || reason.length < 10) return
    setCancelBusy(true)
    try {
      const nextAlert = await cancelEmergency(alert.id, reason)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      setCancelOpen(false)
      setCancelReason("")
      toast.success("Emergency alert cancelled")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not cancel this emergency alert.")
    } finally {
      setCancelBusy(false)
    }
  }

  async function submitAppeal() {
    if (!alert || !appealReason.trim()) return
    setAppealBusy(true)
    try {
      await createEmergencyAppeal(alert.id, appealReason.trim())
      const nextAlert = await getEmergency(alert.id)
      setAlert(nextAlert)
      onAlertChange?.(nextAlert)
      setAppealReason("")
      toast.success("Review request submitted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit review request.")
    } finally {
      setAppealBusy(false)
    }
  }

  const streetLine = alert.address?.trim() || alert.barangay || "Your pin"
  const mapOverlay = (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex max-w-[min(100%,280px)] flex-col gap-1.5">
        {isLive ? (
          <span className="w-fit rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-bold tracking-wide text-white uppercase shadow-md">
            Live · Alert
          </span>
        ) : null}
        <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-md">
          You · {streetLine}
        </span>
        {distance !== null ? (
          <span className="w-fit rounded-full bg-[#07145f] px-2.5 py-1 text-[11px] font-semibold text-white shadow-md">
            {formatDistance(distance)} · {formatEta(distance)}
          </span>
        ) : null}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-[500] flex flex-wrap gap-1.5">
        <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-md">
          {connectionState === "live" ? "Live GPS" : connectionState === "connecting" ? "Connecting" : "Polling"}
        </span>
        {lastLocation ? (
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-md">
            Responder {formatTime(lastLocation.created_at)}
            {locationIsStale ? " · stale" : ""}
          </span>
        ) : (
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 shadow-md">
            Waiting for responder GPS
          </span>
        )}
      </div>
    </>
  )

  const details = (
    <DetailsColumn
      alert={alert}
      connectionState={connectionState}
      distance={distance}
      locationIsStale={locationIsStale}
      lastLocation={lastLocation}
      responder={responder}
      canAppeal={canAppeal}
      appealReason={appealReason}
      setAppealReason={setAppealReason}
      appealBusy={appealBusy}
      submitAppeal={() => void submitAppeal()}
      appealHistory={appealHistory}
      chatOpen={open}
      chatMessage={chatMessage}
    />
  )

  return createPortal(
    <div className="fixed inset-0 z-[260]">
      {/* Plain dark scrim — no blur (laggy) / no blue tint */}
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-black/60",
          isDesktop && !expanded && "bg-black/45",
        )}
        aria-label="Close tracking"
        onClick={() => onOpenChange(false)}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Emergency tracking"
        className={cn(
          "z-10 flex flex-col overflow-hidden bg-[#07145f] text-white",
          // Mobile: full screen
          !isDesktop && "fixed inset-0 h-full w-full",
          // Desktop dock
          isDesktop &&
            !expanded &&
            "fixed bottom-6 right-6 h-[min(680px,calc(100dvh-3rem))] w-[min(400px,calc(100vw-2.5rem))] rounded-2xl border border-white/10 shadow-[0_16px_48px_rgba(0,0,0,0.45)]",
          // Desktop expanded = right sidebar
          isDesktop &&
            expanded &&
            "fixed inset-y-0 right-0 h-full w-[min(520px,100vw)] max-w-[100vw] border-l border-white/10 shadow-[-12px_0_40px_rgba(0,0,0,0.4)]",
        )}
      >
        {/* Red urgency header */}
        <header className="flex shrink-0 items-center gap-2 bg-gradient-to-r from-[#c41212] via-[#e11d2e] to-[#b91c1c] px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {isLive ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                  Live
                </span>
              ) : null}
              <h2 className="truncate text-[15px] font-bold sm:text-base">{headline(alert)}</h2>
            </div>
            <p className="mt-0.5 truncate text-[12px] text-white/85">
              {alert.public_id || `Alert #${alert.id}`} · {statusLabels[alert.status]}
            </p>
          </div>
          {isDesktop ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/15"
            aria-label="Close"
          >
            <XIcon className="size-5" />
          </button>
        </header>

        {/* Body — stacked map + details (sidebar width is enough; split was cramped/broken) */}
        <div className="flex min-h-0 flex-1 flex-col bg-[#07145f]">
          <div
            className={cn(
              "relative shrink-0 border-b border-white/10",
              isDesktop && expanded ? "h-[min(42%,320px)] min-h-[220px]" : isDesktop ? "h-[220px]" : "h-[min(40vh,260px)]",
            )}
          >
            <EmergencyTrackingMap alert={alert} expanded={expanded} />
            {mapOverlay}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            {details}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/10 bg-[#050e45] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {cancelOpen && canCancel ? (
            <div className="mb-3 rounded-xl border border-red-300/25 bg-red-500/10 p-3">
              <label htmlFor="emergency-cancel-reason" className="text-[13px] font-semibold text-white">
                Why are you cancelling?
              </label>
              <p className="mt-1 text-[11px] leading-4 text-white/55">
                Assigned responders will see this reason. Enter at least 10 characters.
              </p>
              <textarea
                id="emergency-cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value.slice(0, 500))}
                placeholder="Example: Sent by accident; everyone here is safe."
                className="mt-2 min-h-20 w-full resize-none rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-[13px] text-white outline-none placeholder:text-white/35 focus:border-red-300"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCancelOpen(false)
                    setCancelReason("")
                  }}
                  className="h-10 flex-1 rounded-lg border border-white/15 text-[13px] font-semibold text-white hover:bg-white/10"
                >
                  Keep alert
                </button>
                <button
                  type="button"
                  disabled={cancelBusy || cancelReason.trim().length < 10}
                  onClick={() => void submitCancellation()}
                  className="h-10 flex-1 rounded-lg bg-red-600 text-[13px] font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {cancelBusy ? "Cancelling…" : "Confirm cancel"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex gap-2">
            {canCancel && !cancelOpen ? (
              <button
                type="button"
                onClick={() => setCancelOpen(true)}
                className="h-11 flex-1 rounded-full border border-red-300/40 text-[14px] font-semibold text-red-100 hover:bg-red-500/15"
              >
                Cancel alert
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-11 flex-1 rounded-full bg-[#ff6a1a] text-[14px] font-semibold text-white hover:bg-[#e85f17]"
            >
              Close tracking
            </button>
          </div>
          {isLive && !canCancel ? (
            <p className="mt-2 text-center text-[11px] text-white/50">
              A responder is already handling this alert. Contact them in chat if circumstances change.
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
