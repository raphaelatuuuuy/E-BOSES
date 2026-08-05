import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * A two-pane split with a draggable divider.
 *
 * Hand-rolled rather than pulled from a library: the app has no resizable
 * dependency today, this needs ~100 lines, and the one behaviour a library
 * would give us for free (nested groups) is not wanted here — the dispatch
 * console composes two independent splits instead, so each remembers its own
 * size under its own key.
 *
 * Sizing is expressed as the *first* pane's percentage of the container. The
 * second pane always takes the remainder, so the pair can never fail to fill
 * their row and a window resize needs no recalculation.
 *
 * Interaction:
 * - drag the divider, or focus it and use arrow keys (2% a step, 10% with
 *   shift) — the keyboard path is why the divider is a `separator` with the
 *   full ARIA valuenow/min/max set rather than a bare div
 * - double-click resets to `defaultSize`
 * - the size persists to localStorage under `storageKey`
 */

const MIN_PERCENT = 18
const MAX_PERCENT = 82
const KEY_STEP = 2
const KEY_STEP_LARGE = 10

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readStored(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback
  const raw = window.localStorage.getItem(key)
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? clamp(parsed, MIN_PERCENT, MAX_PERCENT) : fallback
}

export function ResizableSplit({
  orientation,
  first,
  second,
  storageKey,
  defaultSize = 50,
  minSize = MIN_PERCENT,
  maxSize = MAX_PERCENT,
  label,
  className,
  /** Collapse the split to `first` alone — used when the other pane is minimised. */
  firstOnly = false,
  /** Collapse the split to `second` alone. */
  secondOnly = false,
}: {
  orientation: "vertical" | "horizontal"
  first: React.ReactNode
  second: React.ReactNode
  storageKey: string
  defaultSize?: number
  minSize?: number
  maxSize?: number
  label: string
  className?: string
  firstOnly?: boolean
  secondOnly?: boolean
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [size, setSize] = React.useState(() => readStored(storageKey, defaultSize))
  const [dragging, setDragging] = React.useState(false)

  // `vertical` means the divider is a vertical line, i.e. the panes sit side
  // by side. This matches the ARIA meaning of aria-orientation on a separator.
  const sideBySide = orientation === "vertical"

  React.useEffect(() => {
    window.localStorage.setItem(storageKey, String(size))
  }, [size, storageKey])

  const applyFromPointer = React.useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const raw = sideBySide
        ? ((clientX - rect.left) / rect.width) * 100
        : ((clientY - rect.top) / rect.height) * 100
      setSize(clamp(raw, minSize, maxSize))
    },
    [maxSize, minSize, sideBySide],
  )

  React.useEffect(() => {
    if (!dragging) return

    function onMove(event: PointerEvent) {
      event.preventDefault()
      applyFromPointer(event.clientX, event.clientY)
    }
    function onUp() {
      setDragging(false)
    }

    // Listening on the window, not the handle, is what lets the pointer leave
    // the 11px strip mid-drag without the split sticking.
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    document.body.dataset.opsResizing = orientation
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      delete document.body.dataset.opsResizing
    }
  }, [applyFromPointer, dragging, orientation])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    const decrease = sideBySide ? "ArrowLeft" : "ArrowUp"
    const increase = sideBySide ? "ArrowRight" : "ArrowDown"

    if (event.key === decrease) {
      event.preventDefault()
      setSize((current) => clamp(current - step, minSize, maxSize))
    } else if (event.key === increase) {
      event.preventDefault()
      setSize((current) => clamp(current + step, minSize, maxSize))
    } else if (event.key === "Home") {
      event.preventDefault()
      setSize(minSize)
    } else if (event.key === "End") {
      event.preventDefault()
      setSize(maxSize)
    } else if (event.key === "Enter") {
      event.preventDefault()
      setSize(defaultSize)
    }
  }

  // One pane minimised means there is nothing to divide. Render the survivor
  // full-bleed rather than a split pinned at its minimum, so a collapsed pane
  // actually gives its space away.
  if (firstOnly || secondOnly) {
    return (
      <div className={cn("flex min-h-0 min-w-0", className)}>
        <div className="flex min-h-0 min-w-0 flex-1">{firstOnly ? first : second}</div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0", sideBySide ? "flex-row" : "flex-col", className)}
    >
      <div
        className="flex min-h-0 min-w-0"
        style={sideBySide ? { width: `${size}%` } : { height: `${size}%` }}
      >
        {first}
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-label={label}
        aria-orientation={orientation}
        aria-valuenow={Math.round(size)}
        aria-valuemin={Math.round(minSize)}
        aria-valuemax={Math.round(maxSize)}
        data-orientation={orientation}
        data-dragging={dragging || undefined}
        className="ops-resizer"
        onPointerDown={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDoubleClick={() => setSize(defaultSize)}
        onKeyDown={onKeyDown}
      />

      <div className="flex min-h-0 min-w-0 flex-1">{second}</div>
    </div>
  )
}
