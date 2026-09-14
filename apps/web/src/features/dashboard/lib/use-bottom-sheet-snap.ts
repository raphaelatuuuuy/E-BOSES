import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

export type SheetMode = "max" | "expanded" | "peek" | "hidden"

export function useBottomSheetSnap({
  enabled = true,
  initialMode = "expanded",
  initialHeight,
  onSettle,
  maxH,
}: {
  enabled?: boolean
  initialMode?: SheetMode
  initialHeight?: number
  onSettle?: () => void
  maxH?: number | null
} = {}) {
  const snaps = useCallback(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    return {
      hidden: 56,
      peek: Math.round(Math.min(268, vh * 0.34)),
      expanded: Math.round(Math.min(vh * 0.58, 560)),
      max: Math.round(Math.min(vh * 0.8, 640)),
    }
  }, [])
  const [mode, setMode] = useState<SheetMode>(initialMode)
  const [height, setHeight] = useState(() => {
    if (typeof initialHeight === "number") return initialHeight
    const s = snaps()
    return initialMode === "max"
      ? s.max
      : initialMode === "peek"
        ? s.peek
        : initialMode === "hidden"
          ? s.hidden
          : s.expanded
  })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startY: number
    startH: number
    pointerId: number
  } | null>(null)
  const settleRef = useRef(onSettle)
  useEffect(() => {
    settleRef.current = onSettle
  })

  const snapTo = useCallback(
    (next: SheetMode) => {
      const s = snaps()
      const cap = (h: number) => (maxH != null ? Math.min(h, maxH) : h)
      setMode(next)
      setHeight(
        next === "max"
          ? cap(s.max)
          : next === "expanded"
            ? cap(s.expanded)
            : next === "peek"
              ? cap(s.peek)
              : cap(s.hidden)
      )
      window.requestAnimationFrame(() => settleRef.current?.())
    },
    [snaps, maxH]
  )

  useEffect(() => {
    if (maxH == null) return
    setHeight((prev) => (prev > maxH ? maxH : prev))
  }, [maxH])

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        startY: event.clientY,
        startH: height,
        pointerId: event.pointerId,
      }
      setDragging(true)
    },
    [enabled, height]
  )

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const s = snaps()
      const h = Math.min(
        s.max,
        Math.max(s.hidden, drag.startH + (drag.startY - event.clientY))
      )
      setHeight(maxH != null ? Math.min(h, maxH) : h)
    },
    [snaps, maxH]
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
      const raw = Math.min(
        s.max,
        Math.max(s.hidden, drag.startH + (drag.startY - event.clientY))
      )
      const h = maxH != null ? Math.min(raw, maxH) : raw
      if (Math.abs(h - height) < 32) {
        setHeight(h)
        window.requestAnimationFrame(() => settleRef.current?.())
        return
      }
      if (h > (s.expanded + s.max) / 2) {
        setMode("expanded")
        setHeight(maxH != null ? Math.min(s.max, maxH) : s.max)
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
    [snapTo, snaps, height, maxH]
  )

  return {
    snaps,
    mode,
    height,
    dragging,
    snapTo,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
  }
}
