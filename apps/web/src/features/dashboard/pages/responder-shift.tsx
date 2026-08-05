import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardListIcon, LoaderCircleIcon } from "lucide-react"
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
import { Pane, State } from "@/features/dashboard/components/responder/dispatch-surface"
import { MOBILE_BAR_CLEARANCE } from "@/features/dashboard/lib/shell"
import { dispatchState, formatAgo } from "@/features/dashboard/lib/responder-format"
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
    <div
      className="min-h-full bg-canvas p-4 md:p-6 lg:p-8"
      style={{ paddingBottom: `calc(${MOBILE_BAR_CLEARANCE} + 1.5rem)` }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
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
          <Notice title="You are not in a unit yet">
            Emergencies are routed by unit, so nothing can reach you until a barangay official
            adds you to one in Configuration, Units.
          </Notice>
        ) : null}

        {hasDutyMismatch ? (
          <Notice title="Start a shift to confirm you are available">
            Your account is flagged available, but no shift session is open. Starting one
            creates the GPS-stamped session dispatch relies on.
          </Notice>
        ) : null}

        {error ? (
          <Notice title="Shift data could not load" tone="critical">
            {error}
          </Notice>
        ) : null}

        <ShiftStats loading={loading} stats={stats} />

        <div className="grid gap-3 lg:grid-cols-2">
          <DutyRhythm shifts={shiftHistory} />
          <ResponseTrend shifts={shiftHistory} />
        </div>

        <Pane
          title="Today's dispatch log"
          icon={ClipboardListIcon}
          subtitle={alerts.length > 0 ? `${alerts.length}` : undefined}
          padded={false}
          className="min-h-0"
        >
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircleIcon className="size-6 animate-spin text-subtle-foreground" />
            </div>
          ) : alerts.length === 0 ? (
            <p className="px-5 py-5 text-body leading-6 text-subtle-foreground">
              No dispatches yet. Assigned incidents appear here during your shift.
            </p>
          ) : (
            <ul className="divide-y divide-card-line">
              {alerts.map((alert) => {
                const state = dispatchState(alert, viewerId)
                return (
                  <li key={alert.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/dashboard/responders/dispatch?alert=${alert.id}`)}
                      className="w-full px-5 py-4 text-left transition-colors hover:bg-card-raised"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-heading capitalize text-foreground">
                          {alert.type}
                        </span>
                        <span className="shrink-0 text-body tabular-nums text-subtle-foreground">
                          {formatAgo(alert.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-body text-muted-foreground">
                        {alert.address || alert.barangay}
                      </p>
                      <State label={state.label} tone={state.tone} className="mt-1.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Pane>

        <ShiftHistory shifts={shiftHistory} />
      </div>
    </div>
  )
}

/**
 * A standing message on the Shift screen — missing unit, duty mismatch, load
 * failure. One shape for all three; they previously each hand-rolled their own
 * border, padding and type sizes.
 */
function Notice({
  title,
  tone = "moderate",
  children,
}: {
  title: string
  tone?: "moderate" | "critical"
  children: React.ReactNode
}) {
  const critical = tone === "critical"
  return (
    <div
      role={critical ? "alert" : undefined}
      className={cn(
        "rounded-2xl border px-4 py-3.5",
        critical
          ? "border-severity-critical/40 bg-severity-critical-surface"
          : "border-severity-moderate/40 bg-severity-moderate-surface",
      )}
    >
      <p
        className={cn(
          "text-heading",
          critical ? "text-severity-critical-ink" : "text-severity-moderate-ink",
        )}
      >
        {title}
      </p>
      <p
        className={cn(
          "mt-1 text-body leading-6",
          critical ? "text-severity-critical-ink/80" : "text-severity-moderate-ink/80",
        )}
      >
        {children}
      </p>
    </div>
  )
}
