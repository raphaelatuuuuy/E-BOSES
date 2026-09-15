import { useNavigate } from "react-router-dom"
import {
  Check,
  CircleX,
  ChevronRightIcon,
  FileTextIcon,
  InboxIcon,
  MapPinIcon,
  TagsIcon,
  TriangleAlert,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"
import type { Concern } from "@/features/dashboard/api"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { concernTitleText } from "@/features/dashboard/components/feed-post-text"
import {
  formatDate,
  formatTime,
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { isCriticalConcern } from "@/features/dashboard/lib/critical-concern"
import { emergencyTitleText } from "@/features/dashboard/lib/emergency-description"

export function OverviewReportRow({
  post,
  onOpen,
  showDivider = true,
}: {
  post: Concern
  onOpen?: (post: Concern) => void
  showDivider?: boolean
}) {
  const navigate = useNavigate()
  const resolved = isResolvedRecord(post)
  const rejected = post.status === "rejected"
  const critical = !resolved && !rejected && isCriticalConcern(post)
  const CategoryIcon = rejected
    ? CircleX
    : resolved
      ? Check
      : critical
        ? TriangleAlert
        : (resolveIconByKey(post.category_ref?.icon_key) ?? TagsIcon)
  const street = streetSegment(post.address) || post.barangay || "Community"
  return (
    <button
      type="button"
      onClick={() =>
        onOpen
          ? onOpen(post)
          : navigate(`/dashboard/reports/${post.public_id ?? post.id}`)
      }
      className={cn(
        "flex w-full items-center gap-3 border-b border-neutral-100 py-3 text-left last:border-b-0",
        !showDivider && "border-b-0"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-bold break-words text-neutral-900">
          <CategoryIcon
            className={cn(
              "mr-1.5 inline size-[18px] align-[-3px]",
              rejected
                ? "text-red-600"
                : resolved
                  ? "text-emerald-600"
                  : critical
                    ? "text-sos"
                    : "text-brand-orange"
            )}
            strokeWidth={rejected ? 2.4 : resolved ? 2.75 : 2}
            aria-hidden="true"
          />
          {concernTitleText(post)}
        </span>
        <span className="mt-1 flex items-center gap-1 text-[13px] text-neutral-500">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{street}</span>
        </span>
        <span className="mt-0.5 block text-[13px] text-neutral-500 tabular-nums">
          {formatDate(post.created_at)} at {formatTime(post.created_at)}
        </span>
      </span>
      <ChevronRightIcon
        className="size-6 shrink-0 text-neutral-400"
        aria-hidden="true"
      />
    </button>
  )
}

export function OverviewReports({
  items,
  emergencies = [],
  onViewAll,
  onOpenReport,
  onOpenEmergency,
}: {
  items: Concern[]
  emergencies?: EmergencyAlert[]
  onViewAll?: () => void
  onOpenReport?: (post: Concern) => void
  onOpenEmergency?: (alert: EmergencyAlert) => void
}) {
  const navigate = useNavigate()
  const latestItems = [
    ...items.map((post) => ({ kind: "concern" as const, post })),
    ...emergencies.map((alert) => ({ kind: "emergency" as const, alert })),
  ]
    .sort((left, right) => {
      const leftDate =
        left.kind === "concern" ? left.post.created_at : left.alert.created_at
      const rightDate =
        right.kind === "concern"
          ? right.post.created_at
          : right.alert.created_at
      return rightDate.localeCompare(leftDate)
    })
    .slice(0, 3)
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[19px] font-bold tracking-tight text-neutral-900">
          <FileTextIcon
            className="size-5 shrink-0 text-brand-orange"
            strokeWidth={2.2}
            aria-hidden="true"
          />
          Latest Reports
        </h2>
        <button
          type="button"
          onClick={() =>
            onViewAll
              ? onViewAll()
              : navigate("/dashboard/reports", {
                  state: { fromOverview: true },
                })
          }
          className="text-[14px] font-bold text-brand-orange"
        >
          View all
        </button>
      </div>
      {latestItems.length > 0 ? (
        latestItems.map((item) =>
          item.kind === "emergency" ? (
            <EmergencyOverviewRow
              key={`emergency-${item.alert.id}`}
              alert={item.alert}
              onOpen={onOpenEmergency}
            />
          ) : (
            <OverviewReportRow
              key={`concern-${item.post.id}`}
              post={item.post}
              onOpen={onOpenReport}
            />
          )
        )
      ) : (
        <div className="flex flex-col items-center py-8 text-center">
          <InboxIcon
            className="size-8 text-neutral-300"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <p className="mt-3 text-[14px] text-neutral-500">No reports yet.</p>
        </div>
      )}
    </section>
  )
}

function EmergencyOverviewRow({
  alert,
  onOpen,
}: {
  alert: EmergencyAlert
  onOpen?: (alert: EmergencyAlert) => void
}) {
  const navigate = useNavigate()
  const resolved = ["resolved", "closed"].includes(alert.status)
  const title = emergencyTitleText(alert)
  const street =
    streetSegment(
      alert.display_location ||
        alert.resolved_location ||
        alert.address ||
        alert.reported_area
    ) ||
    alert.barangay ||
    "Community"

  return (
    <button
      type="button"
      onClick={() =>
        onOpen
          ? onOpen(alert)
          : navigate(`/dashboard/reports?alert=${alert.id}`)
      }
      className="flex w-full items-center gap-3 border-b border-neutral-100 py-3 text-left last:border-b-0"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug font-bold break-words text-neutral-900">
          {resolved ? (
            <Check
              className="mr-1.5 inline size-[18px] align-[-3px] text-emerald-600"
              strokeWidth={2.75}
              aria-hidden="true"
            />
          ) : (
            <TriangleAlert
              className="mr-1.5 inline size-[18px] align-[-3px] text-sos"
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          {title}
        </span>
        <span className="mt-1 flex items-center gap-1 text-[13px] text-neutral-500">
          <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{street}</span>
        </span>
        <span className="mt-0.5 block text-[13px] text-neutral-500 tabular-nums">
          {formatDate(alert.created_at)} at {formatTime(alert.created_at)}
        </span>
      </span>
      <ChevronRightIcon
        className="size-6 shrink-0 text-neutral-400"
        aria-hidden="true"
      />
    </button>
  )
}
