import * as React from "react"

export function useHorizontalDragScroll<T extends HTMLElement>() {
  const drag = React.useRef({ active: false, moved: false, startX: 0, scrollLeft: 0 })

  return {
    onPointerDown(event: React.PointerEvent<T>) {
      if (event.pointerType === "mouse" && event.button !== 0) return
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
      if (Math.abs(delta) > 3) drag.current.moved = true
      event.currentTarget.scrollLeft = drag.current.scrollLeft - delta
    },
    onPointerUp(event: React.PointerEvent<T>) {
      drag.current.active = false
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    },
    onPointerCancel(event: React.PointerEvent<T>) {
      drag.current.active = false
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    },
    onClickCapture(event: React.MouseEvent<T>) {
      if (!drag.current.moved) return
      drag.current.moved = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
