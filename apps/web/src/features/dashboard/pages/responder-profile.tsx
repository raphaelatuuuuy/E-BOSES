import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  CalendarCheckIcon,
  IdCardIcon,
  LogOut,
  Mail,
  MapPinned,
  Phone,
  ShieldCheck,
  TimerIcon,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"
import {
  getActiveResponderShift,
  listResponderShifts,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import {
  MetricTile,
  Pane,
  State,
} from "@/features/dashboard/components/responder/dispatch-surface"
import { MOBILE_BAR_CLEARANCE } from "@/features/dashboard/lib/shell"
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
    <li className="flex items-start gap-3 px-5 py-4">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle-foreground" />
      <div className="min-w-0">
        <p className="text-micro uppercase tracking-wide text-subtle-foreground">{label}</p>
        <p className="mt-0.5 break-words text-heading text-foreground">{value}</p>
      </div>
    </li>
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
        <div className="mx-auto max-w-3xl space-y-3">
          <Skeleton className="h-48 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-56 rounded-3xl" />
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-full bg-canvas p-4 md:p-6"
      style={{ paddingBottom: `calc(${MOBILE_BAR_CLEARANCE} + 1.5rem)` }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <section className="rounded-3xl border border-card-line bg-card p-5 md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span
              aria-hidden
              className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-nav-raised text-xl font-bold text-brand-orange ring-1 ring-brand-orange/25"
            >
              {initials(fullName, "R")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-micro uppercase tracking-wide text-subtle-foreground">
                First responder
              </p>
              <h1 className="mt-1 truncate text-[22px] font-bold leading-tight tracking-tight text-foreground">
                {fullName}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <State
                  label={onDuty ? "On duty" : "Off duty"}
                  tone={onDuty ? "settled" : "idle"}
                />
                <span className="text-body text-subtle-foreground">{unit.name}</span>
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-card-line bg-card-raised px-4 py-3.5">
            <p className="text-micro uppercase tracking-wide text-subtle-foreground">
              Response unit
            </p>
            <p className="mt-1 text-heading text-foreground">{unit.name}</p>
            <p className="mt-1 text-body leading-6 text-subtle-foreground">
              {unit.assigned
                ? "Set by your barangay. Contact an official if this is wrong."
                : "No unit yet. A barangay official assigns this before you can be dispatched."}
            </p>
          </div>
        </section>

        <section aria-label="Career totals" className="grid grid-cols-3 gap-3">
          <MetricTile
            icon={CalendarCheckIcon}
            value={String(completed.length)}
            label="Shifts served"
            tone="ice"
          />
          <MetricTile
            icon={TimerIcon}
            value={formatDuration(totalSeconds)}
            label="Time on duty"
            tone="warm"
          />
          <MetricTile
            icon={ShieldCheck}
            value={String(totalResolved)}
            label="Resolved"
            tone="settled"
          />
        </section>

        <Pane title="Account details" icon={IdCardIcon} padded={false} className="min-h-0">
          <ul className="divide-y divide-card-line">
            <Detail icon={Mail} label="Email" value={user?.email || "Not recorded"} />
            <Detail icon={Phone} label="Phone" value={user?.phone_number || "Not recorded"} />
            <Detail icon={MapPinned} label="Barangay" value={user?.barangay || "Not recorded"} />
            <Detail
              icon={ShieldCheck}
              label="Account status"
              value={user?.status === "verified" ? "Verified" : user?.status || "Not recorded"}
            />
          </ul>
        </Pane>

        {/* Not `variant="outline"`: on this palette that resolves to
            `bg-background`, which is darker than the card, and hovers to solid
            orange — the same two problems the End shift button had. */}
        <button
          type="button"
          onClick={() => void signOut().finally(() => navigate("/sign-in"))}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-card-line-strong bg-card-raised px-5 text-sm font-bold text-foreground transition-colors hover:border-sos/60 hover:bg-sos/15 hover:text-sos"
        >
          <LogOut className="size-4" />
          Sign out
        </button>
      </div>
    </main>
  )
}
