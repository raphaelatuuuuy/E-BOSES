import { useEffect, useRef } from "react"

/**
 * Turns a vertical wheel into sideways scrolling.
 *
 * A row that only scrolls horizontally is unreachable with a normal mouse — the
 * wheel scrolls the page behind it and the filters never move. Registered
 * natively because React's onWheel is passive, so it cannot preventDefault.
 */
export function useWheelScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    function onWheel(event: WheelEvent) {
      const el = ref.current
      if (!el) return
      // Trackpads already send deltaX; leave those alone.
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
      const maxScroll = el.scrollWidth - el.clientWidth
      if (maxScroll <= 0) return
      const next = Math.min(maxScroll, Math.max(0, el.scrollLeft + event.deltaY))
      if (next === el.scrollLeft) return
      el.scrollLeft = next
      event.preventDefault()
    }

    node.addEventListener("wheel", onWheel, { passive: false })
    return () => node.removeEventListener("wheel", onWheel)
  }, [])

  return ref
}
