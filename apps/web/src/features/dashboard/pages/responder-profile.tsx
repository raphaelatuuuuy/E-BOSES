import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { LogOut, Mail, MapPinned, Phone, ShieldCheck } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import {
  getActiveResponderShift,
  listResponderShifts,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { formatDuration } from "@/features/dashboard/lib/responder-format"
import { usePageTitle } from "@/hooks/use-page-title"

/**
 * Who the responder is, and nothing else.
 *
 * This page used to restate the Shift screen — the same stat tiles, the same
 * shift summary, the same assignment list — which meant two screens to keep in
 * step and two places to look for one number. Operational content now lives on
 * Map and Shift; what is left here is identity, the details an official may ask
 * a responder to confirm, and the way out.
 */

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Mail
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-nav-muted" />
      <div className="min-w-0">
        <p className="text-micro uppercase tracking-wide text-nav-muted">{label}</p>
        <p className="mt-0.5 break-words text-sm font-semibold text-foreground">{value}</p>
      </div>
    </div>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-4">
      <p className="text-micro uppercase tracking-wide text-nav-muted">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-bold leading-none tabular-nums text-foreground">
        {value}
      </p>
    </div>
  )
}

export default function ResponderProfilePage() {
  usePageTitle("Responder Profile")
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuthSession()
  const unit = useResponderUnit()
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [shifts, setShifts] = useState<ResponderShift[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loading) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.all([getActiveResponderShift(), listResponderShifts()])
        .then(([nextShift, nextShifts]) => {
          if (cancelled) return
          setActiveShift(nextShift)
          setShifts(nextShifts)
        })
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : "Responder profile could not be loaded.",
          )
        })
        .finally(() => {
          if (!cancelled) setLoaded(true)
        })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [loading])

  const fullName =
    user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || "Responder"
  const onDuty = Boolean(activeShift || unit.summary?.is_on_duty || user?.is_on_duty)
  const completed = shifts.filter((shift) => shift.status === "ended")
  const totalSeconds = completed.reduce((sum, shift) => sum + (shift.duration_seconds ?? 0), 0)
  const totalResolved = completed.reduce((sum, shift) => sum + shift.incidents_resolved, 0)

  if (!loaded) {
    return (
      <main className="min-h-full bg-canvas p-4 md:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-full bg-canvas p-4 pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-6 md:pb-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-2xl border border-card-line bg-card p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span
              aria-hidden
              className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-nav-raised text-xl font-bold text-brand-orange ring-1 ring-brand-orange/25"
            >
              {initials(fullName, "R")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-micro uppercase tracking-wide text-nav-muted">First responder</p>
              <h1 className="mt-1 truncate text-2xl font-bold leading-tight text-foreground">
                {fullName}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={cn(
                      "relative flex size-1.5 shrink-0 rounded-full",
                      onDuty ? "bg-status-closed text-status-closed" : "bg-subtle-foreground",
                    )}
                    aria-hidden
                  >
                    {onDuty ? <span className="ops-pulse absolute inset-0 rounded-full" /> : null}
                  </span>
                  <span
                    className={cn(
                      "uppercase tracking-wide",
                      onDuty ? "text-status-closed" : "text-subtle-foreground",
                    )}
                  >
                    {onDuty ? "On duty" : "Off duty"}
                  </span>
                </span>
                <span className="text-subtle-foreground">{unit.name}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-card-raised px-4 py-3">
            <p className="text-micro uppercase tracking-wide text-nav-muted">Response unit</p>
            <p className="mt-1 text-sm font-bold text-foreground">{unit.name}</p>
            <p className="mt-1 text-xs leading-5 text-subtle-foreground">
              {unit.assigned
                ? "Set by your barangay. Contact an official if this is wrong."
                : "No unit yet. A barangay official assigns this before you can be dispatched."}
            </p>
          </div>
        </section>

        <section className="grid grid-cols-3 divide-x divide-card-line overflow-hidden rounded-2xl border border-card-line bg-card">
          <Total label="Shifts served" value={String(completed.length)} />
          <Total label="Time on duty" value={formatDuration(totalSeconds)} />
          <Total label="Resolved" value={String(totalResolved)} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
          <h2 className="px-4 pb-1 pt-4 text-micro uppercase tracking-wide text-nav-muted">
            Account details
          </h2>
          <div className="divide-y divide-card-line border-t border-card-line">
            <Detail icon={Mail} label="Email" value={user?.email || "Not recorded"} />
            <Detail icon={Phone} label="Phone" value={user?.phone_number || "Not recorded"} />
            <Detail icon={MapPinned} label="Barangay" value={user?.barangay || "Not recorded"} />
            <Detail
              icon={ShieldCheck}
              label="Account status"
              value={user?.status === "verified" ? "Verified" : user?.status || "Not recorded"}
            />
          </div>
        </section>

        <Button
          type="button"
          variant="outline"
          className="h-11 justify-center border-severity-critical/40 text-sos hover:bg-status-open-surface"
          onClick={() => void signOut().finally(() => navigate("/sign-in"))}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </main>
  )
}
