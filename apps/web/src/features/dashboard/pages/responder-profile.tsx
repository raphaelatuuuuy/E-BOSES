import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import {
  Activity,
  BadgeCheck,
  Clock3,
  LogOut,
  Mail,
  MapPinned,
  Phone,
  Radio,
  Shield,
  Siren,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { getResponderDashboardSummary, type PublicUser, type ResponderRoleSummary } from "@/features/dashboard/api"
import {
  getActiveResponderShift,
  listAssignedEmergencies,
  listResponderShifts,
  type EmergencyAlert,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { usePageTitle } from "@/hooks/use-page-title"

type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

const unitLabels: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  other: "Other responder",
  "": "Responder",
}

function formatDate(value?: string | null) {
  if (!value) return "—"
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatDuration(seconds?: number | null) {
  if (!seconds) return "—"
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function formatIncidentType(alert: EmergencyAlert) {
  return alert.type.replace(/_/g, " ")
}

function statusClass(status: string) {
  if (status === "resolved" || status === "cancelled") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "arrived" || status === "nearby") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "submitted" || status === "routed") return "border-red-200 bg-red-50 text-red-700"
  return "border-orange-200 bg-orange-50 text-orange-700"
}

function StatTile({
  label,
  value,
  tone = "white",
}: {
  label: string
  value: string | number
  tone?: "white" | "orange" | "blue" | "green"
}) {
  const toneClass = {
    white: "border-[#dfe7f5] bg-white text-[#07145f]",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  }[tone]
  return (
    <div className={cn("rounded-xl border p-4", toneClass)}>
      <p className="text-2xl font-black tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-bold text-[#68739c]">{label}</p>
    </div>
  )
}

export default function ResponderProfilePage() {
  usePageTitle("Responder Profile")
  const navigate = useNavigate()
  const { user, loading, signOut } = useAuthSession()
  const [summary, setSummary] = useState<ResponderRoleSummary | null>(null)
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [shifts, setShifts] = useState<ResponderShift[]>([])
  const [assigned, setAssigned] = useState<EmergencyAlert[]>([])
  const [loaded, setLoaded] = useState(false)

  async function loadProfile() {
    setLoaded(false)
    try {
      const [nextSummary, nextShift, nextShifts, nextAssigned] = await Promise.all([
        getResponderDashboardSummary(),
        getActiveResponderShift(),
        listResponderShifts(),
        listAssignedEmergencies(),
      ])
      setSummary(nextSummary)
      setActiveShift(nextShift)
      setShifts(nextShifts)
      setAssigned(nextAssigned)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Responder profile could not be loaded.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (loading) return
    const timer = window.setTimeout(() => void loadProfile(), 0)
    return () => window.clearTimeout(timer)
  }, [loading])

  const fullName =
    user?.full_name ||
    `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() ||
    "Responder"
  const letter = (fullName[0] || "R").toUpperCase()
  const unit = (summary?.responder_unit || user?.responder_unit || "") as ResponderUnit
  const onDuty = Boolean(activeShift || summary?.is_on_duty || user?.is_on_duty)
  const activeAssigned = assigned.filter((alert) => !["resolved", "cancelled"].includes(alert.status))
  const lastShift = shifts.find((shift) => shift.status === "ended")

  if (!loaded) {
    return (
      <main className="min-h-screen bg-[#f6f8ff] p-4 md:p-6">
        <Skeleton className="h-40 rounded-3xl" />
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f6f8ff] p-4 pb-[calc(7rem+env(safe-area-inset-bottom))] md:p-6 md:pb-8">
      <section className="overflow-hidden rounded-[28px] border border-orange-200 bg-white shadow-[0_20px_60px_rgba(255,106,26,0.12)]">
        <div className="bg-gradient-to-br from-[#ff6a1a] via-[#ff7f32] to-[#ffb35c] p-5 text-white md:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="flex size-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black ring-1 ring-white/30">
                {letter}
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-white/80">First Responder</p>
                <h1 className="mt-1 text-2xl font-black tracking-tight">{fullName}</h1>
                <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white/85">
                  <Radio className="size-4" />
                  {unitLabels[unit || ""] ?? unitLabels.other}
                </p>
              </div>
            </div>
            <span className={cn(
              "inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-black",
              onDuty ? "border-white/40 bg-white text-orange-700" : "border-white/30 bg-white/15 text-white",
            )}>
              <Activity className="size-4" />
              {onDuty ? "On duty" : "Off duty"}
            </span>
          </div>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active assignments" value={summary?.assigned_active_emergencies ?? activeAssigned.length} tone="orange" />
          <StatTile label="Newly routed" value={summary?.newly_routed ?? summary?.awaiting_acknowledgement ?? 0} tone="blue" />
          <StatTile label="Resolved" value={summary?.assigned_resolved_emergencies ?? 0} tone="green" />
          <StatTile label="Shift status" value={activeShift ? formatDuration(activeShift.duration_seconds) : "Off"} />
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="space-y-5">
          <div className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-black text-[#07145f]">Shift controls</h2>
                <p className="mt-1 text-sm font-semibold text-[#68739c]">
                  Use the Shift tab for full start/end logging with GPS and history.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => navigate("/dashboard/responders/shift")}>
                Manage Shift
              </Button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fbff] p-4">
                <p className="flex items-center gap-2 text-sm font-black text-[#07145f]">
                  <Clock3 className="size-4 text-[#ff6a1a]" />
                  Current shift
                </p>
                <p className="mt-2 text-sm font-semibold text-[#43507f]">
                  {activeShift ? `Started ${formatDate(activeShift.started_at)}` : "No active shift session."}
                </p>
              </div>
              <div className="rounded-xl border border-[#dfe7f5] bg-[#f8fbff] p-4">
                <p className="flex items-center gap-2 text-sm font-black text-[#07145f]">
                  <BadgeCheck className="size-4 text-emerald-600" />
                  Last completed shift
                </p>
                <p className="mt-2 text-sm font-semibold text-[#43507f]">
                  {lastShift ? `${formatDuration(lastShift.duration_seconds)} · ${lastShift.incidents_resolved} resolved` : "No completed shift yet."}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-[#07145f]">Active assignments</h2>
                <p className="mt-1 text-sm font-semibold text-[#68739c]">Incidents currently attached to your responder account.</p>
              </div>
              <Button type="button" variant="outline" onClick={() => navigate("/dashboard/responders/map")}>
                Dispatch
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {activeAssigned.map((alert) => (
                <button
                  key={alert.id}
                  type="button"
                  onClick={() => navigate("/dashboard/responders/map")}
                  className="w-full rounded-xl border border-[#dfe7f5] bg-[#fbfcff] p-4 text-left transition hover:border-[#ffb35c] hover:bg-orange-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black capitalize text-[#07145f]">{formatIncidentType(alert)}</p>
                      <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#68739c]">{alert.address || alert.note || alert.barangay}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-black capitalize", statusClass(alert.status))}>
                      {alert.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </button>
              ))}
              {activeAssigned.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#dfe7f5] bg-[#f8fafc] p-8 text-center text-sm font-semibold text-[#68739c]">
                  No active incident assigned.
                </p>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
            <h2 className="text-lg font-black text-[#07145f]">Responder details</h2>
            <div className="mt-4 space-y-3 text-sm font-semibold text-[#43507f]">
              <p className="flex items-center gap-2"><Mail className="size-4 text-[#68739c]" /> {user?.email || "No email"}</p>
              <p className="flex items-center gap-2"><Phone className="size-4 text-[#68739c]" /> {user?.phone_number || "No phone"}</p>
              <p className="flex items-center gap-2"><MapPinned className="size-4 text-[#68739c]" /> {user?.barangay || "Barangay"}</p>
              <p className="flex items-center gap-2"><Shield className="size-4 text-[#68739c]" /> {user?.status || "verified"}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
            <h2 className="text-lg font-black text-[#07145f]">Quick actions</h2>
            <div className="mt-4 grid gap-2">
              <Button type="button" className="justify-start bg-[#ff6a1a] text-white hover:bg-[#e85f17]" onClick={() => navigate("/dashboard/responders/map")}>
                <MapPinned className="size-4" />
                Open live map
              </Button>
              <Button type="button" variant="outline" className="justify-start" onClick={() => navigate("/dashboard/responders/map")}>
                <Siren className="size-4" />
                View dispatch calls
              </Button>
              <Button
                type="button"
                variant="outline"
                className="justify-start text-red-700 hover:text-red-700"
                onClick={() => void signOut().finally(() => navigate("/sign-in"))}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}
