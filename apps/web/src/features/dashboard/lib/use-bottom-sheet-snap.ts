import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

export type SheetMode = "expanded" | "peek" | "hidden"

export function useBottomSheetSnap({
  enabled = true,
  initialMode = "expanded",
  initialHeight,
  onSettle,
}: {
  enabled?: boolean
  initialMode?: SheetMode
  initialHeight?: number
  onSettle?: () => void
} = {}) {
  const snaps = useCallback(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    return {
      hidden: 56,
      peek: Math.round(Math.min(268, vh * 0.34)),
      expanded: Math.round(Math.min(vh * 0.58, 560)),
      max: Math.round(Math.min(vh * 0.88, 720)),
    }
  }, [])
  const [mode, setMode] = useState<SheetMode>(initialMode)
  const [height, setHeight] = useState(() => {
    if (typeof initialHeight === "number") return initialHeight
    const s = snaps()
    return initialMode === "peek" ? s.peek : initialMode === "hidden" ? s.hidden : s.expanded
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startH: number; pointerId: number } | null>(null)
  const settleRef = useRef(onSettle)
  useEffect(() => {
    settleRef.current = onSettle
  })

  const snapTo = useCallback(
    (next: SheetMode) => {
      const s = snaps()
      setMode(next)
      setHeight(next === "expanded" ? s.expanded : next === "peek" ? s.peek : s.hidden)
      window.requestAnimationFrame(() => settleRef.current?.())
    },
    [snaps],
  )

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { startY: event.clientY, startH: height, pointerId: event.pointerId }
      setDragging(true)
    },
    [enabled, height],
  )

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const s = snaps()
      setHeight(Math.min(s.max, Math.max(s.hidden, drag.startH + (drag.startY - event.clientY))))
    },
    [snaps],
  )

  const onHandlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* already released */
      }
      dragRef.current = null
      setDragging(false)

      const s = snaps()
      const h = Math.min(s.max, Math.max(s.hidden, drag.startH + (drag.startY - event.clientY)))
      if (h > (s.expanded + s.max) / 2) {
        setMode("expanded")
        setHeight(s.max)
        window.requestAnimationFrame(() => settleRef.current?.())
        return
      }
      const targets: Array<{ mode: SheetMode; h: number }> = [
        { mode: "hidden", h: s.hidden },
        { mode: "peek", h: s.peek },
        { mode: "expanded", h: s.expanded },
      ]
      let best = targets[0]!
      for (const target of targets) {
        if (Math.abs(h - target.h) < Math.abs(h - best.h)) best = target
      }
      snapTo(best.mode)
    },
    [snapTo, snaps],
  )

  return { snaps, mode, height, dragging, snapTo, onHandlePointerDown, onHandlePointerMove, onHandlePointerUp }
}
