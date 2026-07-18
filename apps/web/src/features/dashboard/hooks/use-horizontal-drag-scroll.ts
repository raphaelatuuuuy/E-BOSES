import * as React from "react"

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      "button, a, input, select, textarea, label, [role='button'], [role='tab'], [data-filter-option], [data-no-drag]",
    ),
  )
}

/**
 * Horizontal drag-to-scroll for mouse. Skips drag start on interactive
 * children so filter chips / buttons still receive normal clicks.
 */
export function useHorizontalDragScroll<T extends HTMLElement>() {
  const drag = React.useRef({ active: false, moved: false, startX: 0, scrollLeft: 0 })

  return {
    onPointerDown(event: React.PointerEvent<T>) {
      if (event.pointerType === "mouse" && event.button !== 0) return
      // Never capture pointer when the user is pressing a control — that
      // swallows click and makes filter chips feel “dead”.
      if (isInteractiveTarget(event.target)) return

      drag.current = {
        active: true,
        moved: false,
        startX: event.clientX,
        scrollLeft: event.currentTarget.scrollLeft,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMove(event: React.PointerEvent<T>) {
      if (!drag.current.active) return
      const delta = event.clientX - drag.current.startX
      if (Math.abs(delta) > 6) drag.current.moved = true
      if (drag.current.moved) {
        event.currentTarget.scrollLeft = drag.current.scrollLeft - delta
      }
    },
    onPointerUp(event: React.PointerEvent<T>) {
      if (!drag.current.active) return
      drag.current.active = false
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      } catch {
        /* already released */
      }
      // Keep `moved` until click capture so a completed drag still suppresses click.
      // If there was no drag, clear so a later click is never blocked.
      if (!drag.current.moved) {
        drag.current.moved = false
      }
    },
    onPointerCancel(event: React.PointerEvent<T>) {
      drag.current.active = false
      drag.current.moved = false
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      } catch {
        /* already released */
      }
    },
    onClickCapture(event: React.MouseEvent<T>) {
      if (!drag.current.moved) return
      drag.current.moved = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
