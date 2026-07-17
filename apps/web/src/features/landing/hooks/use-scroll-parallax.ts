import { useEffect, useState } from "react"

/**
 * Returns a scroll-driven Y offset at a given speed factor.
 * speed = 0  → static (no movement)
 * speed = 0.25 → moves ¼ of scroll distance (parallax mid-ground)
 * speed = 1   → normal scroll (foreground)
 */
export function useScrollParallax(speed: number): number {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    let ticking = false

    const onScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          setOffset(window.scrollY * speed)
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [speed])

  return offset
}
