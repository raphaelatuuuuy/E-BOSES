import { useCallback, useEffect, useMemo, useState } from "react"

type Slide = {
  image: string
  headline: string
  description: string
}

const SLIDES: Slide[] = [
  {
    image: "/contents/feature-1.png",
    headline: "Report issues in seconds",
    description: "Snap a photo, pin the location, and let your barangay know.",
  },
  {
    image: "/contents/feature-3.png",
    headline: "Track resolution progress",
    description: "Follow your report from submission to resolution with real-time updates.",
  },
  {
    image: "/contents/feature-2.png",
    headline: "Emergency alerts, instantly",
    description: "Send GPS-tagged alerts to first responders when you need help fast.",
  },
  {
    image: "/contents/feature-4.png",
    headline: "Stay connected with your community",
    description: "Get notified about barangay events, announcements, and nearby concerns.",
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
