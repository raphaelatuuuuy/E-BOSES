import { useCallback, useEffect, useMemo, useState } from "react"

type Slide = {
  image: string
  headline: string
}

const SLIDES: Slide[] = [
  {
    image: "/contents/feature-1.webp",
    headline: "Report issues in seconds",
  },
  {
    image: "/contents/feature-3.webp",
    headline: "Send emergency alerts instantly",
  },
  {
    image: "/contents/feature-2.webp",
    headline: "Track resolution progress",
  },
  {
    image: "/contents/feature-4.webp",
    headline: "Stay connected with your community",
  },
] as const

export function useAuthPanelRotation() {
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => {
    setCurrent((prev) => (prev + 1) % SLIDES.length)
  }, [])

  useEffect(() => {
    const timer = setInterval(next, 5_000)
    return () => clearInterval(timer)
  }, [next])

  const slide = SLIDES[current]
  const total = SLIDES.length

  return useMemo(() => ({ slide, total, current, next }), [slide, total, current, next])
}
