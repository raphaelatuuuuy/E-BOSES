import { type ReactNode } from "react"
import { ArrowsClockwise, Phone, ShieldCheck, Users, Warning } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { responderName } from "@/features/dashboard/components/emergencies-components"
import { unitLabel } from "@/features/dashboard/components/emergencies-components.utils"
import type { ActiveResponder } from "@/features/dashboard/api"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

function distanceKm(aLat?: string | number | null, aLng?: string | number | null, bLat?: string | number | null, bLng?: string | number | null) {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null
  const lat1 = Number(aLat); const lng1 = Number(aLng); const lat2 = Number(bLat); const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const rad = Math.PI / 180; const dLat = (lat2 - lat1) * rad; const dLng = (lng2 - lng1) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function hasAutoRoute(alert: EmergencyAlert) {
  return alert.status_events.some((event) => event.note.toLowerCase().includes("auto-routed"))
}

function eligibleUnits(alert: EmergencyAlert) {
  const map: Record<string, string[]> = { medical: ["bhw"], fire: ["bdrrmo"], crime: ["tanod"], disaster: ["bdrrmo"], other: ["tanod", "bhw", "bdrrmo"] }
  return map[alert.type] || []
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border border-slate-200 bg-[#f8fafc] px-2 text-center text-xs font-black text-[#07145f] transition-colors hover:border-[#ff6a1a] hover:text-[#ff6a1a]">
      <span className="text-[#ff6a1a]">{icon}</span>
      {label}
    </button>
  )
}

export function ResponseTeamSection({
  assignments,
  activeAssignments,
  busyAction,
  onRemove,
}: {
  assignments: EmergencyAlert["assignments"]
  activeAssignments: EmergencyAlert["assignments"]
  busyAction: string
  onRemove: (assignment: EmergencyAlert["assignments"][number]) => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Response team</p>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">Add support, replace the team, or remove support with an audit reason.</p>
        </div>
        <span className="rounded-md bg-[#eaf0ff] px-2 py-1 text-xs font-black text-[#07145f]">{activeAssignments.length} active</span>
      </div>
      <div className="mt-3 grid gap-2">
        {assignments.length ? assignments.map((assignment) => {
          const active = !["cancelled", "declined", "resolved"].includes(assignment.status)
          return (
            <div key={assignment.id} className={cn("flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2", !active && "bg-slate-50 opacity-60")}>
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-[#07145f]">{responderName(assignment.responder)}</p>
                <p className="mt-0.5 text-[11px] font-semibold capitalize text-[#68739c]">{assignment.status.replace(/_/g, " ")}</p>
              </div>
              {active && activeAssignments.length > 1 ? (
                <Button type="button" size="sm" variant="outline" disabled={Boolean(busyAction)} onClick={() => onRemove(assignment)} className="h-8 border-red-200 text-xs text-red-700 hover:bg-red-50">
                  Remove
                </Button>
              ) : null}
            </div>
          )
        }) : (
          <p className="rounded-xl bg-[#f8fafc] p-3 text-xs font-semibold text-[#68739c]">No response team has been assigned.</p>
        )}
      </div>
    </section>
  )
}

export function TeamActionConfirm({
  action,
  reason,
  busy,
  responderName: name,
  onReasonChange,
  onKeep,
  onConfirm,
}: {
  action: { kind: "replace"; responder: ActiveResponder } | { kind: "remove"; assignmentId: number; responderName: string } | null
  reason: string
  busy: boolean
  responderName?: string
  onReasonChange: (value: string) => void
  onKeep: () => void
  onConfirm: () => void
}) {
  if (!action) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-black text-amber-950">
        {action.kind === "replace"
          ? `Replace the active response team with ${name || action.responder.full_name}?`
          : `Remove ${action.responderName} from this response?`}
      </p>
      <label htmlFor="dispatch-team-reason" className="mt-2 block text-[11px] font-bold text-amber-900">Operational reason</label>
      <textarea id="dispatch-team-reason" value={reason} onChange={(e) => onReasonChange(e.target.value)} rows={2} maxLength={255} placeholder="Explain why this assignment is changing" className="mt-1 w-full resize-none rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-[#07145f] outline-none focus:border-[#ff6a1a]" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onKeep}>Keep team</Button>
        <Button type="button" size="sm" disabled={busy || reason.trim().length < 5} onClick={onConfirm} className="bg-[#07145f] text-white hover:bg-[#0b1b75]">
          {busy ? "Updating" : "Confirm change"}
        </Button>
      </div>
    </div>
  )
}

