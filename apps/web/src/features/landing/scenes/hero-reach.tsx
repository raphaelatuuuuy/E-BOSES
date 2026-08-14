// apps/web/src/features/landing/scenes/hero-reach.tsx
import { Fragment, useRef } from "react"
import { Link } from "react-router-dom"
import { ArrowRightIcon } from "lucide-react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

import { ParticleField } from "../components/particle-field"
import { MM } from "../landing-theme"

const HEADLINE = ["Ang", "bawat", "boses,", "naririnig."]

// Fingertip coordinates within each 1254² source image (measured from the art):
//   lefthand  index tip  -> x 95.5%, y 50.2%
//   righthand finger tip -> x 10.4%, y 56.9%
// The images are absolutely positioned so both fingertips land on the shared
// meeting point, `--meet` down from the wrapper top, with a hair of gap
// (0.3vw each side) that the central glow bridges, reading as "almost touching".
const L_TIP_X = 0.955
const L_TIP_Y = 0.502
const R_TIP_X = 0.104
const R_TIP_Y = 0.569

// Meeting x = 50% + MEET_SHIFT * var(--hand). Because the left tip sits 4.5%
// from its image's right edge but the right tip sits 10.4% from its image's
// left edge, centring the tips at 50% crops the two arms unequally. With the
// meeting x at M (vw) and hand width H (vw):
//   hidden left overhang  = 0.955H - M
//   hidden right overhang = M + (1 - 0.104)H - 100
// Equal overhang: 0.955H - M = M + 0.896H - 100  ->  M = 50 + 0.0295H
// (the +-0.3vw touch nudges cancel). So the meet shifts right 2.6vw at
// H=88vw, 2.2vw at 75vw, 1.6vw at 55vw; both arms are cropped by the same
// amount, so both wrists exit the viewport at visually matching heights.
const MEET_SHIFT = 0.0295

