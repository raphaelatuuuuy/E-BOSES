import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon, LocateFixedIcon, PowerIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { PublicUser } from "@/features/dashboard/api"
import type { ResponderShift } from "@/features/dashboard/emergency-api"
import type { ResponderUnitView } from "@/features/dashboard/hooks/use-responder-unit"
import { formatClock, formatElapsed } from "@/features/dashboard/lib/responder-format"
import { State } from "@/features/dashboard/components/responder/dispatch-surface"

export type ResponderUnit = NonNullable<PublicUser["responder_unit"]>

/** How long the "Confirm end shift" state stays armed before reverting. */
const CONFIRM_WINDOW_MS = 4000

/**
 * End shift — a two-press control.
 *
 * Two problems with what this was:
 *
 * 1. It rendered as `variant="outline"`, which resolves to `bg-background`.
 *    Inside `.staff-dark` that is #070b18 — *darker* than the #0e1424 card it
 *    sits on — so the primary control on the Shift screen read as a hole
 *    punched in the card. Its hover state was worse: `hover:bg-accent` is
 *    solid brand orange, which in this console's token vocabulary means
 *    "press me to act", the exact opposite of a stop action.
 *
 * 2. One press ended the shift outright. Ending a shift closes the
 *    GPS-stamped session dispatch routes against, and there is no undo — a
 *    responder who fat-fingers it on a phone goes off duty silently.
 *
 * So: a red-tinted rest state that belongs to the dark card, and a press that
 * arms rather than fires. The armed state times out on its own, because a
 * confirm that stays armed forever is just a slower single press.
 */
function EndShiftButton({
  busy,
  disabled,
  onEnd,
}: {
  busy: boolean
  disabled: boolean
  onEnd: () => void
}) {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!armed) return
    timerRef.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [armed])

  // A shift that ends while the confirm is armed (from another tab, or the
  // duty mismatch resolving) must not leave the button sitting in its alarm
  // state waiting for a press that would now do nothing.
  useEffect(() => {
    if (busy) setArmed(false)
  }, [busy])

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={armed ? "Confirm end shift" : "End shift"}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onEnd()
        } else {
          setArmed(true)
        }
      }}
      onBlur={() => setArmed(false)}
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-sm font-bold transition-colors duration-[--duration-micro] disabled:pointer-events-none disabled:opacity-50 md:w-auto",
        armed
          ? "bg-sos text-white"
          : "border border-card-line-strong bg-card-raised text-foreground hover:border-sos/60 hover:bg-sos/15 hover:text-sos",
      )}
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <PowerIcon className="size-4" />
      )}
      {armed ? "Confirm end shift" : "End shift"}
    </button>
  )
}

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
          <p className="text-micro uppercase tracking-wide text-subtle-foreground">
            Response unit
          </p>
          <p className="mt-1.5 truncate text-[22px] font-bold leading-tight tracking-tight text-foreground">
            {unit.name}
          </p>
          <p className="mt-1 text-body leading-6 text-muted-foreground">
            {unit.assigned
              ? unit.description || "Assigned by your barangay."
              : "Ask a barangay official to place you in a unit before starting a shift."}
          </p>

          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
            <State
              label={isOnDuty ? "On duty" : "Off duty"}
              tone={isOnDuty ? "settled" : "idle"}
            />
            {activeShift ? (
              <span className="text-body text-subtle-foreground">
                since {formatClock(activeShift.started_at)}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-col gap-3 md:items-end">
          <div className="md:text-right">
            <p className="text-micro uppercase tracking-wide text-subtle-foreground">
              Shift time
            </p>
            <p className="mt-1 text-4xl font-bold leading-none tabular-nums text-foreground">
              {formatElapsed(activeShift?.started_at ?? null, now)}
            </p>
          </div>

          {isOnDuty ? (
            <EndShiftButton busy={busy === "end"} disabled={working} onEnd={onEnd} />
          ) : (
            <Button
              type="button"
              disabled={working || !unit.assigned}
              onClick={onStart}
              className="h-11 w-full rounded-full px-5 text-sm font-bold md:w-auto"
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
