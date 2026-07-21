import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"

const MAP_DOTS = [
  { left: "34%", top: "30%", delay: "0s" },
  { left: "61%", top: "43%", delay: "0.7s" },
  { left: "45%", top: "65%", delay: "1.4s" },
  { left: "72%", top: "70%", delay: "2.1s" },
] as const

export function HeroSection() {
  return (
    <section id="top" className="scroll-mt-24 overflow-hidden bg-white px-5 pb-16 pt-10 md:px-10 md:pb-24 lg:px-16">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="max-w-2xl">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.18em] text-[#ff5003]">
            Barangay Marikina Heights
          </p>
          <h1 className="text-wrap-balance font-heading text-5xl font-bold leading-[0.98] tracking-[-0.03em] text-[#020c4e] sm:text-6xl md:text-7xl">
            Your concern deserves a clear response.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-gray-700">
            Use a verified resident account to report local concerns or send an emergency alert with
            your location. Follow every update through resolution.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link
              to="/sign-up"
              className="inline-flex min-h-12 items-center gap-3 bg-[#ff5003] px-6 font-semibold text-white transition-colors hover:bg-[#d94300] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]"
            >
              Create an account to report <ArrowRight aria-hidden className="size-5" />
            </Link>
            <a className="inline-flex min-h-12 items-center font-semibold text-[#020c4e] underline decoration-[#ff8133] decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]" href="#emergency-help">
              Need emergency help?
            </a>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[34rem]">
          <div className="relative max-h-[22rem] overflow-hidden sm:max-h-none" role="img" aria-label="Boundary map of Barangay Marikina Heights with illustrative report locations">
          <img
            src="/contents/marikina-heights.svg"
            alt=""
            aria-hidden="true"
            width="1040"
            height="929"
            className="absolute inset-0 translate-x-5 translate-y-5 opacity-[0.08] [filter:invert(42%)_sepia(94%)_saturate(2850%)_hue-rotate(355deg)_brightness(100%)]"
          />
          <img
            src="/contents/marikina-heights.svg"
            alt=""
            aria-hidden="true"
            width="1040"
            height="929"
            className="absolute inset-0 translate-x-2.5 translate-y-2.5 opacity-[0.14] [filter:invert(42%)_sepia(94%)_saturate(2850%)_hue-rotate(355deg)_brightness(100%)]"
          />
          <img
            src="/contents/marikina-heights.svg"
            alt=""
            width="1040"
            height="929"
            fetchPriority="high"
            className="relative max-h-[30rem] w-full object-contain [filter:invert(8%)_sepia(72%)_saturate(3200%)_hue-rotate(225deg)_brightness(65%)]"
          />
          {MAP_DOTS.map((dot) => (
            <span
              key={`${dot.left}-${dot.top}`}
              className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff5003] shadow-[0_2px_8px_rgba(2,12,78,0.28)]"
              style={{ left: dot.left, top: dot.top }}
              aria-hidden="true"
            >
              <span
                className="absolute inset-0 rounded-full bg-[#ff5003] motion-safe:animate-ping"
                style={{ animationDelay: dot.delay, animationDuration: "2.8s" }}
              />
            </span>
          ))}
          </div>
          <p className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-600">
            <span className="size-2 rounded-full bg-[#ff5003]" aria-hidden="true" />
            Illustrative report locations
          </p>
        </div>
      </div>
    </section>
  )
}
