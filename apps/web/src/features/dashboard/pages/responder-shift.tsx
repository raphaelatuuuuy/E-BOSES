import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  LocateFixedIcon,
  LoaderCircleIcon,
  RadioIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { getResponderDashboardSummary, type PublicUser } from "@/features/dashboard/api"
import {
  listAssignedEmergencies,
  type EmergencyAlert,
  type ResponderShift,
  endResponderShift,
  getActiveResponderShift,
  listResponderShifts,
  startResponderShift,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"

type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

const unitLabels: Record<ResponderUnit, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  other: "Other responder",
  "": "Responder",
}

function formatDuration(startedAt: string | null, now: number) {
  if (!startedAt) return "00:00"
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function formatSeconds(seconds: number | null | undefined) {
  if (seconds == null) return "—"
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

function ShiftStat({
  label,
  value,
  tone = "blue",
}: {
  label: string
  value: string | number
  tone?: "blue" | "orange" | "green" | "red"
}) {
  const toneClass = {
    blue: "bg-[#eef3ff] text-[#07145f]",
    orange: "bg-[#fff4ed] text-[#b9470b]",
    green: "bg-emerald-50 text-emerald-700",
    red: "bg-red-50 text-red-700",
  }[tone]
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className={cn("mt-2 w-fit rounded-xl px-2.5 py-1 text-xl font-black", toneClass)}>
        {value}
      </p>
    </div>
  )
}

export default function ResponderShiftPage() {
  usePageTitle("Responder Shift")
  const { user, refreshUser } = useAuthSession()
  const [unit, setUnit] = useState<ResponderUnit>((user?.responder_unit as ResponderUnit) || "tanod")
  const [isOnDuty, setIsOnDuty] = useState(Boolean(user?.is_on_duty))
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [shiftHistory, setShiftHistory] = useState<ResponderShift[]>([])
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getResponderDashboardSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async () => {
    setError("")
    const [nextSummary, nextAlerts, nextActiveShift, nextShiftHistory] = await Promise.all([
      getResponderDashboardSummary(),
      listAssignedEmergencies(),
      getActiveResponderShift(),
      listResponderShifts(),
    ])
    setSummary(nextSummary)
    setAlerts(nextAlerts)
    setActiveShift(nextActiveShift)
    setShiftHistory(nextShiftHistory)
    // A persisted shift session is authoritative for this screen. Older duty-only
    // records may have is_on_duty=true without a shift, which previously disabled
    // Start while leaving End with no session to close.
    setIsOnDuty(Boolean(nextActiveShift))
    setUnit((nextActiveShift?.responder_unit as ResponderUnit) || (nextSummary.responder_unit as ResponderUnit) || "tanod")
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => void load()
      .catch(() => {
        if (!cancelled) setError("Could not load shift data.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      }), 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [load])

  const stats = useMemo(() => {
    const active = summary?.assigned_active_emergencies ?? alerts.length
    const resolved = summary?.assigned_resolved_emergencies ?? alerts.filter((alert) => alert.status === "resolved").length
    const routed = alerts.filter(
      (alert) => ["routed", "acknowledged"].includes(alert.status) || alert.current_assignment?.status === "assigned",
    ).length
    const enRoute = alerts.filter((alert) => ["en_route", "nearby"].includes(alert.status)).length
    return { active, resolved, routed, enRoute }
  }, [alerts, summary])

  const hasDutyMismatch = !loading && !activeShift && Boolean(summary?.is_on_duty)

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

  async function updateDuty(nextDuty: boolean, nextUnit = unit) {
    setBusy(nextDuty ? "start" : "end")
    try {
      let latitude: number | undefined
      let longitude: number | undefined
      if (nextDuty) {
        const pos = await requestPosition()
        latitude = pos.coords.latitude
        longitude = pos.coords.longitude
        const shift = await startResponderShift({
          responder_unit: nextUnit,
          latitude,
          longitude,
        })
        setActiveShift(shift)
        toast.success("Shift started")
      } else {
        try {
          const pos = await requestPosition()
          latitude = pos.coords.latitude
          longitude = pos.coords.longitude
        } catch {
          // Ending a shift is allowed even if GPS is unavailable; the backend keeps
          // the last known duty location.
        }
        const shift = await endResponderShift({ latitude, longitude })
        setActiveShift(null)
        setShiftHistory((current) => [shift, ...current.filter((item) => item.id !== shift.id)])
        toast.success("Shift ended")
      }
      setIsOnDuty(nextDuty)
      setUnit(nextUnit)
      await refreshUser()
      await load()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not update shift. Check GPS permission and try again.",
      )
    } finally {
      setBusy("")
    }
  }

  function changeUnit(nextUnit: ResponderUnit) {
    if (isOnDuty) {
      toast.info("End the current shift before changing responder unit.")
      return
    }
    setUnit(nextUnit)
  }

  return (
    <div className="min-h-full bg-white p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-[#f23b35] to-[#ff8133] p-5 text-white">
            <p className="text-[12px] font-black uppercase tracking-wide text-white/80">
              Responder shift
            </p>
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-tight">
                  {user?.full_name || user?.firstName || "Responder"}
                </h1>
                <p className="mt-1 text-sm font-semibold text-white/85">
                  {unitLabels[unit]} · {isOnDuty ? "On duty" : hasDutyMismatch ? "Availability on · shift not started" : "Off duty"}
                </p>
              </div>
              <div className="rounded-2xl bg-white/15 px-4 py-3 text-right backdrop-blur">
                <p className="text-[11px] font-black uppercase tracking-wide text-white/75">
                  Shift time
                </p>
                <p className="mt-1 text-3xl font-black tabular-nums">
                  {formatDuration(activeShift?.started_at ?? null, now)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="text-xs font-black uppercase tracking-wide text-neutral-500">
                Response unit
              </label>
              <select
                value={unit}
                disabled={Boolean(busy) || isOnDuty}
                onChange={(event) => changeUnit(event.target.value as ResponderUnit)}
                className="mt-2 h-12 w-full rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-bold text-[#07145f] outline-none focus:border-[#ff6a1a]"
              >
                <option value="tanod">Barangay Tanod — crime/security</option>
                <option value="bhw">BHW — medical</option>
                <option value="bdrrmo">BDRRMO — fire/disaster</option>
                <option value="other">Other responder</option>
              </select>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                disabled={Boolean(busy) || isOnDuty}
                onClick={() => void updateDuty(true)}
                className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
              >
                {busy === "start" ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <LocateFixedIcon className="size-4" />
                )}
                Start shift
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busy) || !isOnDuty}
                onClick={() => void updateDuty(false)}
              >
                {busy === "end" ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <ClockIcon className="size-4" />
                )}
                End shift
              </Button>
            </div>
          </div>
        </section>

        {hasDutyMismatch ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-black">Start a shift to confirm dispatch availability</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-amber-800">
              Your older availability flag is on, but no active shift session exists. Start shift now to create the required GPS-stamped session; you are not locked out of the control.
            </p>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ShiftStat label="Active dispatches" value={loading ? "—" : stats.active} tone="red" />
          <ShiftStat label="Automatically routed" value={loading ? "—" : stats.routed} tone="orange" />
          <ShiftStat label="En route" value={loading ? "—" : stats.enRoute} tone="blue" />
          <ShiftStat label="Resolved" value={loading ? "—" : stats.resolved} tone="green" />
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-[#07145f]">Today’s dispatch log</p>
              <p className="mt-1 text-xs font-semibold text-neutral-500">
                Active assignments from dispatch plus persisted shift history.
              </p>
            </div>
            <RadioIcon className="size-5 text-[#ff6a1a]" />
          </div>

          {loading ? (
            <div className="mt-5 flex items-center justify-center py-10">
              <LoaderCircleIcon className="size-8 animate-spin text-neutral-400" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-neutral-200 p-8 text-center">
              <ShieldCheckIcon className="mx-auto size-9 text-emerald-600" />
              <p className="mt-2 text-sm font-black text-neutral-900">No dispatches yet</p>
              <p className="mt-1 text-xs text-neutral-500">
                Assigned incidents will appear here during your shift.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {alerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-2xl border border-neutral-200 bg-white p-4"
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
                    <span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-[11px] font-black text-[#07145f]">
                      {alert.status === "acknowledged"
                        ? "responder routed"
                        : alert.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-600">
                    {alert.note || "No note provided."}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-[#f8fafc] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-3">
              <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-black text-[#07145f]">Shift history</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-neutral-600">
                  Shift sessions are stored in the backend with automatically routed,
                  resolved, false alarm, and average response metrics.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {shiftHistory.length === 0 ? (
              <p className="rounded-2xl bg-white p-3 text-xs font-semibold text-neutral-500">
                No shift history yet.
              </p>
            ) : (
              shiftHistory.slice(0, 5).map((shift) => (
                <div
                  key={shift.id}
                  className="grid gap-2 rounded-2xl border border-neutral-200 bg-white p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div>
                    <p className="font-black text-[#07145f]">
                      {shift.status === "active" ? "Active shift" : "Completed shift"} · {unitLabels[(shift.responder_unit as ResponderUnit) || ""]}
                    </p>
                    <p className="mt-1 font-semibold text-neutral-500">
                      {new Intl.DateTimeFormat("en", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(new Date(shift.started_at))}
                      {shift.ended_at
                        ? ` – ${new Intl.DateTimeFormat("en", {
                            hour: "numeric",
                            minute: "2-digit",
                          }).format(new Date(shift.ended_at))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 font-black text-neutral-600 sm:justify-end">
                    <span className="rounded-lg bg-[#fff4ed] px-2 py-1">
                      {shift.incidents_assigned} assigned
                    </span>
                    <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">
                      {shift.incidents_resolved} resolved
                    </span>
                    <span className="rounded-lg bg-[#eef3ff] px-2 py-1 text-[#07145f]">
                      avg {formatSeconds(shift.average_response_seconds)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
