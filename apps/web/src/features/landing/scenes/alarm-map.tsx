// apps/web/src/features/landing/scenes/alarm-map.tsx
import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

import { MM, prefersReducedMotion } from "../landing-theme"
import { AlarmMap2D } from "./alarm-map-2d"

// The 3D scene pulls in three.js (~900 kB before gzip). It is only mounted
// once the map section gets near the viewport (see mapNear3D below), so the
// chunk is not downloaded while the user is still reading the hero / problem
// sections. The 2D fallback stays on screen until the chunk is ready.
const AlarmMap3D = lazy(() => import("./alarm-map-3d"))

const BEATS = [
  ["Send the alert", "One large button. Your GPS location attaches automatically."],
  ["Responders see your exact location", "Tanods, health workers, or the disaster response team get the alert routed to their role."],
  ["Neighbors nearby are notified", "Residents inside the alert radius get a heads-up for awareness while responders are on the way."],
] as const

class MapErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function AlarmMap() {
  const root = useRef<HTMLElement | null>(null)
  const pinArea = useRef<HTMLDivElement | null>(null)
  const progress = useRef(0)
  const reduced = prefersReducedMotion()
  const use3D = !reduced

  // Defer the three.js chunk until the pinned map area is within ~1.5 viewport
  // heights below the screen. Stops the browser downloading ~244 kB gzip for a
  // scene the visitor may never scroll to. When IntersectionObserver is
  // unavailable the map is treated as "already near" so 3D still works.
  const [mapNear3D, setMapNear3D] = useState(
    () => typeof IntersectionObserver === "undefined",
  )

  useEffect(() => {
    if (!use3D || mapNear3D) return
    const target = pinArea.current
    if (!target) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMapNear3D(true)
          observer.disconnect()
        }
      },
      // 1.5 viewport heights of lead time: the SVG is usually in cache, and the
      // 2D fallback covers the brief fetch window after the pin releases.
      { rootMargin: "0px 0px 150% 0px", threshold: 0 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [use3D, mapNear3D])

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      const build = (pinDistance: number) => {
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: pinArea.current,
            start: "top top",
            end: `+=${pinDistance}`,
            pin: true,
            scrub: 0.5,
            onUpdate: (self) => {
              progress.current = self.progress
            },
          },
        })
        // One beat at a time: each slides in from the left at the start of its
        // third of the pin, holds, then slides out toward the right as the
        // next beat arrives. Total timeline duration = 3 (one unit per third).
        const beats = gsap.utils.toArray<HTMLElement>(".am-beat")
        beats.forEach((beat, i) => {
          tl.fromTo(beat, { autoAlpha: 0, x: -28 }, { autoAlpha: 1, x: 0, duration: 0.28 }, i)
          if (i < beats.length - 1) tl.to(beat, { autoAlpha: 0, x: 28, duration: 0.28 }, i + 0.92)
        })
        // Hold the last beat visible until the pin releases
        tl.to({}, { duration: 0.72 }, 2.28)
      }
      mm.add(MM.desktop, () => void build(2200))
      mm.add(MM.mobile, () => void build(1400))
      mm.add(MM.reduced, () => {
        progress.current = 1 // fallback shows the final state
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} id="contact" className="relative scroll-mt-24 overflow-hidden bg-landing-bg/40 px-5 md:px-10">
      {/* Pinned viewport-fit area: headline, one-at-a-time beats, and the map.
          The hotline block lives BELOW this wrapper so it never pushes the map
          or beat copy off-screen while pinned; it scrolls in normally once the
          pin releases. */}
      <div
        ref={pinArea}
        className="mx-auto grid min-h-svh max-w-7xl content-center gap-8 py-4 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-12"
      >
        <div className="min-w-0">
          <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.3em] text-accent">
            When seconds matter
          </p>
          <h2 className="font-heading text-[clamp(2rem,5vw,3.75rem)] font-bold leading-tight">
            One alarm.<br />The whole barangay hears it.
          </h2>
          {/* Motion mode stacks all beats in one grid cell (sized by the
              tallest) so they swap in place without layout jumps; reduced
              motion shows all three statically in normal flow. */}
          <ol className={reduced ? "mt-6 space-y-8 lg:mt-10" : "mt-6 grid lg:mt-10"}>
            {BEATS.map(([title, body], i) => (
              <li key={title} className={reduced ? "am-beat" : "am-beat col-start-1 row-start-1"}>
                <span className="font-mono text-xs uppercase tracking-[0.25em] text-primary">0{i + 1}</span>
                <h3 className="mt-1 font-heading text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight text-landing-cream">
                  {title}
                </h3>
                <p className="mt-2 max-w-md leading-relaxed text-white/60">{body}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* Map box: centered square that always fits the phone viewport width
            (88vw) minus paddings, clamped by viewport HEIGHT too so the pinned
            grid fits short viewports. No overflow-clip: the canvas is sized to
            this box, so nothing may cut it on the sides or bottom. */}
        <div className="relative mx-auto flex aspect-square w-full min-w-0 max-w-[min(96vw,32rem,56svh)] items-center justify-center lg:max-w-[min(48rem,84svh)]">
          {use3D && mapNear3D ? (
            <MapErrorBoundary fallback={<AlarmMap2D progress={progress} />}>
              <Suspense fallback={<AlarmMap2D progress={progress} />}>
                <AlarmMap3D progress={progress} />
              </Suspense>
            </MapErrorBoundary>
          ) : (
            <AlarmMap2D progress={progress} />
          )}
        </div>
      </div>
    </section>
  )
}