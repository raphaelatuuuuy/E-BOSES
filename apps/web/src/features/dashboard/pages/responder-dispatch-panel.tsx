import { CheckCircle, Crosshair, MapPin, CircleNotch, Radio } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyAlert, EmergencyRoute, EmergencyStatus } from "@/features/dashboard/emergency-api"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"

const statusLabel: Record<EmergencyStatus, string> = {
  submitted: "Submitted",
  routed: "Responder routed",
  acknowledged: "Automatically routed",
  en_route: "En route",
  nearby: "Nearby",
  arrived: "Arrived",
  resolved: "Resolved",
  cancelled: "Cancelled",
}

function statusClass(status: EmergencyStatus) {
  if (status === "arrived" || status === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "en_route" || status === "nearby") return "border-blue-200 bg-blue-50 text-blue-700"
  if (status === "acknowledged" || status === "routed") return "border-amber-200 bg-amber-50 text-amber-700"
  return "border-red-200 bg-red-50 text-red-700"
}

export function ResponderDispatchPanel({
  selected,
  alerts,
  selectedActiveTeam,
  route,
  routeSummary,
  selectedDistance,
  busy,
  responseNote,
  onResponseNoteChange,
  onPingSelected,
  onArrivedSelected,
  onResolveSelected,
  onRequestBackup,
}: {
  selected: EmergencyAlert | null
  alerts: EmergencyAlert[]
  selectedActiveTeam: EmergencyAlert["assignments"]
  route: EmergencyRoute | null
  routeSummary: string
  selectedDistance: number | null
  busy: string
  responseNote: string
  onResponseNoteChange: (value: string) => void
  onPingSelected: () => void
  onArrivedSelected: () => void
  onResolveSelected: () => void
  onRequestBackup: () => void
}) {
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Selected dispatch</p>
          <p className="mt-1 text-xs font-semibold text-neutral-500">
            {alerts.length} assigned incident{alerts.length === 1 ? "" : "s"}
          </p>
        </div>
        <Radio className="size-5 text-[#ff6a1a]" />
      </div>

      {!selected ? (
        <div className="mt-4 rounded-2xl border border-dashed border-neutral-200 p-5 text-center">
          <CheckCircle className="mx-auto size-8 text-emerald-600" />
          <p className="mt-2 text-sm font-bold text-neutral-900">No active assignments</p>
          <p className="mt-1 text-xs text-neutral-500">New dispatches will appear here.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-neutral-200 bg-[#fffaf7] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-black uppercase text-red-600">
                  {selected.type} emergency
                </p>
                <h2 className="mt-1 text-lg font-black text-[#07145f]">
                  {selected.address || selected.barangay}
                </h2>
              </div>
              <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-black", statusClass(selected.status))}>
                {statusLabel[selected.status]}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-neutral-600">
              {selected.note || "No note provided."}
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-bold text-neutral-500">
              <MapPin className="size-3.5" />
              {route?.status === "ok"
                ? routeSummary
                : selectedDistance == null
                  ? "Distance pending GPS"
                  : `${selectedDistance.toFixed(1)} km away · direction line`}
            </p>
          </div>

          <div className="grid gap-2">
            <Button
              type="button"
              disabled={Boolean(busy)}
              onClick={onPingSelected}
              className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]"
            >
              {busy === "ping" ? <CircleNotch className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
              Send GPS · Mark en route
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || !["en_route", "nearby"].includes(selected.status)}
              onClick={onArrivedSelected}
            >
              {busy === "arrived" ? <CircleNotch className="size-4 animate-spin" /> : <MapPin className="size-4" />}
              I have arrived on scene
            </Button>
            <label>
              <span className="mb-1.5 block text-xs font-bold text-neutral-700">Response details</span>
              <textarea
                value={responseNote}
                onChange={(e) => onResponseNoteChange(e.target.value)}
                maxLength={255}
                rows={3}
                aria-label="Response details"
                placeholder="Record assistance, outcome, or handoff details."
                className="w-full resize-y rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none focus:border-[#ff6a1a] focus:ring-2 focus:ring-[#ff6a1a]/15"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || selected.status !== "arrived" || responseNote.trim().length < 3}
              onClick={onResolveSelected}
            >
              {busy === "resolve" ? <CircleNotch className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
              Resolve incident
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || ["resolved", "cancelled"].includes(selected.status)}
              onClick={onRequestBackup}
            >
              {busy === "backup" ? <CircleNotch className="size-4 animate-spin" /> : <Radio className="size-4" />}
              Request backup
            </Button>
          </div>

          <EmergencyChatPanel
            alertId={selected.id}
            open
            theme="light"
            disabled={["resolved", "cancelled"].includes(selected.status)}
            participantHint={
              selectedActiveTeam.length > 0
                ? `Group · resident + ${selectedActiveTeam.length} responder${selectedActiveTeam.length === 1 ? "" : "s"}`
                : "Group chat opens after an active responder is assigned"
            }
            className="min-h-[320px]"
          />
        </div>
      )}
    </section>
  )
}
