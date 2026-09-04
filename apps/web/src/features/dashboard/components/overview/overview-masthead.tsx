import { Link } from "react-router-dom"
import { AlertTriangleIcon, ArrowUpRightIcon } from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import type { OfficialAnalytics } from "@/features/dashboard/api"

/**
 * The header, and the only place on the page that says what is happening now.
 *
 * The version this replaces put a pulsing red dot and a `text-severity-critical`
 * label above the title. Both are the coloured-status affordance the design
 * system removed everywhere else — a `StateMarker` carries the same sentence
 * with a monochrome glyph, and reads the same for the ~8% of men who cannot
 * separate the red from the grey.
 */

function Figure({ value, label, loading }: { value: number; label: string; loading: boolean }) {
  return (
    <div className="min-w-0 px-6 first:pl-0 last:pr-0">
      {loading ? (
        <Skeleton className="h-10 w-16 rounded-control bg-card-raised" />
      ) : (
        <p className="text-[44px] font-semibold leading-none tracking-tight text-brand-navy tabular-nums">
          {value}
        </p>
      )}
      <p className="mt-2 truncate text-label text-subtle-foreground">{label}</p>
    </div>
  )
}

export function OverviewMasthead({
  analytics,
  loading,
}: {
  analytics: OfficialAnalytics | null
  loading: boolean
}) {
  const { user } = useAuthSession()
  const community = (user?.barangay || "Community").replace(/^Barangay\s+/i, "")

  const responders = analytics?.emergencies.responders_on_duty ?? 0

  return (
    <header
      className="rounded-bento border border-card-line bg-card p-6 md:p-8"
      style={{
        backgroundImage:
          "radial-gradient(140% 160% at 100% 0%, var(--color-brand-orange-soft), var(--color-card) 55%)",
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
        <div className="min-w-0">
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.025em] text-brand-navy">
            Operations Overview
          </h1>
          <p className="mt-2 text-meta text-subtle-foreground">
            {community}
            <span className="text-faint-foreground"> · </span>
            {responders} {responders === 1 ? "responder" : "responders"} on duty
          </p>

        </div>

        <div className="flex min-w-0 divide-x divide-card-line">
          <Figure value={analytics?.totals.open ?? 0} label="Open" loading={loading} />
          <Figure value={analytics?.totals.working ?? 0} label="Working" loading={loading} />
          <Figure value={analytics?.totals.new_today ?? 0} label="New today" loading={loading} />
        </div>
      </div>
    </header>
  )
}

/**
 * Exists only while an emergency does. An always-present slot that reads "all
 * clear" trains people to skip the row, which is the one row that must never be
 * skipped.
 *
 * Rendered above the masthead card, not inside it — this is the one thing on
 * the page an official must see before anything else, including the title.
 */
export function EmergencyAlertBanner({ count }: { count: number }) {
  return (
    <Link
      to="/dashboard/emergencies"
      className={cn(
        "mb-4 flex items-center gap-3 rounded-bento bg-sos px-6 py-5 text-white transition-colors",
        "hover:bg-sos-bright",
      )}
    >
      <AlertTriangleIcon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-row font-medium">
        {count} {count === 1 ? "emergency needs" : "emergencies need"} a responder
      </span>
      <span className="shrink-0 text-meta text-white/75">Open the board</span>
      <ArrowUpRightIcon className="size-5 shrink-0" aria-hidden />
    </Link>
  )
}
