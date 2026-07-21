import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangleIcon,
  ClockIcon,
  LocateFixedIcon,
  LoaderCircleIcon,
  MapPinIcon,
  NavigationIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { getResponderDashboardSummary } from "@/features/dashboard/api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"
import {
  getActiveResponderShift,
  listAssignedEmergencies,
  markEmergencyArrived,
  resolveEmergency,
  sendEmergencyLocationPing,
  type EmergencyAlert,
  type EmergencyStatus,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"

const statusLabel: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Routed",
  acknowledged: "Automatically routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

function statusClass(status: EmergencyStatus) {
  if (status === "arrived" || status === "resolved") return "bg-emerald-50 text-emerald-700"
  if (status === "en_route" || status === "nearby") return "bg-blue-50 text-blue-700"
  if (status === "acknowledged" || status === "routed") return "bg-amber-50 text-amber-700"
  return "bg-red-50 text-red-700"
}

function formatTime(value?: string | null) {
  if (!value) return "No time"
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatShiftDuration(shift: ResponderShift | null) {
  if (!shift) return "Off shift"
  const seconds = shift.duration_seconds
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`
}

function DispatchStat({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: "orange" | "green" | "blue" | "red"
}) {
  const toneClass = {
    orange: "text-[#ff6a1a]",
    green: "text-emerald-600",
    blue: "text-[#145be7]",
    red: "text-red-600",
  }[tone]
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={cn("mt-2 text-2xl font-black", toneClass)}>{value}</p>
    </div>
  )
}

function IncidentCard({
  alert,
  active,
  onClick,
}: {
  alert: EmergencyAlert
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors",
        active ? "border-[#ff6a1a] ring-2 ring-[#ff6a1a]/10" : "border-neutral-200 hover:border-neutral-300",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
            <AlertTriangleIcon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-black capitalize text-[#07145f]">
              {alert.type} emergency
            </p>
            <p className="mt-1 truncate text-xs font-semibold text-neutral-500">
              {alert.address || alert.barangay}
            </p>
          </div>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black", statusClass(alert.status))}>
          {statusLabel[alert.status]}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-600">
        {alert.note || "No note provided."}
      </p>
      <p className="mt-3 text-[11px] font-bold text-neutral-400">
        Assigned {formatTime(alert.current_assignment?.assigned_at || alert.created_at)}
      </p>
    </button>
  )
}

export default function ResponderDispatchPage() {
  usePageTitle("Responder Dispatch")
  const { user } = useAuthSession()
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getResponderDashboardSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const selected = useMemo(
    () => alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null,
    [alerts, selectedId],
  )

  const load = useCallback(async () => {
    setError("")
    const [nextAlerts, nextSummary, nextShift] = await Promise.all([
      listAssignedEmergencies(),
      getResponderDashboardSummary(),
      getActiveResponderShift(),
    ])
    setAlerts(nextAlerts)
    setSummary(nextSummary)
    setActiveShift(nextShift)
    setSelectedId((current) => current ?? nextAlerts[0]?.id ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    const initial = window.setTimeout(() => {
      setLoading(true)
      void load()
        .catch(() => {
          if (!cancelled) setError("Could not load responder dispatch.")
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(initial)
    }
  }, [load])

  const stats = useMemo(() => {
    const active = summary?.assigned_active_emergencies ?? alerts.length
    const resolved = summary?.assigned_resolved_emergencies ?? 0
    const routed = summary?.newly_routed ?? summary?.awaiting_acknowledgement ?? alerts.filter(
      (alert) => ["routed", "acknowledged"].includes(alert.status) || alert.current_assignment?.status === "assigned",
    ).length
    const enRoute = alerts.filter((alert) => ["en_route", "nearby"].includes(alert.status)).length
    return { active, resolved, routed, enRoute }
  }, [alerts, summary])

  const requestPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      })
    })
  }, [])

  function updateAlert(next: EmergencyAlert) {
    setAlerts((current) => current.map((alert) => (alert.id === next.id ? next : alert)))
    setSelectedId(next.id)
  }

  async function runAction(label: string, action: () => Promise<EmergencyAlert>) {
    setBusy(label)
    try {
      const next = await action()
      updateAlert(next)
      toast.success("Dispatch updated")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update dispatch.")
    } finally {
      setBusy("")
    }
  }

  async function pingSelected() {
    if (!selected) return
    setBusy("ping")
    try {
      const pos = await requestPosition()
      const next = await sendEmergencyLocationPing(selected.id, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      })
      updateAlert(next)
      toast.success("GPS sent and status updated")
      await load()
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : typeof error === "object" && error && "code" in error && error.code === 1
          ? "Location permission was denied. Allow browser location access and try again."
          : typeof error === "object" && error && "code" in error && error.code === 2
            ? "Your location could not be determined. Move to an area with a GPS signal and try again."
            : typeof error === "object" && error && "code" in error && error.code === 3
              ? "Location request timed out. Try Send GPS again."
              : "Could not send GPS. Check location access and try again."
      toast.error(message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="min-h-full bg-white p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-[#f23b35] to-[#ff8133] p-5 text-white">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[12px] font-black uppercase tracking-wide text-white/75">
                  Responder dispatch
                </p>
                <h1 className="mt-1 text-2xl font-black tracking-tight">
                  {user?.full_name || user?.firstName || "Responder"}
                </h1>
                <p className="mt-1 text-sm font-semibold text-white/85">
                  {summary?.responder_unit || user?.responder_unit || "responder"} · {formatShiftDuration(activeShift)}
                </p>
              </div>
              <Link
                to="/dashboard/responders/shift"
                className="inline-flex h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-black text-[#f23b35] shadow-sm"
              >
                Manage shift
              </Link>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DispatchStat label="Assigned" value={loading ? "—" : stats.active} tone="orange" />
          <DispatchStat label="Automatically routed" value={loading ? "—" : stats.routed} tone="red" />
          <DispatchStat label="En route" value={loading ? "—" : stats.enRoute} tone="blue" />
          <DispatchStat label="Resolved" value={loading ? "—" : stats.resolved} tone="green" />
        </section>

        {loading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-3xl border border-neutral-200 bg-white">
            <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
            <ShieldCheckIcon className="mx-auto size-10 text-emerald-600" />
            <h2 className="mt-3 text-lg font-black text-neutral-900">No assigned dispatches</h2>
            <p className="mt-2 text-sm text-neutral-500">
              New SOS assignments will appear here while you are on duty.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-black text-[#07145f]">Today’s calls</p>
                <span className="rounded-full bg-red-50 px-3 py-1 text-[11px] font-black text-red-700">
                  {alerts.length} live
                </span>
              </div>
              {alerts.map((alert) => (
                <IncidentCard
                  key={alert.id}
                  alert={alert}
                  active={selected?.id === alert.id}
                  onClick={() => setSelectedId(alert.id)}
                />
              ))}
            </aside>

            <section className="space-y-4">
              {selected ? (
                <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-[12px] font-black uppercase text-red-600">
                        On scene task
                      </p>
                      <h2 className="mt-1 text-2xl font-black capitalize text-[#07145f]">
                        {selected.type} emergency
                      </h2>
                      <p className="mt-2 flex items-center gap-1.5 text-sm font-bold text-neutral-500">
                        <MapPinIcon className="size-4" />
                        {selected.address || selected.barangay}
                      </p>
                    </div>
                    <span className={cn("w-fit rounded-full px-3 py-1.5 text-xs font-black", statusClass(selected.status))}>
                      {statusLabel[selected.status]}
                    </span>
                  </div>

                  <p className="mt-4 rounded-2xl bg-[#f8fafc] p-4 text-sm leading-6 text-neutral-600">
                    {selected.note || "No resident note provided."}
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void pingSelected()}
                      className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
                    >
                      {busy === "ping" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <LocateFixedIcon className="size-4" />}
                      Send GPS / En route
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(busy) || !["routed", "acknowledged", "en_route", "nearby"].includes(selected.status)}
                      onClick={() => void runAction("arrived", () => markEmergencyArrived(selected.id))}
                    >
                      {busy === "arrived" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <NavigationIcon className="size-4" />}
                      I have arrived on scene
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={Boolean(busy) || selected.status !== "arrived"}
                      onClick={() => void runAction("resolve", () => resolveEmergency(selected.id, "Incident resolved by responder."))}
                    >
                      {busy === "resolve" ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ShieldCheckIcon className="size-4" />}
                      Resolve incident
                    </Button>
                  </div>
                </div>
              ) : null}

              {selected ? (
                <EmergencyChatPanel
                  alertId={selected.id}
                  open
                  theme="light"
                  disabled={selected.status === "cancelled" || selected.status === "resolved"}
                  participantHint="Group · resident + assigned responders"
                  className="min-h-[360px]"
                />
              ) : null}

              <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex gap-3">
                  <ClockIcon className="mt-0.5 size-5 shrink-0 text-[#ff6a1a]" />
                  <p className="text-sm font-semibold leading-6 text-neutral-600">
                    Keep this page open during response. Use the Map tab for location-first
                    navigation and Shift tab for duty status/history.
                  </p>
                </div>
              </section>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
