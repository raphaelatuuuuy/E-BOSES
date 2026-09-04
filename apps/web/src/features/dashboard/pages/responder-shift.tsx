import { useCallback, useEffect, useState } from "react"
import { ChartLineIcon, ClipboardListIcon, LoaderCircleIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  listAssignedEmergencies,
  type EmergencyAlert,
  listResponderShifts,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"
import { useResponderDuty } from "@/features/dashboard/hooks/use-responder-duty"
import {
  ShiftControls,
} from "@/features/dashboard/components/responder/shift-controls"
import { ShiftHistoryList } from "@/features/dashboard/components/responder/shift-history"
import { DutyRhythm, ResponseTrend } from "@/features/dashboard/components/responder/shift-insights"
import { Pane, State } from "@/features/dashboard/components/responder/dispatch-surface"
import { dispatchState, formatAgo } from "@/features/dashboard/lib/responder-format"
import { cn } from "@workspace/ui/lib/utils"

export default function ResponderShiftPage() {
  usePageTitle("Responder Shift")
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const viewerId = user?.id ?? null
  const { unit, isOnDuty, busy, activeShift, startDuty, endDuty } = useResponderDuty()
  const [shiftHistory, setShiftHistory] = useState<ResponderShift[]>([])
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async () => {
    setError("")
    const [nextAlerts, nextShiftHistory] = await Promise.all([
      listAssignedEmergencies(),
      listResponderShifts(),
    ])
    setAlerts(nextAlerts)
    setShiftHistory(nextShiftHistory)
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

  const hasDutyMismatch = !loading && !activeShift && Boolean(summary?.is_on_duty)

  async function toggleDuty(nextDuty: boolean) {
    if (nextDuty) {
      await startDuty().catch(() => undefined)
    } else {
      await endDuty().catch(() => undefined)
    }
    await load()
  }

  return (
    <div
      className="min-h-full flex-1 bg-canvas p-4 pb-6 md:p-6 md:pb-8 lg:p-8"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3">
        <ShiftControls
          unit={unit}
          isOnDuty={isOnDuty}
          busy={busy}
          activeShift={activeShift}
          now={now}
          onStart={() => void toggleDuty(true)}
          onEnd={() => void toggleDuty(false)}
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

        <Pane title="Shift insights" icon={ChartLineIcon} padded={false} className="min-h-0">
          <div className="grid divide-y divide-card-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="p-5">
              <DutyRhythm shifts={shiftHistory} />
            </div>
            <div className="p-5">
              <ResponseTrend shifts={shiftHistory} />
            </div>
          </div>
        </Pane>

        <Pane title="Shift log" icon={ClipboardListIcon} padded={false} className="min-h-0">
          <div className="flex items-baseline gap-2 border-b border-card-line px-5 py-4">
            <h3 className="text-micror text-subtle-foreground">
              Today's dispatch log
            </h3>
            {alerts.length > 0 ? (
              <span className="text-body tabular-nums text-subtle-foreground">
                {alerts.length}
              </span>
            ) : null}
          </div>
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

          <div className="flex items-baseline gap-2 border-b border-card-line px-5 py-4">
            <h3 className="text-micror text-subtle-foreground">
              Shift history
            </h3>
            {shiftHistory.length > 0 ? (
              <span className="text-body tabular-nums text-subtle-foreground">
                {shiftHistory.length}
              </span>
            ) : null}
          </div>
          <ShiftHistoryList shifts={shiftHistory} />
        </Pane>
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
