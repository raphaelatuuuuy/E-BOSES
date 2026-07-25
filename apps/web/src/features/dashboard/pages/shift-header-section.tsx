import { Clock, Crosshair as LocateFixedIcon, Spinner } from "@phosphor-icons/react"
import { Button } from "@workspace/ui/components/button"
import type { ResponderShift } from "@/features/dashboard/emergency-api"

function formatDuration(startedAt: string | null, nowMs: number) {
  if (!startedAt) return "00:00"
  const seconds = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

export function ShiftHeaderSection({
  fullName,
  unit,
  unitLabel,
  isOnDuty,
  hasDutyMismatch,
  activeShift,
  now,
  busy,
  onUnitChange,
  onStartShift,
  onEndShift,
}: {
  fullName: string
  unit: string
  unitLabel: string
  isOnDuty: boolean
  hasDutyMismatch: boolean
  activeShift: ResponderShift | null
  now: number
  busy: string
  onUnitChange: (unit: string) => void
  onStartShift: () => void
  onEndShift: () => void
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-[#f23b35] to-[#ff8133] p-5 text-white">
        <p className="text-[12px] font-black uppercase tracking-wide text-white/80">Responder shift</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight">{fullName}</h1>
            <p className="mt-1 text-sm font-semibold text-white/85">
              {unitLabel} · {isOnDuty ? "On duty" : hasDutyMismatch ? "Availability on · shift not started" : "Off duty"}
            </p>
          </div>
          <div className="rounded-2xl bg-white/15 px-4 py-3 text-right backdrop-blur">
            <p className="text-[11px] font-black uppercase tracking-wide text-white/75">Shift time</p>
            <p className="mt-1 text-3xl font-black tabular-nums">{formatDuration(activeShift?.started_at ?? null, now)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <label htmlFor="responder-unit" className="text-xs font-black uppercase tracking-wide text-neutral-500">Response unit</label>
          <select
            id="responder-unit"
            value={unit}
            disabled={Boolean(busy) || isOnDuty}
            onChange={(event) => onUnitChange(event.target.value)}
            className="mt-2 h-12 w-full rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-bold text-[#07145f] outline-none focus:border-[#ff6a1a]"
          >
            <option value="tanod">Barangay Tanod - crime/security</option>
            <option value="bhw">BHW - medical</option>
            <option value="bdrrmo">BDRRMO - fire/disaster</option>
            <option value="other">Other responder</option>
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" disabled={Boolean(busy) || isOnDuty} onClick={onStartShift} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">
            {busy === "start" ? <Spinner className="size-4 animate-spin" /> : <LocateFixedIcon className="size-4" />}
            Start shift
          </Button>
          <Button type="button" variant="outline" disabled={Boolean(busy) || !isOnDuty} onClick={onEndShift}>
            {busy === "end" ? <Spinner className="size-4 animate-spin" /> : <Clock className="size-4" />}
            End shift
          </Button>
        </div>
      </div>
    </section>
  )
}
