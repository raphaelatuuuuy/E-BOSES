// apps/web/src/features/landing/scenes/problem.tsx
import { Fragment, useRef } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

import { MM } from "../landing-theme"
import { ProblemLogbook } from "./problem-logbook"

const PAIN_POINTS = [
  ["Paper records", "Reports can be difficult to find, review, and track over time."],
  ["No visible progress", "Residents must call or return to the hall to ask for an update."],
  ["Limited access", "Older adults, people with disabilities, and working residents cannot always visit in person."],
  ["Missing locations", "Calls and radio messages may not include the exact location responders need."],
] as const

const BLUEPRINT_GRID =
  "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 56px), repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 56px)"

const BLUEPRINT_MASK = "radial-gradient(ellipse 110% 85% at 50% 40%, black 45%, transparent 100%)"

export function Problem() {
  const root = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()

      const animate = () => {
        // Word-by-word color scrub on the pain points.
        gsap.utils.toArray<HTMLElement>(".problem-line", root.current).forEach((line) => {
          gsap.fromTo(
            line.querySelectorAll(".problem-word"),
            { color: "rgba(245,242,236,0.18)" },
            {
              color: "rgba(245,242,236,1)",
              stagger: 0.08,
              ease: "none",
              scrollTrigger: { trigger: line, start: "top 75%", end: "top 35%", scrub: true },
            },
          )
        })

        // Ghost word parallax.
        gsap.to(".problem-ghost-a", {
          yPercent: -25,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true },
        })
        gsap.to(".problem-ghost-b", {
          yPercent: 20,
          ease: "none",
          scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true },
        })

        // Folder logbook: strokes draw in once it scrolls into view.
        const strokes = gsap.utils.toArray<SVGGeometryElement>(".logbook-stroke", root.current)
        if (strokes.length > 0) {
          strokes.forEach((el) => {
            const len = typeof el.getTotalLength === "function" ? el.getTotalLength() : 600
            gsap.set(el, { strokeDasharray: len, strokeDashoffset: len })
          })
          gsap
            .timeline({
              scrollTrigger: {
                trigger: ".problem-logbook",
                start: "top 80%",
                toggleActions: "play none none reverse",
              },
            })
            .to(strokes, { strokeDashoffset: 0, duration: 1.2, ease: "power2.out", stagger: 0.045 })
            .from(".logbook-caption", { opacity: 0, duration: 0.6, ease: "none" }, "-=0.7")
            .from(".problem-slip", { opacity: 0, y: 18, duration: 0.7, ease: "power2.out", stagger: 0.12 }, "-=0.8")
        }

        // Gentle floating drift on the slips (transform wrapper, so it never
        // fights the intro tween on .problem-slip).
        gsap.utils.toArray<HTMLElement>(".problem-slip-drift", root.current).forEach((el, i) => {
          gsap.to(el, {
            y: i % 2 === 0 ? -7 : 7,
            duration: 2.8 + i * 0.6,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          })
        })

        // Slight scroll parallax on the whole logbook.
        gsap.to(".problem-logbook-inner", {
          y: -26,
          ease: "none",
          scrollTrigger: { trigger: ".problem-logbook", start: "top bottom", end: "bottom top", scrub: true },
        })
      }

      mm.add(MM.desktop, animate)
      mm.add(MM.mobile, animate)
      mm.add(MM.reduced, () => {
        // Fully visible static state: words at full ink, folder drawn, slips at rest.
        gsap.set([".problem-word", ".logbook-caption", ".problem-slip", ".problem-slip-drift"], { clearProps: "all" })
      })

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} id="about" className="relative scroll-mt-24 overflow-hidden px-5 py-28 md:px-10 md:py-40">
      {/* Blueprint grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: BLUEPRINT_GRID,
          WebkitMaskImage: BLUEPRINT_MASK,
          maskImage: BLUEPRINT_MASK,
        }}
      />

      {/* Ghosted parallax words */}
      <span
        aria-hidden
        className="problem-ghost-a pointer-events-none absolute -left-6 top-16 font-heading text-[22vw] font-bold leading-none text-white/[0.03]"
      >
        Logbook
      </span>
      <span
        aria-hidden
        className="problem-ghost-b pointer-events-none absolute -right-8 bottom-10 font-heading text-[22vw] font-bold leading-none text-white/[0.03]"
      >
        Hotline
      </span>

      <div className="relative mx-auto max-w-6xl">
        <h2 className="max-w-4xl font-heading text-[clamp(2rem,5.5vw,4rem)] font-bold leading-tight">
          Today, a concern travels by foot, by phone, by paper. And too often, it goes quiet.
        </h2>

        <div className="mt-16 grid items-center gap-16 md:mt-20 md:grid-cols-[1.1fr_0.9fr] md:gap-12 lg:gap-20">
          <div className="space-y-14 md:space-y-16">
            {PAIN_POINTS.map(([title, body], i) => (
              <div key={title} className="problem-line">
                <div className="flex items-baseline gap-5">
                  <span className="font-mono text-sm text-[#ff5003]">0{i + 1}</span>
                  <h3 className="font-heading text-[clamp(1.6rem,4.5vw,3rem)] font-bold leading-[1.05]">
                    {title.split(" ").map((w, j) => (
                      <Fragment key={j}>
                        <span className="problem-word inline-block text-[#f5f2ec]">{w}</span>{" "}
                      </Fragment>
                    ))}
                  </h3>
                </div>
                <p className="mt-3 max-w-2xl pl-10 text-base leading-relaxed text-white/50 md:pl-12 md:text-lg">
                  {body}
                </p>
              </div>
            ))}
          </div>

          <ProblemLogbook />
        </div>
      </div>
    </section>
  )
}
