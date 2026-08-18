// apps/web/src/features/landing/scenes/alarm-map-2d.tsx
import { useEffect, useRef, type MutableRefObject } from "react"

import { prefersReducedMotion } from "../landing-theme"

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1)

/** Incident point, % of the map box, hand-tuned to sit inside the boundary. */
const INCIDENT = { left: "46%", top: "38%" }

/** Blue responder positions revealed by the beat 2 radar sweep. */
const RESPONDERS: ReadonlyArray<{ left: string; top: string; label?: string }> = [
  { left: "63%", top: "58%", label: "RESPONDER" },
  { left: "36%", top: "50%", label: "RESPONDER" },
  { left: "55%", top: "29%", label: "RESPONDER" },
  { left: "48%", top: "63%", label: "RESPONDER" },
]

/** Green neighbor positions inside the beat 3 awareness radius. */
const NEIGHBORS: ReadonlyArray<{ left: string; top: string }> = [
  { left: "40%", top: "31%" },
  { left: "53%", top: "33%" },
  { left: "38%", top: "44%" },
  { left: "52%", top: "46%" },
  { left: "46%", top: "26%" },
  { left: "58%", top: "40%" },
]

/** 2D glowing map fallback: the boundary SVG with CSS glow + beat-synced
 *  dispatch overlays (SOS pulse, radar sweep + responders, neighbor radius).
 *  The 3D mode renders its own in-scene beat graphics on the map surface. */
export function AlarmMap2D({ progress }: { progress: MutableRefObject<number> }) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const reduced = prefersReducedMotion()
    const sos = el.querySelector<HTMLElement>(".am-sos")
    const pulses = Array.from(el.querySelectorAll<HTMLElement>(".am-pulse"))
    const sweep = el.querySelector<HTMLElement>(".am-sweep")
    const responders = Array.from(el.querySelectorAll<HTMLElement>(".am-resp"))
    const glow = el.querySelector<HTMLElement>(".am-nb-glow")
    const neighbors = Array.from(el.querySelectorAll<HTMLElement>(".am-nb"))
    let raf = 0

    const tick = (now: number) => {
      const p = progress.current
      const beat1 = clamp01(p / 0.33)
      const beat2 = clamp01((p - 0.33) / 0.33)
      const beat3 = clamp01((p - 0.66) / 0.34)

      // Beat 1: red SOS core with continuously expanding pulse rings
      const sosIn = clamp01(beat1 * 3)
      if (sos) {
        sos.style.opacity = String(sosIn)
        sos.style.transform = `translate(-50%,-50%) scale(${0.6 + sosIn * 0.4})`
      }
      const pulseStrength = sosIn * (1 - beat2 * 0.75)
      pulses.forEach((ring, k) => {
        if (reduced) {
          // Static final state: one faint fixed ring, no looping pulse
          ring.style.opacity = k === 0 ? "0.25" : "0"
          ring.style.transform = "translate(-50%,-50%) scale(1)"
          return
        }
        const phase = (now / 1600 + k / pulses.length) % 1
        ring.style.opacity = String((1 - phase) * 0.55 * pulseStrength)
        ring.style.transform = `translate(-50%,-50%) scale(${0.25 + phase * 1.45})`
      })

      // Beat 2: rotating radar sweep; responder dots flicker in as it passes
      if (sweep) {
        if (reduced) {
          sweep.style.opacity = "0"
        } else {
          const sweepOn = clamp01(beat2 * 5) * (1 - clamp01(beat3 * 2.5))
          sweep.style.opacity = String(sweepOn * 0.75)
          sweep.style.transform = `translate(-50%,-50%) rotate(${(now / 9) % 360}deg)`
        }
      }
      responders.forEach((dot, i) => {
        const f = clamp01((beat2 - (0.12 + i * 0.2)) / 0.1)
        const flicker =
          !reduced && f > 0 && f < 1 ? 0.45 + 0.55 * Math.abs(Math.sin(now / 32)) : 1
        dot.style.opacity = String(f * flicker)
      })

      // Beat 3: soft green awareness radius + staggered neighbor dots
      if (glow) {
        glow.style.opacity = String(beat3 * 0.85)
        glow.style.transform = `translate(-50%,-50%) scale(${0.7 + beat3 * 0.3})`
      }
      neighbors.forEach((dot, i) => {
        const f = clamp01((beat3 - (0.12 + i * 0.13)) / 0.12)
        dot.style.opacity = String(f * 0.95)
        dot.style.transform = `translate(-50%,-50%) scale(${0.6 + f * 0.4})`
      })

      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [progress])

  return (
    <div ref={rootRef} className="relative aspect-square w-full max-w-xl overflow-clip">
      <img
        src="/contents/marikina-heights.svg"
        alt=""
        aria-hidden
        className="h-full w-full object-contain opacity-90"
        style={{
          filter:
            "invert(42%) sepia(94%) saturate(2850%) hue-rotate(355deg) drop-shadow(0 0 14px rgba(255,80,3,0.45))",
        }}
      />

      <div aria-hidden className="pointer-events-none absolute inset-0">
        {/* Beat 1: emergency pulse rings around the incident */}
        {[0, 1, 2].map((k) => (
          <span
            key={k}
            className="am-pulse absolute aspect-square w-[16%] rounded-full border border-sos/70 opacity-0"
            style={{ ...INCIDENT, transform: "translate(-50%,-50%)" }}
          />
        ))}
        {/* Beat 1: red SOS core */}
        <span
          className="am-sos absolute size-3 rounded-full bg-sos opacity-0 shadow-[0_0_16px_rgba(255,59,48,0.95),0_0_36px_rgba(255,59,48,0.5)]"
          style={{ ...INCIDENT, transform: "translate(-50%,-50%)" }}
        />

        {/* Beat 2: rotating radar sweep wedge centered on the incident */}
        <span
          className="am-sweep absolute aspect-square w-[64%] rounded-full opacity-0"
          style={{
            ...INCIDENT,
            transform: "translate(-50%,-50%)",
            background:
              "conic-gradient(from 0deg, rgba(77,163,255,0.35) 0deg, rgba(77,163,255,0.05) 55deg, transparent 62deg)",
          }}
        />
        {/* Beat 2: blue responder dots with mono role chips */}
        {RESPONDERS.map(({ left, top, label }) => (
          <span
            key={`${left}${top}`}
            className="am-resp absolute -translate-x-1/2 -translate-y-1/2 opacity-0"
            style={{ left, top }}
          >
            <span className="block size-2 rounded-full bg-landing-sky shadow-[0_0_10px_rgba(77,163,255,0.85)]" />
            {label && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.2em] text-landing-sky/80">
                {label}
              </span>
            )}
          </span>
        ))}

        {/* Beat 3: soft green awareness radius (blurred radial, no hard ring) */}
        <span
          className="am-nb-glow absolute aspect-square w-[58%] rounded-full opacity-0 blur-xl"
          style={{
            ...INCIDENT,
            transform: "translate(-50%,-50%)",
            background:
              "radial-gradient(circle, rgba(55,214,122,0.22) 0%, rgba(55,214,122,0.08) 45%, transparent 70%)",
          }}
        />
        {/* Beat 3: green neighbor dots */}
        {NEIGHBORS.map(({ left, top }) => (
          <span
            key={`${left}${top}`}
            className="am-nb absolute size-1.5 rounded-full bg-emerald-400 opacity-0 shadow-[0_0_8px_rgba(55,214,122,0.8)]"
            style={{ left, top, transform: "translate(-50%,-50%)" }}
          />
        ))}
      </div>
    </div>
  )
}