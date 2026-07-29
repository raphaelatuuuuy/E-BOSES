import { useCallback, useEffect, useRef, useState } from "react"
import { XIcon } from "lucide-react"

import { RecordDetail } from "./record-detail"
import { SeverityBadge } from "./record-header"
import type { RecordView } from "./types"

/**
 * Mobile container: a bottom sheet with three snap points.
 *
 *   peek  — severity, type, address, elapsed; the map stays visible
 *   half  — adds the workflow strip and the primary action. This is where
 *           dispatch actually happens: the official needs the map and the
 *           action on screen together.
 *   full  — every section
 *
 * It renders the same `RecordDetail` as the desktop panel. The previous sheet
 * had its own cut-down markup, which is why information went missing on mobile.
 *
 * Also fixes: body scroll was never locked, focus was never trapped, and focus
 * was not returned to the marker that opened it.
 */

type Snap = "peek" | "half" | "full"

const SNAP_HEIGHT: Record<Snap, string> = {
  peek: "8.5rem",
  half: "55vh",
  full: "92vh",
}

const SNAP_ORDER: Snap[] = ["peek", "half", "full"]

export function RecordSheet({
  record,
  open,
  onClose,
  initialSnap = "half",
}: {
  record: RecordView | null
  open: boolean
  onClose: () => void
  initialSnap?: Snap
}) {
  const [snap, setSnap] = useState<Snap>(initialSnap)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dragStartRef = useRef<{ y: number; snap: Snap } | null>(null)

  // Reset the snap point on the closed -> open transition. Done as a render
  // adjustment rather than an effect so it lands in the same commit the sheet
  // opens in; an effect would paint one frame at the previous snap first.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSnap(initialSnap)
  }

  // Lock body scroll while open, and restore exactly what was there before —
  // overwriting with "" would clobber a lock set by something else.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  // Remember what had focus, move focus into the sheet, and give it back on close.
  useEffect(() => {
    if (!open) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    sheetRef.current?.focus()
    return () => {
      restoreFocusRef.current?.focus?.()
    }
  }, [open])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== "Tab") return

      // Focus trap: keep Tab inside the sheet while it is modal.
      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  const onDragStart = (clientY: number) => {
    dragStartRef.current = { y: clientY, snap }
  }

  const onDragEnd = (clientY: number) => {
    const start = dragStartRef.current
    dragStartRef.current = null
    if (!start) return

    const delta = clientY - start.y
    if (Math.abs(delta) < 40) return

    const index = SNAP_ORDER.indexOf(start.snap)
    if (delta > 0) {
      // Dragged down past the smallest snap = dismiss.
      if (index === 0) onClose()
      else setSnap(SNAP_ORDER[index - 1])
    } else if (index < SNAP_ORDER.length - 1) {
      setSnap(SNAP_ORDER[index + 1])
    }
  }

  if (!open || !record) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        className="absolute inset-0 bg-brand-navy/40"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${record.typeLabel} details`}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{ height: SNAP_HEIGHT[snap] }}
        className="absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-canvas shadow-2xl outline-none transition-[height] duration-200 ease-out motion-reduce:transition-none"
      >
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-3"
          onPointerDown={(event) => onDragStart(event.clientY)}
          onPointerUp={(event) => onDragEnd(event.clientY)}
        >
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-card-line" aria-hidden />
        </div>

        {/* Peek keeps the essentials on screen so the map stays useful. */}
        {snap === "peek" ? (
          <div className="flex items-start gap-3 px-4 pb-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-control bg-tint px-2 py-0.5 text-[11px] font-bold uppercase text-brand-navy">
                  {record.typeLabel}
                </span>
                <SeverityBadge severity={record.severity} assessed={record.severityAssessed} />
              </div>
              <p className="truncate text-sm font-semibold text-foreground">
                {record.address ?? "Location unavailable"}
              </p>
              {record.elapsedLabel ? (
                <p className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {record.elapsedLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setSnap("half")}
              className="shrink-0 rounded-panel bg-brand-orange px-3 py-2 text-xs font-bold text-brand-orange-ink"
            >
              Open
            </button>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-end px-4 pb-1">
              <button
                type="button"
                onClick={onClose}
                aria-label="Close details"
                className="rounded-control p-1.5 text-muted-foreground hover:bg-tint"
              >
                <XIcon className="size-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6">
              <RecordDetail record={record} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