export function HeroReach() {
  const root = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()

      mm.add(MM.desktop, () => {
        entrance()
        scrollOut()
        return pointerParallax()
      })
      mm.add(MM.mobile, () => {
        entrance()
        scrollOut()
        ambientDrift()
      })
      // MM.reduced: no animation — everything is visible by default.

      function entrance() {
        gsap.from(".hero-hand-left", { xPercent: -12, opacity: 0, duration: 1.6, ease: "power3.out" })
        gsap.from(".hero-hand-right", { xPercent: 12, opacity: 0, duration: 1.6, ease: "power3.out", delay: 0.1 })
        gsap.from(".hero-word", { yPercent: 120, opacity: 0, duration: 0.9, stagger: 0.09, ease: "power3.out", delay: 0.35 })
        gsap.from(".hero-sub, .hero-ctas", { y: 24, opacity: 0, duration: 0.8, stagger: 0.12, ease: "power2.out", delay: 0.9 })
        gsap.to(".hero-glow", { scale: 1.3, opacity: 0.95, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1 })
      }

      function scrollOut() {
        gsap
          .timeline({
            scrollTrigger: { trigger: root.current, start: "top top", end: "bottom top", scrub: 0.6 },
          })
          .to(".hero-hand-left", { xPercent: -14, yPercent: 10 }, 0)
          .to(".hero-hand-right", { xPercent: 14, yPercent: 10 }, 0)
          .to(".hero-glow", { opacity: 0, scale: 0.6 }, 0)
          .to(".hero-copy", { yPercent: -20, opacity: 0 }, 0)
      }

      function pointerParallax() {
        const onMove = (e: PointerEvent) => {
          const nx = e.clientX / window.innerWidth - 0.5
          const ny = e.clientY / window.innerHeight - 0.5
          gsap.to(".hero-hand-left, .hero-hand-right", { x: nx * 18, y: ny * 10, duration: 0.9, ease: "power2.out" })
        }
        window.addEventListener("pointermove", onMove)
        return () => window.removeEventListener("pointermove", onMove)
      }

      function ambientDrift() {
        gsap.to(".hero-hand-left, .hero-hand-right", { y: -8, duration: 4, ease: "sine.inOut", yoyo: true, repeat: -1 })
      }

      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="top"
      className="relative overflow-hidden px-5 pb-14 md:px-10 md:pb-20"
    >
      <ParticleField count={typeof window !== "undefined" && window.innerWidth < 768 ? 60 : 150} />

      <div className="hero-copy relative z-10 mx-auto w-full max-w-4xl pt-6 text-center md:pt-8">
        <h1 className="font-heading text-[clamp(2.25rem,6.5vw,4.75rem)] font-bold leading-[1.0] tracking-[-0.03em]">
          {HEADLINE.map((word) => (
            <Fragment key={word}>
              <span className="inline-block overflow-hidden pb-[0.08em] align-bottom">
                <span className={`hero-word inline-block ${word.startsWith("boses") ? "text-accent" : ""}`}>
                  {word}
                </span>
              </span>{" "}
            </Fragment>
          ))}
        </h1>
        <p className="hero-sub mx-auto mt-5 max-w-xl text-sm leading-relaxed text-white/60 md:text-base">
          Every voice, heard. Report local concerns or send an emergency alert with your
          location and follow every update through resolution.
        </p>
        <div className="hero-ctas mt-7 flex flex-wrap items-center justify-center gap-5">
          <Link
            to="/sign-up"
            className="inline-flex min-h-12 items-center gap-3 bg-accent px-7 font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Create an account to report <ArrowRightIcon aria-hidden className="size-5" strokeWidth={1.5} />
          </Link>
          <a
            href="#emergency-help"
            className="inline-flex min-h-12 items-center font-semibold text-landing-cream underline decoration-primary decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Need emergency help?
          </a>
        </div>
      </div>

      {/*
        --meet tuning (glow box is 144px, so its top is 72px above the meet;
        the art's highest strokes, the right hand's knuckles, ride
        0.217 * var(--hand) above the tips). Clearance below the CTA row is
        mt + --meet - 72px for the glow and mt + --meet - 0.217*hand for the
        knuckles; both stay positive at every width:
          <640px:  mt 24px, hand 88vw, meet 19vw -> glow +23px at 375px,
                   knuckles +24px at 375px, +23px at 639px
          sm:      mt 32px, hand 75vw, meet 15vw -> glow +56px at 640px,
                   knuckles +23px at 767px
          md+:     mt 40px, hand 55vw, meet 11vw -> glow +52px at 768px,
                   knuckles +33px at 768px, +23px at 1920px
        Heights hug the visible art bottom (meet + 0.205 * hand) plus slack.
      */}
      <div
        className="relative z-0 mt-6 w-full [--hand:88vw] [--meet:19vw] h-[42vw] sm:mt-8 sm:[--hand:75vw] sm:[--meet:15vw] sm:h-[35vw] md:mt-10 md:[--hand:55vw] md:[--meet:11vw] md:h-[26vw]"
        aria-hidden
      >
        <img
          src="/contents/lefthand.webp"
          alt=""
          decoding="async"
          className="hero-hand-left pointer-events-none absolute"
          style={{
            width: "var(--hand)",
            left: `calc(50% + ${MEET_SHIFT} * var(--hand) - 0.3vw - ${L_TIP_X} * var(--hand))`,
            top: `calc(var(--meet) - ${L_TIP_Y} * var(--hand))`,
          }}
        />
        <img
          src="/contents/righthand.webp"
          alt=""
          decoding="async"
          className="hero-hand-right pointer-events-none absolute"
          style={{
            width: "var(--hand)",
            left: `calc(50% + ${MEET_SHIFT} * var(--hand) + 0.3vw - ${R_TIP_X} * var(--hand))`,
            top: `calc(var(--meet) - ${R_TIP_Y} * var(--hand))`,
          }}
        />
        <div
          className="hero-glow pointer-events-none absolute size-36 rounded-full opacity-80 blur-3xl"
          style={{
            left: `calc(50% + ${MEET_SHIFT} * var(--hand) - 4.5rem)`,
            top: "calc(var(--meet) - 4.5rem)",
            background: "radial-gradient(circle, rgba(255,80,3,0.65), transparent 70%)",
          }}
        />
      </div>
    </section>
  )
}