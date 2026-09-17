// apps/web/src/features/landing/scenes/join.tsx
import { useRef } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

import { ParticleField } from "../components/particle-field"
import { MM } from "../landing-theme"

export function Join() {
  const root = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()

      const build = () => {
        const rootEl = root.current
        if (!rootEl) return

        gsap.from(".join-copy > *", {
          y: 28,
          opacity: 0,
          stagger: 0.1,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: { trigger: rootEl, start: "top 65%" },
        })
      }

      mm.add(MM.desktop, build)
      mm.add(MM.mobile, build)
      mm.add(MM.reduced, () => {
        // Static, fully visible state: no entrance motion.
        gsap.set(".join-copy > *", { opacity: 1, y: 0 })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section ref={root} className="relative overflow-hidden pb-24 pt-8 md:pb-32 md:pt-12">
      <ParticleField count={80} className="opacity-70" />

      <div className="join-copy relative z-10 mx-auto flex max-w-4xl flex-col items-center px-5 text-center md:px-10">
        <h2 className="relative z-10 font-heading text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-[1.05] tracking-[-0.02em] text-landing-cream">
          Be the{" "}
          <span className="bg-linear-to-r from-accent to-primary bg-clip-text text-transparent">
            Voice
          </span>{" "}
          that
          <br />
          Drives{" "}
          <span className="bg-linear-to-r from-accent to-primary bg-clip-text text-transparent">
            Change
          </span>
          .
        </h2>
        <div
          aria-hidden
          className="pointer-events-none relative z-0 mt-4 w-[min(34vw,720px)] max-w-none select-none md:mt-6"
          style={{ aspectRatio: "4764 / 5008" }}
        >
          <img
            src="/contents/IMG_3092.webp"
            alt=""
            className="absolute inset-0 h-full w-full select-none"
            style={{ transform: "translateX(-6%)" }}
          />
        </div>
      </div>
    </section>
  )
}