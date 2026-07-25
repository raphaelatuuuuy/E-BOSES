import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

export function ResponderDispatchList({
  alerts,
  selectedId,
  onSelect,
}: {
  alerts: EmergencyAlert[]
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-black text-[#07145f]">Dispatch list</p>
      <div className="mt-3 space-y-2">
        {alerts.length === 0 ? (
          <p className="rounded-2xl bg-neutral-50 p-3 text-xs font-semibold text-neutral-500">
            No assigned incidents.
          </p>
        ) : (
          alerts.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => onSelect(alert.id)}
              className={cn(
                "w-full rounded-2xl border p-3 text-left transition-colors",
                selectedId === alert.id
                  ? "border-[#ff6a1a] bg-[#fff4ed]"
                  : "border-neutral-200 bg-white hover:border-neutral-300",
              )}
            >
              <p className="truncate text-sm font-black capitalize text-[#07145f]">
                {alert.type} emergency
              </p>
              <p className="mt-1 truncate text-xs font-semibold text-neutral-500">
                {alert.address || alert.barangay}
              </p>
            </button>
          ))
        )}
      </div>
    </section>
  )
}
