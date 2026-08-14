// apps/web/src/features/landing/scenes/join.tsx
import { Link } from "react-router-dom"
import { ArrowRightIcon } from "lucide-react"
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
        <div className="relative z-10 mt-9 flex flex-wrap items-center justify-center gap-5">
          <Link
            to="/sign-up"
            className="relative z-10 inline-flex min-h-13 items-center gap-3 rounded-full bg-accent px-8 text-lg font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-orange-strong hover:shadow-[0_4px_16px_rgba(255,80,3,0.45)] active:translate-y-0 active:shadow-[0_4px_14px_rgba(255,80,3,0.35)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            Get started <ArrowRightIcon aria-hidden className="size-5" strokeWidth={1.5} />
          </Link>
        </div>
        <div
          aria-hidden
          className="pointer-events-none relative z-0 -mt-10 w-[min(34vw,720px)] max-w-none select-none md:-mt-14"
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