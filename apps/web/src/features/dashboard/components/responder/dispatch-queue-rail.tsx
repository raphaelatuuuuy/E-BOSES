import { useState } from "react"
import { ChevronUpIcon, LayersIcon, RotateCwIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { useIsDesktop } from "@/features/dashboard/lib/shell"
import { dispatchState, formatAgo } from "@/features/dashboard/lib/responder-format"
import { State } from "@/features/dashboard/components/responder/dispatch-surface"

/**
 * The dispatch queue, reachable from the map card.
 *
 * Was three permanently-floating round buttons (queue, full map, refresh)
 * stacked in a map corner. Together with the zoom cluster opposite, that put
 * four objects over a card that is often 360px tall. It is now one chip that
 * states what it holds — "3 dispatches" — and reveals the other two actions
 * only when opened, which is also the only time they are wanted.
 *
 * The queue itself is unchanged: still a sheet, still one press away, still
 * not competing with the dispatch the responder is actually working.
 */

export function DispatchQueueRail({
  alerts,
  selectedId,
  viewerId,
  awaitingAckCount,
  onSelect,
  onRefresh,
  className,
}: {
  alerts: EmergencyAlert[]
  selectedId: number | null
  viewerId: number | null
  awaitingAckCount: number
  onSelect: (id: number) => void
  onRefresh: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const alarm = awaitingAckCount > 0
  const count = alerts.length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Dispatch queue, ${count} assigned${
          alarm ? `, ${awaitingAckCount} awaiting acknowledgement` : ""
        }`}
        className={cn(
          "flex h-11 items-center gap-2 rounded-full border border-rail-line bg-nav-glass pl-3 pr-2.5 backdrop-blur transition-colors duration-[--duration-micro]",
          alarm
            ? "text-sos hover:border-sos/50"
            : "text-nav-text hover:text-nav-text-active",
          className,
        )}
      >
        <LayersIcon className="size-4 shrink-0" />
        <span className="whitespace-nowrap text-[13px] font-semibold leading-none tabular-nums">
          {count === 0 ? "No dispatches" : `${count} dispatch${count === 1 ? "" : "es"}`}
        </span>
        {alarm ? (
          <span className="relative flex size-1.5 shrink-0 rounded-pill bg-sos text-sos">
            <span aria-hidden className="ops-pulse absolute inset-0 rounded-pill" />
          </span>
        ) : null}
        <ChevronUpIcon className="size-4 shrink-0 opacity-60" strokeWidth={2.4} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side={isDesktop ? "right" : "bottom"} aria-label="Dispatch queue">
          <SheetHeader>
            <SheetTitle>Dispatch queue</SheetTitle>
          </SheetHeader>

          <div className="flex items-center gap-2 px-4 pb-1">
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-9 items-center gap-2 rounded-full border border-card-line px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground"
            >
              <RotateCwIcon className="size-4 shrink-0" />
              Refresh
            </button>
          </div>

          {alerts.length === 0 ? (
            <p className="px-4 pb-6 text-body text-subtle-foreground">
              Nothing is assigned to you right now.
            </p>
          ) : (
            <ul className="max-h-[70svh] overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {alerts.map((alert) => {
                const state = dispatchState(alert, viewerId)
                const active = alert.id === selectedId
                return (
                  <li key={alert.id}>
                    <button
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        onSelect(alert.id)
                        setOpen(false)
                      }}
                      className={cn(
                        "w-full rounded-2xl px-3 py-3 text-left transition-colors duration-[--duration-micro]",
                        active ? "bg-card-raised" : "hover:bg-card-raised",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-heading capitalize text-foreground">
                          {alert.type}
                        </span>
                        <span className="shrink-0 text-body tabular-nums text-subtle-foreground">
                          {formatAgo(alert.created_at)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-body text-muted-foreground">
                        {alert.address || alert.barangay}
                      </p>
                      <State label={state.label} tone={state.tone} className="mt-1.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
