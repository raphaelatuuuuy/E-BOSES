// apps/web/src/features/landing/components/particle-field.tsx
import { useEffect, useRef } from "react"

import { prefersReducedMotion } from "../landing-theme"

type Particle = {
  x: number
  y: number
  r: number
  vy: number
  sway: number
  phase: number
  orange: boolean
  alpha: number
}

export function ParticleField({
  count = 150,
  className = "",
}: {
  count?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || prefersReducedMotion()) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf = 0
    let running = true
    let particles: Particle[] = []
    let width = 0
    let height = 0

    const seed = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 0.6 + Math.random() * 1.4,
        vy: 0.06 + Math.random() * 0.18,
        sway: 8 + Math.random() * 18,
        phase: Math.random() * Math.PI * 2,
        orange: Math.random() < 0.14,
        alpha: 0.15 + Math.random() * 0.5,
      }))
    }

    const tick = (t: number) => {
      if (!running) return
      ctx.clearRect(0, 0, width, height)
      for (const p of particles) {
        p.y -= p.vy
        if (p.y < -4) p.y = height + 4
        const x = p.x + Math.sin(t / 4000 + p.phase) * p.sway
        ctx.beginPath()
        ctx.arc(x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.orange
          ? `rgba(255, 80, 3, ${p.alpha})`
          : `rgba(245, 242, 236, ${p.alpha * 0.7})`
        ctx.fill()
      }
      raf = window.requestAnimationFrame(tick)
    }

    const start = () => {
      if (running) return
      running = true
      raf = window.requestAnimationFrame(tick)
    }
    const stop = () => {
      running = false
      window.cancelAnimationFrame(raf)
    }

    seed()
    raf = window.requestAnimationFrame(tick)

    const io = new IntersectionObserver(([entry]) =>
      entry.isIntersecting ? start() : stop(),
    )
    io.observe(canvas)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("resize", seed)

    return () => {
      stop()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("resize", seed)
    }
  }, [count])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  )
}
