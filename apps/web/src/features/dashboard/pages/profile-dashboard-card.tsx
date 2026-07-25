import { useNavigate } from "react-router-dom"
import type { DashboardSummary } from "@/features/dashboard/api"

export function ProfileDashboardCard({
  summary,
  postsLength,
  memberSince,
}: {
  summary: DashboardSummary | null
  postsLength: number
  memberSince: string
}) {
  const navigate = useNavigate()

  return (
    <section className="mt-6 px-4 sm:px-6">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-bold text-neutral-900">Dashboard</h2>
        <span className="text-[12px] text-neutral-500">Only visible to you</span>
      </div>
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
        <p className="text-[14px] font-semibold text-neutral-900">Your reports at a glance</p>
        <p className="mt-0.5 text-[12px] text-neutral-500">Member since {memberSince}</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Submitted", value: summary?.reports_submitted ?? postsLength },
            { label: "Resolved", value: summary?.reports_resolved ?? 0 },
            { label: "Active", value: summary?.reports_active ?? 0 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl bg-neutral-50 px-2 py-3 text-center">
              <p className="text-[20px] font-bold tabular-nums text-neutral-900">{stat.value}</p>
              <p className="mt-0.5 text-[11px] font-medium text-neutral-500">{stat.label}</p>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => navigate("/dashboard/reports")} className="mt-3 text-[13px] font-semibold text-[#2447b3] hover:underline">
          View reports →
        </button>
      </div>
    </section>
  )
}
