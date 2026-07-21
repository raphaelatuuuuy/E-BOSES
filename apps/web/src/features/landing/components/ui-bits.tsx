import { type ReactNode, useEffect, useRef, useState } from "react"
import { ArrowRight, ArrowUpRight } from "@phosphor-icons/react"

export const SECTION_PADDING = "py-20 md:py-28"

export function SectionBadge({
  icon,
  children,
  dark = false,
}: {
  icon?: ReactNode
  children: ReactNode
  dark?: boolean
}) {
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium mb-6 ${
        dark
          ? "bg-white/10 text-white/80 border border-white/10"
          : "bg-[#ff8133]/10 text-[#ff5003]"
      }`}
    >
      {icon}
      {children}
    </div>
  )
}

export function ArrowPillButton({
  children,
  className = "",
  size = "md",
}: {
  children: ReactNode
  className?: string
  size?: "md" | "lg"
}) {
  const circle = size === "lg" ? "size-10" : "size-8"
  return (
    <span
      className={`group relative inline-flex items-center justify-start whitespace-nowrap rounded-full bg-[#ff8133] font-medium text-white shadow-[#ff8133]/25 transition-transform duration-200 hover:scale-105 active:scale-95 ${
        size === "lg" ? "h-12 px-8 pr-14 text-base" : "h-9 px-4 pr-10 text-sm"
      } ${className}`}
    >
      {children}
      <span
        className={`absolute right-1 top-1/2 -translate-y-1/2 ${circle} overflow-hidden rounded-full bg-white`}
      >
        <span className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-out group-hover:-translate-y-full group-hover:translate-x-full">
          <ArrowRight className="size-4 text-[#ff5003]" />
        </span>
        <span className="absolute inset-0 flex -translate-x-full translate-y-full items-center justify-center transition-transform duration-500 ease-out group-hover:translate-x-0 group-hover:translate-y-0">
          <ArrowUpRight className="size-4 text-[#ff5003]" />
        </span>
      </span>
    </span>
  )
}

export function OutlinePillButton({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex h-12 items-center justify-center whitespace-nowrap rounded-full border border-gray-200 px-8 text-base font-medium text-gray-700 transition-transform duration-200 hover:scale-105 hover:bg-gray-50 active:scale-95 ${className}`}
    >
      {children}
    </span>
  )
}

export function Reveal({
  children,
  className = "",
  delay = 0,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: "div" | "section" | "span"
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  // Content is visible by default. JavaScript only marks it as observed; it never gates access.
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
          }
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  return (
    <Tag
      ref={ref as never}
      className={`transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  )
}

/* ------------------------------------------------------------------ *
 * Scroll manager: a single shared scroll/resize listener drives every
 * parallax element via one requestAnimationFrame. This avoids the jank
 * of dozens of independent scroll handlers each calling getBoundingClientRect.
 * ------------------------------------------------------------------ */

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  )
}

type ParallaxUpdater = (progress: number) => void

const parallaxSubscribers = new Set<ParallaxUpdater>()
let parallaxRaf = 0
let parallaxListening = false

function runParallax() {
  parallaxRaf = 0
  const viewportHeight = window.innerHeight
  for (const update of parallaxSubscribers) update(viewportHeight)
}

function scheduleParallax() {
  if (!parallaxRaf) parallaxRaf = window.requestAnimationFrame(runParallax)
}

function ensureParallaxListening() {
  if (parallaxListening) return
  parallaxListening = true
  window.addEventListener("scroll", scheduleParallax, { passive: true })
  window.addEventListener("resize", scheduleParallax)
}

function stopParallaxListening() {
  if (parallaxSubscribers.size || !parallaxListening) return
  parallaxListening = false
  window.removeEventListener("scroll", scheduleParallax)
  window.removeEventListener("resize", scheduleParallax)
  if (parallaxRaf) window.cancelAnimationFrame(parallaxRaf)
  parallaxRaf = 0
}

export function ParallaxText({
  children,
  className = "",
  speed = 1,
  fade = false,
  id,
  as: Tag = "div",
}: {
  children: ReactNode
  className?: string
  /** Vertical drift range in px is `40 * speed` (±). */
  speed?: number
  /** Also ease opacity in as the element enters the viewport. */
  fade?: boolean
  id?: string
  as?: "div" | "p" | "h2" | "h3" | "span"
}) {
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) return

    const update: ParallaxUpdater = (viewportHeight) => {
      const rect = el.getBoundingClientRect()
      const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height)
      const clamped = Math.max(0, Math.min(1, progress))
      const offset = (clamped - 0.5) * 80 * speed
      el.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`
      if (fade) {
        // Fade fully in over the first third of the entrance.
        el.style.opacity = String(Math.max(0, Math.min(1, clamped * 3)))
      }
    }

    parallaxSubscribers.add(update)
    ensureParallaxListening()
    update(window.innerHeight)

    return () => {
      parallaxSubscribers.delete(update)
      el.style.removeProperty("transform")
      el.style.removeProperty("opacity")
      stopParallaxListening()
    }
  }, [speed, fade])

  return (
    <Tag
      ref={ref as never}
      id={id}
      className={className}
      style={{ willChange: "transform, opacity" }}
    >
      {children}
    </Tag>
  )
}
