import { useEffect, useRef, useState } from "react"

import { PlaceholderImage } from "./placeholder-image"

const SLIDES = [
  "Barangay Hall",
  "Tanod Patrol",
  "Health Workers",
  "Community",
  "Road Works",
  "Clean-Up Drive",
  "Evacuation Drill",
  "Assembly",
]

export function PhotoMarquee() {
  const track = [...SLIDES, ...SLIDES]
  const sectionRef = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(true)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "100px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const running = inView && !hovered

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-[#020c4e] py-8 md:py-12"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -top-1 z-20 h-[110px] bg-[#020c4e] md:h-[150px]"
        style={{ borderRadius: "0 0 50% 50% / 0 0 50% 50%" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-1 z-20 h-[110px] bg-gray-50 md:h-[150px]"
        style={{ borderRadius: "50% 50% 0 0 / 50% 50% 0 0" }}
      />
      <div
        className="flex w-max animate-marquee gap-px"
        style={{ animationPlayState: running ? "running" : "paused" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {track.map((label, i) => (
          <div
            key={`${label}-${i}`}
            className="relative h-[380px] w-[140px] shrink-0 overflow-hidden bg-gray-100 sm:h-[460px] sm:w-[180px] md:h-[560px] md:w-[220px]"
          >
            <PlaceholderImage tone="dark" label={label} />
          </div>
        ))}
      </div>
    </section>
  )
}
