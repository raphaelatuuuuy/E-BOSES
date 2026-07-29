// apps/web/src/features/landing/scenes/join.tsx
import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
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
    <section ref={root} className="relative overflow-hidden py-32 md:py-44">
      <ParticleField count={80} className="opacity-70" />

      <div className="join-copy relative z-10 mx-auto max-w-4xl px-5 text-center md:px-10">
        <h2 className="font-heading text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[#f5f2ec]">
          Be the{" "}
          <span className="bg-linear-to-r from-[#ff5003] to-[#ff8133] bg-clip-text text-transparent">
            Voice
          </span>{" "}
          that
          <br />
          Drives{" "}
          <span className="bg-linear-to-r from-[#ff5003] to-[#ff8133] bg-clip-text text-transparent">
            Change
          </span>
          .
        </h2>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-5">
          <Link
            to="/sign-up"
            className="inline-flex min-h-13 items-center gap-3 bg-[#ff5003] px-8 text-lg font-semibold text-white transition-colors hover:bg-[#d94300] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Get started <ArrowRight aria-hidden className="size-5" />
          </Link>
        </div>
      </div>
    </section>
  )
}
