import { cn } from "@workspace/ui/lib/utils"
import { AlertTriangleIcon, ChevronRight, FileTextIcon, PencilIcon, UsersIcon } from "lucide-react"
import type { ComponentType } from "react"
import { Link } from "react-router-dom"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"

const actions = [
  {
    label: "Create Report",
    desc: "Report a concern in your area",
    icon: PencilIcon,
    to: null,
  },
  {
    label: "Track Reports",
    desc: "Check status and updates",
    icon: FileTextIcon,
    to: "/dashboard/reports",
  },
  {
    label: "Community Feed",
    desc: "See announcements and discussions",
    icon: UsersIcon,
    to: "/dashboard/feed",
  },
  {
    label: "Emergency Help",
    desc: "Get urgent help from our team",
    icon: AlertTriangleIcon,
    to: null,
    emergency: true,
  },
]

function ActionContents({
  icon: Icon,
  label,
  desc,
  emergency,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  desc: string
  emergency?: boolean
}) {
  return (
    <>
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${emergency ? "bg-red-50" : "bg-[#eef3ff]"}`}>
        <Icon className={`size-5 ${emergency ? "text-red-500" : "text-[#2447b3]"}`} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold md:text-sm ${emergency ? "text-red-600" : "text-[#07145f]"}`}>{label}</p>
        <p className="mt-1 text-[11px] leading-4 text-[#46537d] md:text-xs">{desc}</p>
      </div>
    </>
  )
}

export function QuickActionsCard() {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-white shadow-[0_10px_28px_rgba(15,23,42,0.08)]">
      <div className="min-w-0 px-5 pb-2 pt-4">
        <h2 className="font-heading text-base font-bold text-[#07145f]">Quick Actions</h2>
      </div>

      <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
        {actions.map((a) => {
          const Icon = a.icon
          const className = cn(
            "flex min-h-[80px] items-center gap-4 rounded-xl bg-white px-5 py-4 text-left no-underline transition-colors",
            a.emergency ? "hover:bg-red-50" : "hover:bg-gray-50",
          )
          return a.to ? (
            <Link
              key={a.label}
              to={a.to}
              className={className}
            >
              <ActionContents icon={Icon} label={a.label} desc={a.desc} emergency={a.emergency} />
            </Link>
          ) : (
            <CreateReportDialog
              key={a.label}
              trigger={(open) => (
                <button
                  type="button"
                  onClick={a.emergency ? () => window.dispatchEvent(new CustomEvent("eboses:open-sos")) : open}
                  className={className}
                >
                  <ActionContents icon={Icon} label={a.label} desc={a.desc} emergency={a.emergency} />
                </button>
              )}
            />
          )
        })}
      </div>

      <div className="mt-auto px-5 py-4">
        <Link
          to="/dashboard/feed"
          className="flex items-center justify-between text-sm font-semibold text-[#0047b3] transition-colors hover:text-[#003580]"
        >
          <span>View all features</span>
          <ChevronRight className="size-5" />
        </Link>
      </div>
    </section>
  )
}
