import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"

import { useAuthSession } from "@/features/auth/auth-session"
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
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import { ShiftStats } from "@/features/dashboard/components/responder/shift-stats"
import { ShiftControls } from "@/features/dashboard/components/responder/shift-controls"
import { ShiftHistory } from "@/features/dashboard/components/responder/shift-history"
import { DutyRhythm, ResponseTrend } from "@/features/dashboard/components/responder/shift-insights"
import {
  dispatchState,
  dotClass,
  formatAgo,
  toneClass,
} from "@/features/dashboard/lib/responder-format"
import { cn } from "@workspace/ui/lib/utils"

export default function ResponderShiftPage() {
  usePageTitle("Responder Shift")
  const navigate = useNavigate()
  const { user, refreshUser } = useAuthSession()
  const viewerId = user?.id ?? null
  const unit = useResponderUnit()
  const [isOnDuty, setIsOnDuty] = useState(Boolean(user?.is_on_duty))
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [shiftHistory, setShiftHistory] = useState<ResponderShift[]>([])
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
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
    const [nextAlerts, nextActiveShift, nextShiftHistory] = await Promise.all([
      listAssignedEmergencies(),
      getActiveResponderShift(),
      listResponderShifts(),
    ])
    setAlerts(nextAlerts)
    setActiveShift(nextActiveShift)
    setShiftHistory(nextShiftHistory)
    setIsOnDuty(Boolean(nextActiveShift))
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

  const summary = unit.summary
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

  async function updateDuty(nextDuty: boolean) {
    setBusy(nextDuty ? "start" : "end")
    try {
      if (nextDuty) {
        const pos = await requestPosition()
        // The unit is deliberately not sent: the server reads it from the
        // membership officials assigned, and ignores anything a responder
        // client supplies.
        const shift = await startResponderShift({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        })
        setActiveShift(shift)
        toast.success("Shift started")
      } else {
        let latitude: number | undefined
        let longitude: number | undefined
        try {
          const pos = await requestPosition()
          latitude = pos.coords.latitude
          longitude = pos.coords.longitude
        } catch {
          // Ending a shift is allowed even if GPS is unavailable; the backend
          // keeps the last known duty location.
        }
        const shift = await endResponderShift({ latitude, longitude })
        setActiveShift(null)
        setShiftHistory((current) => [shift, ...current.filter((item) => item.id !== shift.id)])
        toast.success("Shift ended")
      }
      setIsOnDuty(nextDuty)
      await refreshUser()
      await Promise.all([load(), unit.reload()])
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

  return (
    <div className="min-h-full bg-canvas p-4 pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-6 md:pb-8 lg:p-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <ShiftControls
          unit={unit}
          isOnDuty={isOnDuty}
          busy={busy}
          activeShift={activeShift}
          now={now}
          onStart={() => void updateDuty(true)}
          onEnd={() => void updateDuty(false)}
        />

        {!unit.loading && !unit.assigned ? (
          <div className="rounded-2xl border border-severity-moderate/40 bg-severity-moderate-surface px-4 py-3">
            <p className="text-sm font-bold text-severity-moderate-ink">
              You are not in a unit yet
            </p>
            <p className="mt-1 text-xs leading-5 text-severity-moderate-ink/80">
              Emergencies are routed by unit, so nothing can reach you until a barangay
              official adds you to one in Configuration, Units.
            </p>
          </div>
        ) : null}

        {hasDutyMismatch ? (
          <div className="rounded-2xl border border-severity-moderate/40 bg-severity-moderate-surface px-4 py-3">
            <p className="text-sm font-bold text-severity-moderate-ink">
              Start a shift to confirm you are available
            </p>
            <p className="mt-1 text-xs leading-5 text-severity-moderate-ink/80">
              Your account is flagged available, but no shift session is open. Starting one
              creates the GPS-stamped session dispatch relies on.
            </p>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-2xl border border-severity-critical/40 bg-status-open-surface px-4 py-3 text-sm font-semibold text-status-open-ink">
            {error}
          </div>
        ) : null}

        <ShiftStats loading={loading} stats={stats} />

        <div className="grid gap-4 lg:grid-cols-2">
          <DutyRhythm shifts={shiftHistory} />
          <ResponseTrend shifts={shiftHistory} />
        </div>

        <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
          <div className="flex items-baseline justify-between gap-3 px-4 pb-2 pt-4">
            <div>
              <h2 className="text-micro uppercase tracking-wide text-nav-muted">
                Today&apos;s dispatch log
              </h2>
              <p className="mt-1 text-xs leading-5 text-subtle-foreground">
                Incidents currently attached to you.
              </p>
            </div>
            {alerts.length > 0 ? (
              <span className="shrink-0 text-sm font-bold tabular-nums text-nav-text-active">
                {alerts.length}
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircleIcon className="size-6 animate-spin text-nav-muted" />
            </div>
          ) : alerts.length === 0 ? (
            <p className="px-4 pb-4 text-xs leading-5 text-subtle-foreground">
              No dispatches yet. Assigned incidents appear here during your shift.
            </p>
          ) : (
            <div className="divide-y divide-card-line border-t border-card-line">
              {alerts.map((alert) => {
                const state = dispatchState(alert, viewerId)
                return (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => navigate(`/dashboard/responders/map?alert=${alert.id}`)}
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-card-raised"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm font-bold capitalize text-foreground">
                        {alert.type}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                        {formatAgo(alert.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {alert.address || alert.barangay}
                    </p>
                    <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className={cn("size-1.5 shrink-0 rounded-full", dotClass(state.tone))}
                        aria-hidden
                      />
                      <span className={cn("uppercase tracking-wide", toneClass(state.tone))}>
                        {state.label}
                      </span>
                    </p>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <ShiftHistory shifts={shiftHistory} />
      </div>
    </div>
  )
}
