import { Link } from "react-router-dom"
import { ArrowUpRightIcon, InboxIcon } from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { ShareBar } from "@/features/dashboard/components/charts"
import type { OfficialAnalytics } from "@/features/dashboard/api"

/**
 * The one filled surface on the page.
 *
 * Exactly one card is allowed to be filled, and it is the queue, because that
 * is the figure that decides whether an official has anything to do this
 * morning. The rule is inherited from the KPI strip this replaces: when three
 * cards are emphasised, none is.
 *
 * The share bar underneath is monochrome by construction — the caller passes a
 * white opacity ramp, so the card gains a second dimension without gaining a
 * second colour. The corner glow and watermark are built from the same two
 * brand tokens (navy, orange) rather than a new hue, so the card reads richer
 * without breaking the palette.
 */
export function AwaitingActionCard({
  analytics,
  loading,
}: {
  analytics: OfficialAnalytics | null
  loading: boolean
}) {
  const awaiting = (analytics?.totals.open ?? 0) + (analytics?.totals.working ?? 0)
  const share = analytics?.share

  return (
    <Link
      to="/dashboard/reports"
      className="group relative flex min-w-0 flex-col justify-between gap-10 overflow-hidden rounded-bento bg-[linear-gradient(160deg,var(--color-brand-navy),var(--color-ink-raised))] p-8 text-white transition-colors hover:bg-[linear-gradient(160deg,var(--color-ink-raised),var(--color-ink-raised))] md:p-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-brand-orange opacity-[0.16] blur-3xl"
      />
      <InboxIcon
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-6 size-40 shrink-0 text-white/[0.06]"
        strokeWidth={1.2}
      />

      <div className="relative flex items-start justify-between gap-4">
        <span className="text-label text-white/70">Awaiting action</span>
        <ArrowUpRightIcon
          className="size-5 shrink-0 text-white/50 transition-transform group-hover:translate-x-px group-hover:-translate-y-px"
          aria-hidden
        />
      </div>

      <div className="relative min-w-0">
        {loading ? (
          <Skeleton className="h-24 w-40 rounded-control bg-white/15" />
        ) : (
          <p className="text-[clamp(56px,7vw,96px)] font-semibold leading-[0.9] tracking-[-0.03em] tabular-nums">
            {awaiting}
          </p>
        )}
        <p className="mt-4 text-meta text-white/60">
          {analytics
            ? `${analytics.totals.filed_window} filed in the last ${analytics.window_days} days`
            : " "}
        </p>
      </div>

      {share ? (
        <ShareBar
          segments={[
            { key: "open", label: "Needs attention", value: share.open },
            { key: "working", label: "Working", value: share.working },
            { key: "closed", label: "Closed", value: share.closed },
          ]}
          fills={["bg-white", "bg-white/45", "bg-white/15"]}
          captionClassName="text-meta font-medium text-white"
          legendClassName="text-micro text-white/55"
          title="Share of every concern this barangay has taken, by where it sits"
        />
      ) : null}
    </Link>
  )
}
