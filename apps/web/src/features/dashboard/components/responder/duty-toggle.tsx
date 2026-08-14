import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon, PowerIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useResponderDuty } from "@/features/dashboard/hooks/use-responder-duty"

const CONFIRM_WINDOW_MS = 4000

export function DutyToggle({ className }: { className?: string }) {
  const { unit, isOnDuty, busy, startDuty, endDuty } = useResponderDuty()
  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!armed) return
    timerRef.current = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS)
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [armed])

  const working = Boolean(busy)
  const [prevBusy, setPrevBusy] = useState<boolean | undefined>(undefined)
  if (prevBusy !== working) {
    setPrevBusy(working)
    if (working) setArmed(false)
  }

  function onClick() {
    if (isOnDuty) {
      if (armed) {
        setArmed(false)
        void endDuty().catch(() => undefined)
      } else {
        setArmed(true)
      }
    } else {
      void startDuty().catch(() => undefined)
    }
  }

  return (
    <button
      type="button"
      disabled={working || (!isOnDuty && (!unit.assigned || unit.loading))}
      aria-pressed={isOnDuty}
      aria-label={
        armed ? "Confirm end shift" : isOnDuty ? "End shift" : "Start shift"
      }
      title={
        !isOnDuty && !unit.assigned && !unit.loading
          ? "Ask a barangay official to place you in a unit first"
          : armed
            ? "Tap again to confirm"
            : isOnDuty
              ? "Tap to end your shift"
              : "Start a shift to receive dispatches"
      }
      onClick={onClick}
      onBlur={() => setArmed(false)}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-pill border px-3.5 text-label transition-colors duration-[--duration-micro] disabled:pointer-events-none disabled:opacity-50",
        armed
          ? "border-sos/60 bg-sos/15 text-sos"
          : isOnDuty
            ? "border-card-line-strong bg-card-raised text-foreground hover:bg-card-raised"
            : "border-transparent bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong",
        className,
      )}
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin" />
      ) : isOnDuty ? (
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-pill bg-status-closed opacity-60" />
          <span className="relative inline-flex size-2 rounded-pill bg-status-closed" />
        </span>
      ) : (
        <PowerIcon className="size-4 shrink-0" />
      )}
      {armed ? "Confirm end shift" : isOnDuty ? "On duty" : "Start shift"}
    </button>
  )
}
