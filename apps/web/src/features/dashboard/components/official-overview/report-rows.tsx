import { useNavigate } from "react-router-dom"
import {
  Check,
  ChevronRightIcon,
  FileTextIcon,
  InboxIcon,
  MapPinIcon,
  TagsIcon,
  TriangleAlert,
} from "lucide-react"

import type { OfficialOverviewReport } from "@/features/dashboard/api"
import { cn } from "@workspace/ui/lib/utils"
import {
  formatDate,
  formatTime,
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { streetSegment } from "@/features/dashboard/lib/location-text"

export function OfficialOverviewReports({
  items,
  onViewAll,
  onOpenReport,
}: {
  items: OfficialOverviewReport[]
  onViewAll: () => void
  onOpenReport?: (report: OfficialOverviewReport) => void
}) {
  const navigate = useNavigate()

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
          onClick={onViewAll}
          className="text-[14px] font-bold text-brand-orange"
        >
          View all
        </button>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <InboxIcon
            className="size-8 text-neutral-300"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <p className="mt-3 text-[14px] text-neutral-500">
            No reports in this unit yet.
          </p>
        </div>
      ) : (
        items.map((report) => {
          const resolved = report.status === "resolved"
          const critical = !resolved && report.severity === "critical"
          const CategoryIcon = resolved
            ? Check
            : critical
              ? TriangleAlert
              : (resolveIconByKey(report.category_ref?.icon_key) ?? TagsIcon)
          const street =
            streetSegment(report.address) || report.barangay || "Community"
          const displayTitle = report.official_title?.trim() || report.title

          return (
            <button
              key={`${report.record_type ?? "concern"}-${report.id}`}
              type="button"
              onClick={() =>
                onOpenReport
                  ? onOpenReport(report)
                  : navigate(`/dashboard/reports/${report.id}`)
              }
              className="flex w-full items-center gap-3 border-b border-neutral-100 py-3 text-left last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] leading-snug font-bold break-words text-neutral-900">
                  <CategoryIcon
                    className={cn(
                      "mr-1.5 inline size-[18px] align-[-3px]",
                      resolved
                        ? "text-emerald-600"
                        : critical
                          ? "text-sos"
                          : "text-brand-orange"
                    )}
                    strokeWidth={resolved ? 2.75 : 2}
                    aria-hidden="true"
                  />
                  {displayTitle}
                </span>
                {report.record_type === "emergency" && report.summary ? (
                  <span className="mt-1 block text-[13px] leading-snug text-neutral-600">
                    {report.summary}
                  </span>
                ) : null}
                <span className="mt-1 flex items-center gap-1 text-[13px] text-neutral-500">
                  <MapPinIcon
                    className="size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="truncate">{street}</span>
                </span>
                <span className="mt-0.5 block text-[13px] text-neutral-500 tabular-nums">
                  {formatDate(report.created_at)} at{" "}
                  {formatTime(report.created_at)}
                </span>
              </span>
              <ChevronRightIcon
                className="size-6 shrink-0 text-neutral-400"
                aria-hidden="true"
              />
            </button>
          )
        })
      )}
    </section>
  )
}
