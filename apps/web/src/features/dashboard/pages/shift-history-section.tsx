import { CheckCircle as CheckCircleIcon } from "@phosphor-icons/react"
import type { ResponderShift } from "@/features/dashboard/emergency-api"

const shiftStartFormatter = new Intl.DateTimeFormat("en", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
})
const shiftEndFormatter = new Intl.DateTimeFormat("en", {
  hour: "numeric", minute: "2-digit",
})

function formatSeconds(seconds: number | null | undefined) {
  if (seconds == null) return "—"
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes}m ${secs}s`
}

const unitLabels: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "BHW",
  bdrrmo: "BDRRMO",
  other: "Other responder",
  "": "Responder",
}

export function ShiftHistorySection({
  shiftHistory,
}: {
  shiftHistory: ResponderShift[]
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-[#f8fafc] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-black text-[#07145f]">Shift history</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-neutral-600">
              Shift sessions are stored in the backend with automatically routed, resolved, false alarm, and average response metrics.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {shiftHistory.length === 0 ? (
          <p className="rounded-2xl bg-white p-3 text-xs font-semibold text-neutral-500">No shift history yet.</p>
        ) : (
          shiftHistory.slice(0, 5).map((shift) => (
            <div key={shift.id} className="grid gap-2 rounded-2xl border border-neutral-200 bg-white p-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="font-black text-[#07145f]">
                  {shift.status === "active" ? "Active shift" : "Completed shift"} · {unitLabels[(shift.responder_unit as string) || ""]}
                </p>
                <p className="mt-1 font-semibold text-neutral-500">
                  {shiftStartFormatter.format(new Date(shift.started_at))}
                  {shift.ended_at ? ` – ${shiftEndFormatter.format(new Date(shift.ended_at))}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5 font-black text-neutral-600 sm:justify-end">
                <span className="rounded-lg bg-[#fff4ed] px-2 py-1">{shift.incidents_assigned} assigned</span>
                <span className="rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">{shift.incidents_resolved} resolved</span>
                <span className="rounded-lg bg-[#eef3ff] px-2 py-1 text-[#07145f]">avg {formatSeconds(shift.average_response_seconds)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
