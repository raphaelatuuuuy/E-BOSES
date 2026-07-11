import { cn } from "@workspace/ui/lib/utils"
import { ChevronRight, FileQuestionIcon, LeafIcon, SearchIcon, ShieldCheckIcon, TrafficConeIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { Badge } from "@workspace/ui/components/badge"
import type { Concern } from "@/features/dashboard/api"

const categoryIcon: Record<string, React.ComponentType<{ className?: string }>> = {
  infrastructure: TrafficConeIcon,
  environment: LeafIcon,
  public_safety: ShieldCheckIcon,
  others: SearchIcon,
}

const categoryColor: Record<string, { bg: string; text: string }> = {
  infrastructure: { bg: "bg-amber-50", text: "text-amber-600" },
  environment: { bg: "bg-green-50", text: "text-green-600" },
  public_safety: { bg: "bg-red-50", text: "text-red-600" },
  others: { bg: "bg-slate-100", text: "text-slate-600" },
}

const categoryLabel: Record<string, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

interface Props {
  reports: Concern[]
}

export function ActiveReportsCard({ reports }: Props) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-white shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div className="min-w-0 px-5 pb-2 pt-4">
        <h2 className="font-heading text-base font-bold text-[#07145f]">My Active Reports</h2>
      </div>

      <div className="flex-1 px-5">
        {reports.slice(0, 3).map((r) => {
          const Icon = categoryIcon[r.category] ?? FileQuestionIcon
          const color = categoryColor[r.category] ?? { bg: "bg-slate-100", text: "text-slate-600" }
          return (
            <Link
              key={r.id}
              to={`/dashboard/reports/${r.id}`}
              className="-mx-5 flex min-h-16 items-center gap-4 border-b border-border px-5 py-3 transition-colors last:border-b-0 hover:bg-gray-50"
            >
              <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-full", color.bg)}>
                <Icon className={cn("size-5", color.text)} strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-bold text-[#07145f]">{r.title}</p>
                  <span className="shrink-0 rounded-full bg-[#eef3ff] px-2.5 py-0.5 text-[11px] font-medium text-[#2447b3]">{categoryLabel[r.category] ?? "Others"}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-x-2 text-xs font-medium text-[#24518f]">
                  <span>{formatDate(r.created_at)}</span>
                </div>
                <p className="mt-1 truncate text-xs text-[#46537d]">{r.description}</p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-[#0047b3]" />
            </Link>
          )
        })}
        {reports.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[190px] text-sm text-[#46537d]">
            <img src="/contents/create-report.png" alt="" className="mb-4 h-32 w-auto" aria-hidden="true" />
            <p className="mb-3 text-sm">No active reports yet.</p>
            <Link
              to="/dashboard/reports"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
            >
              Create Report
            </Link>
            <div className="h-4" />
          </div>
        )}
      </div>

      <div className="mt-auto px-5 py-4">
        <Link
          to="/dashboard/reports"
          className="flex items-center justify-between text-sm font-semibold text-[#0047b3] transition-colors hover:text-[#003580]"
        >
          <span>View all my reports</span>
          <ChevronRight className="size-5" />
        </Link>
      </div>
    </section>
  )
}
