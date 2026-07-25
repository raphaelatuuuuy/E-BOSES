import { Radio as RadioIcon, ShieldCheck, Spinner, Warning } from "@phosphor-icons/react"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

export function ShiftDispatchLog({
  loading,
  alerts,
}: {
  loading: boolean
  alerts: EmergencyAlert[]
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Today&apos;s dispatch log</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">
            Active assignments from dispatch plus persisted shift history.
          </p>
        </div>
        <RadioIcon className="size-5 text-[#ff6a1a]" />
      </div>

      {loading ? (
        <div className="mt-5 flex items-center justify-center py-10">
          <Spinner className="size-8 animate-spin text-neutral-400" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-neutral-200 p-8 text-center">
          <ShieldCheck className="mx-auto size-9 text-emerald-600" />
          <p className="mt-2 text-sm font-black text-neutral-900">No dispatches yet</p>
          <p className="mt-1 text-xs text-neutral-500">Assigned incidents will appear here during your shift.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {alerts.map((alert) => (
            <article key={alert.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-700">
                    <Warning className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black capitalize text-[#07145f]">{alert.type} emergency</p>
                    <p className="mt-1 truncate text-xs font-semibold text-neutral-500">{alert.address || alert.barangay}</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#eef3ff] px-2.5 py-1 text-[11px] font-black text-[#07145f]">
                  {alert.status === "acknowledged" ? "responder routed" : alert.status.replace(/_/g, " ")}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-600">
                {alert.note || "No note provided."}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
