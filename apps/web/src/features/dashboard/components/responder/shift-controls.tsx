import { LoaderCircleIcon, LocateFixedIcon, PowerIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { PublicUser } from "@/features/dashboard/api"
import type { ResponderShift } from "@/features/dashboard/emergency-api"
import type { ResponderUnitView } from "@/features/dashboard/hooks/use-responder-unit"
import { formatClock, formatElapsed } from "@/features/dashboard/lib/responder-format"

export type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

/**
 * Duty band — who the responder is, and the one control that changes their
 * availability. The dominant region on the Shift screen.
 *
 * The unit is a readout, not a picker. It used to be a `<select>` whose value
 * was sent on shift start and written straight to the account, which meant a
 * responder could put themselves in another unit and start receiving that
 * unit's emergencies. Membership belongs to the barangay: officials set it in
 * Configuration, Units, and it is displayed here.
 */
export function ShiftControls({
  unit,
  isOnDuty,
  busy,
  activeShift,
  now,
  onStart,
  onEnd,
}: {
  unit: ResponderUnitView
  isOnDuty: boolean
  busy: string
  activeShift: ResponderShift | null
  now: number
  onStart: () => void
  onEnd: () => void
}) {
  const working = Boolean(busy)

  return (
    <section className="overflow-hidden rounded-3xl border border-card-line bg-card">
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:p-6">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-wide text-nav-muted">Response unit</p>
          <p className="mt-1.5 truncate text-xl font-bold leading-tight text-foreground">
            {unit.name}
          </p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {unit.assigned
              ? unit.description || "Assigned by your barangay."
              : "Ask a barangay official to place you in a unit before starting a shift."}
          </p>

          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "relative flex size-1.5 shrink-0 rounded-full",
                  isOnDuty ? "bg-status-closed text-status-closed" : "bg-subtle-foreground",
                )}
                aria-hidden
              >
                {isOnDuty ? (
                  <span className="ops-pulse absolute inset-0 rounded-full" />
                ) : null}
              </span>
              <span
                className={cn(
                  "uppercase tracking-wide",
                  isOnDuty ? "text-status-closed" : "text-subtle-foreground",
                )}
              >
                {isOnDuty ? "On duty" : "Off duty"}
              </span>
            </span>
            {activeShift ? (
              <span className="text-subtle-foreground">
                since {formatClock(activeShift.started_at)}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <div className="md:text-right">
            <p className="text-micro uppercase tracking-wide text-nav-muted">Shift time</p>
            <p className="mt-1 text-4xl font-bold leading-none tabular-nums text-foreground">
              {formatElapsed(activeShift?.started_at ?? null, now)}
            </p>
          </div>

          {isOnDuty ? (
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={onEnd}
              className="h-11 w-full md:w-auto"
            >
              {busy === "end" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <PowerIcon className="size-4" />
              )}
              End shift
            </Button>
          ) : (
            <Button
              type="button"
              disabled={working || !unit.assigned}
              onClick={onStart}
              className="h-11 w-full md:w-auto"
            >
              {busy === "start" ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <LocateFixedIcon className="size-4" />
              )}
              Start shift
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
