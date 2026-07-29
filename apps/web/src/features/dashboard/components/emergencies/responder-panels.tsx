import { useEffect, useState } from "react"
import { LocateFixedIcon, NavigationIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import { markEmergencyArrived, resolveEmergency, sendEmergencyLocationPing, updateEmergencyDuty, type EmergencyAlert } from "@/features/dashboard/emergency-api"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"

export function DutyPanel({
  user,
}: {
  user: ReturnType<typeof useAuthSession>["user"]
}) {
  const unit = useResponderUnit()
  const [isOnDuty, setIsOnDuty] = useState(Boolean(user?.is_on_duty))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsOnDuty(Boolean(user?.is_on_duty))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [user?.is_on_duty])

  async function updateDuty(nextDuty = isOnDuty, requireGps = nextDuty) {
    if (requireGps && !navigator.geolocation) {
      toast.error("GPS is required before going on duty.")
      return
    }
    setBusy(true)
    // No unit is sent: the server takes it from the membership officials
    // assigned, and a responder cannot re-badge themselves.
    const send = async (latitude?: number, longitude?: number) => {
      const next = await updateEmergencyDuty({ is_on_duty: nextDuty, latitude, longitude })
      setIsOnDuty(next.is_on_duty)
      toast.success(next.is_on_duty ? "Duty status live" : "You are off duty")
    }
    try {
      if (!requireGps) {
        await send()
        return
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords
          void send(latitude, longitude).catch((error) => toast.error(error instanceof Error ? error.message : "Duty update failed.")).finally(() => setBusy(false))
        },
        () => {
          setBusy(false)
          toast.error("Allow location access so dispatch can route nearest responders.")
        },
        { enableHighAccuracy: true, timeout: 10000 },
      )
      return
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duty update failed.")
    } finally {
      if (!requireGps) setBusy(false)
    }
  }

  return (
    <section className="rounded-panel border border-card-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-brand-navy">Responder duty</p>
          <p className="mt-1 text-xs font-semibold text-subtle-foreground">Go on duty with GPS so auto-routing can find you.</p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold", isOnDuty ? "bg-status-closed-surface text-status-closed-ink" : "bg-card-raised text-muted-foreground")}>
          {isOnDuty ? "On duty" : "Off duty"}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0 rounded-panel border border-card-line bg-card-raised px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
            Response unit
          </p>
          <p className="mt-0.5 truncate text-sm font-bold text-brand-navy">
            {unit.loading ? "Loading" : unit.name}
          </p>
        </div>
        <Button
          type="button"
          disabled={busy || (!unit.loading && !unit.assigned)}
          onClick={() => void updateDuty(!isOnDuty, !isOnDuty)}
          className={cn(isOnDuty ? "bg-card-raised hover:bg-card-raised" : "bg-brand-orange hover:bg-brand-orange-strong", "text-brand-orange-ink")}
        >
          <LocateFixedIcon className="size-4" />
          {busy ? "Updating" : isOnDuty ? "Go off duty" : "Go on duty"}
        </Button>
      </div>
    </section>
  )
}

export function ResponderActions({ alert, onChanged }: { alert: EmergencyAlert; onChanged: (alert: EmergencyAlert) => void }) {
  const [busy, setBusy] = useState("")

  async function run(label: string, fn: () => Promise<EmergencyAlert>) {
    setBusy(label)
    try {
      const next = await fn()
      onChanged(next)
      toast.success("Emergency updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Emergency update failed.")
    } finally {
      setBusy("")
    }
  }

  function ping() {
    if (!navigator.geolocation) {
      toast.error("GPS is not available on this device.")
      return
    }
    setBusy("ping")
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords
        void run("ping", () => sendEmergencyLocationPing(alert.id, { latitude, longitude, accuracy }))
      },
      () => {
        setBusy("")
        toast.error("Allow location access to send responder GPS.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="rounded-panel border border-card-line bg-card p-4">
      <p className="text-sm font-semibold text-brand-navy">Responder actions</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Button
          type="button"
          disabled={Boolean(busy) || !["routed", "acknowledged", "en_route", "nearby"].includes(alert.status)}
          onClick={ping}
          className="bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
        >
          <LocateFixedIcon className="size-4" />
          {busy === "ping" ? "Sending GPS" : "Mark en route"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(busy) || !["en_route", "nearby", "acknowledged"].includes(alert.status)}
          onClick={() => run("arrived", () => markEmergencyArrived(alert.id))}
          variant="outline"
        >
          <NavigationIcon className="size-4" />
          {busy === "arrived" ? "Updating" : "I have arrived on scene"}
        </Button>
        <Button
          type="button"
          disabled={Boolean(busy) || !["arrived", "en_route", "nearby"].includes(alert.status)}
          onClick={() => run("resolve", () => resolveEmergency(alert.id, "Incident resolved by responder."))}
          variant="outline"
        >
          <ShieldCheckIcon className="size-4" />
          {busy === "resolve" ? "Resolving" : "Resolve incident"}
        </Button>
      </div>
    </div>
  )
}