export function AssignResponderSection({
  sorted,
  alert,
  activeAssignments,
  selectedResponderSet,
  busyId,
  busyAction,
  eligibleSet,
  selectedResponderIds,
  unitLabelFn,
  onAssign,
  onReplace,
  onToggleSelect,
  onAssignSelected,
}: {
  sorted: ActiveResponder[]
  alert: EmergencyAlert | null
  activeAssignments: EmergencyAlert["assignments"]
  selectedResponderSet: Set<number>
  busyId: number | null
  busyAction: string
  eligibleSet: Set<string>
  selectedResponderIds: number[]
  unitLabelFn: Record<string, string>
  onAssign: (responder: ActiveResponder) => void
  onReplace: (responder: ActiveResponder) => void
  onToggleSelect: (id: number) => void
  onAssignSelected: () => void
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-[#07145f]">Assign responder</p>
          <p className="mt-1 text-xs font-semibold text-[#68739c]">Browse available on-duty responders sorted by distance.</p>
        </div>
        <Users className="size-5 text-[#ff6a1a]" />
      </div>
      <div className="mt-4 space-y-3">
        {sorted.length === 0 ? (
          <p className="rounded-xl bg-[#f8fafc] p-3 text-xs font-semibold text-[#68739c]">No on-duty responders with live location yet.</p>
        ) : sorted.map((responder) => {
          const km = alert ? distanceKm(alert.latitude, alert.longitude, responder.current_latitude, responder.current_longitude) : null
          const assigned = activeAssignments.some((assignment) => assignment.responder.id === responder.id)
          const selected = selectedResponderSet.has(responder.id)
          return (
            <div key={responder.id} className={cn("rounded-xl border p-3", assigned ? "border-[#ff6a1a] bg-[#fff7f1]" : "border-slate-200 bg-white")}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected} disabled={assigned} onChange={() => onToggleSelect(responder.id)} className="mt-3" aria-label={`Select ${responderName(responder)}`} />
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#07145f] text-xs font-black text-white">
                  {responder.initials || responderName(responder).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-[#07145f]">{responderName(responder)}</p>
                  <p className="mt-1 text-xs font-semibold text-[#68739c]">
                    {unitLabelFn[responder.responder_unit || ""] || "Responder"} · {km == null ? "location pending" : `${km.toFixed(1)} km away`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {eligibleSet.has(responder.responder_unit || "") ? <span className="rounded-full bg-[#eaf0ff] px-2 py-1 text-[10px] font-black text-[#07145f]">Suitable unit</span> : null}
                    {responder.is_on_duty ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">On duty</span> : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button type="button" size="sm" disabled={!alert || Boolean(busyId) || assigned} onClick={() => onAssign(responder)} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17] disabled:bg-slate-200 disabled:text-slate-500">
                  {busyId === responder.id ? "Adding" : assigned ? "Assigned" : "Add support"}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={!alert || Boolean(busyId) || assigned || activeAssignments.length === 0} onClick={() => onReplace(responder)} className="border-[#b9c9f4] text-[#2447b3]">
                  Replace team
                </Button>
              </div>
            </div>
          )
        })}
      </div>
      {sorted.length > 0 ? (
        <Button type="button" variant="outline" disabled={!alert || selectedResponderIds.length === 0 || busyAction === "assign-selected"} onClick={onAssignSelected} className="mt-3 w-full">
          {busyAction === "assign-selected" ? "Assigning selected" : `Assign selected (${selectedResponderIds.length})`}
        </Button>
      ) : null}
    </section>
  )
}

export function QuickActionsSection({
  onCallResident,
  onRefresh,
  onEscalate,
  onFalseAlarm,
  busyAction,
}: {
  onCallResident: () => void
  onRefresh: () => void
  onEscalate: () => void
  onFalseAlarm: () => void
  busyAction: string
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-[#07145f]">Quick actions</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ActionButton icon={<Phone className="size-4" />} label="Call resident" onClick={onCallResident} />
        <ActionButton icon={<ArrowsClockwise className="size-4" />} label={busyAction === "refresh-team" ? "Refreshing" : "Refresh team"} onClick={onRefresh} />
        <ActionButton icon={<Warning className="size-4" />} label={busyAction === "escalate" ? "Escalating" : "Escalate"} onClick={onEscalate} />
        <ActionButton icon={<ShieldCheck className="size-4" />} label={busyAction === "false-alarm" ? "Closing" : "False alarm"} onClick={onFalseAlarm} />
      </div>
    </section>
  )
}

export function SummarySection({
  alert,
  responderCount,
}: {
  alert: EmergencyAlert | null
  responderCount: number
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-black text-[#07145f]">Incident summary</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[#f8fafc] p-3">
          <p className="text-[10px] font-black uppercase text-[#68739c]">Active</p>
          <p className="mt-1 truncate text-sm font-black text-[#07145f]">{alert ? "1" : "0"}</p>
        </div>
        <div className="rounded-xl bg-[#f8fafc] p-3">
          <p className="text-[10px] font-black uppercase text-[#68739c]">Responders</p>
          <p className="mt-1 truncate text-sm font-black text-[#07145f]">{responderCount}</p>
        </div>
        <div className="rounded-xl bg-[#f8fafc] p-3">
          <p className="text-[10px] font-black uppercase text-[#68739c]">Auto route</p>
          <p className="mt-1 truncate text-sm font-black text-[#07145f]">{alert && hasAutoRoute(alert) ? "Yes" : "No"}</p>
        </div>
        <div className="rounded-xl bg-[#f8fafc] p-3">
          <p className="text-[10px] font-black uppercase text-[#68739c]">Eligible units</p>
          <p className="mt-1 truncate text-sm font-black text-[#07145f]">{alert ? eligibleUnits(alert).map((u) => unitLabel[u as keyof typeof unitLabel] || u).join(", ") : "—"}</p>
        </div>
      </div>
    </section>
  )
}
