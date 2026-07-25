import { CaretLeft, CaretRight } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"
import { concernBodyText } from "@/features/dashboard/utils/feed-post-card-utils"
import type { Concern, ConcernCategory } from "@/features/dashboard/api"

const categoryLabels: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

const activeStatuses: Concern["status"][] = ["submitted", "under_review", "assigned", "in_progress"]

function statusGroup(status: Concern["status"]): string {
  if (activeStatuses.includes(status)) return "Active"
  if (status === "resolved") return "Resolved"
  if (status === "rejected") return "Rejected"
  if (status === "appealed") return "Appealed"
  return "Active"
}

const statusColors: Record<string, string> = {
  Active: "border-neutral-200 bg-neutral-100 text-neutral-700",
  Resolved: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Rejected: "border-neutral-200 bg-neutral-50 text-neutral-600",
  Appealed: "border-neutral-200 bg-neutral-50 text-neutral-600",
}

const reportDateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })

function formatDate(value: string) {
  return reportDateFormatter.format(new Date(value))
}

function truncateDescription(text: string, max = 72): string {
  const cleaned = (text || "").replace(/\s+/g, " ").trim()
  if (!cleaned) return "No description"
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const atWord = slice.replace(/\s+\S*$/, "").trim()
  const base = atWord.length >= 28 ? atWord : slice.trim()
  return `${base}...`
}

export function ResidentReportList({
  reports,
  activeFilter,
  selectedReport,
  onSelect,
  reportPage,
  onPageChange,
}: {
  reports: Concern[]
  activeFilter: string
  selectedReport: string | null
  onSelect: (report: Concern) => void
  reportPage: number
  onPageChange: (page: number) => void
}) {
  const residentReportsPageSize = 5
  const filtered = filterReports(reports, activeFilter)
  const totalPages = Math.max(1, Math.ceil(filtered.length / residentReportsPageSize))
  const currentPage = Math.min(reportPage, totalPages)
  const pagedReports = filtered.slice((currentPage - 1) * residentReportsPageSize, currentPage * residentReportsPageSize)
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * residentReportsPageSize + 1
  const lastShown = Math.min(filtered.length, currentPage * residentReportsPageSize)

  return (
    <div className="w-full overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-col divide-y divide-neutral-100">
        {pagedReports.map((report) => {
          const group = statusGroup(report.status)
          const isSelected = selectedReport === report.public_id
          return (
            <button
              key={report.id}
              type="button"
              onClick={() => onSelect(report)}
              className={cn(
                "flex min-h-[68px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
                isSelected ? "bg-neutral-50" : "bg-white hover:bg-neutral-50/80",
              )}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                <span className="text-[10px] font-bold">{categoryLabels[report.category].slice(0, 2)}</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] font-medium leading-snug text-neutral-900">
                  {truncateDescription(concernBodyText(report))}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-neutral-500">
                  {categoryLabels[report.category]}
                  <span className="mx-1 text-neutral-300">·</span>
                  {formatDate(report.created_at)}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium", statusColors[group])}>
                {group}
              </span>
              <CaretRight className="size-4 shrink-0 text-neutral-300" />
            </button>
          )
        })}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center text-sm text-neutral-500">
            {activeFilter === "All" ? "No reports yet." : `No ${activeFilter.toLowerCase()} reports.`}
          </div>
        ) : null}
      </div>

      {filtered.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 px-4 py-3">
          <p className="text-[12px] font-medium text-neutral-500">
            {firstShown}–{lastShown} of {filtered.length}
          </p>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <CaretLeft className="size-3.5" />
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onPageChange(page)}
                aria-current={page === currentPage ? "page" : undefined}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-xs font-semibold transition-colors",
                  page === currentPage
                    ? "border border-[#ff6a1a] bg-[#ff6a1a] text-white"
                    : "text-neutral-600 hover:bg-neutral-50",
                )}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              <CaretRight className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function filterReports(reports: Concern[], filter: string) {
  if (filter === "All") return reports
  if (filter === "Active") {
    return reports.filter((report) => activeStatuses.includes(report.status))
  }
  if (filter === "Resolved") {
    return reports.filter((report) => report.status === "resolved")
  }
  if (filter === "Rejected") {
    return reports.filter((report) => report.status === "rejected")
  }
  if (filter === "Appealed") {
    return reports.filter(
      (report) =>
        report.status === "appealed" ||
        (report.appeals?.some((appeal) => appeal.status === "submitted") ?? false),
    )
  }
  return reports
}