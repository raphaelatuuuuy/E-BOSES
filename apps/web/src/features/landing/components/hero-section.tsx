import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { PlaceholderImage } from "./placeholder-image"
import { ArrowPillButton, OutlinePillButton } from "./ui-bits"

// Real Barangay Marikina Heights boundary outline (matches /contents/marikina-heights.svg,
// viewBox 1040 x 929 — same aspect ratio as the hero image frame below).
const BOUNDARY_PATH =
  "M20.0,527.5 L48.1,534.4 L56.4,586.9 L69.5,607.8 L108.8,614.6 L128.2,716.3 L150.1,764.7 L220.0,818.6 L305.2,835.0 L398.7,809.8 L481.7,745.1 L528.0,639.2 L548.8,640.7 L591.1,657.8 L648.3,709.1 L663.3,768.5 L679.6,789.4 L744.4,805.3 L764.0,819.1 L823.3,798.6 L836.5,801.8 L902.6,909.4 L1003.1,613.4 L1020.0,504.9 L965.5,453.7 L903.8,443.4 L820.0,444.0 L813.9,312.4 L776.3,238.4 L570.6,57.0 L464.5,20.0 L424.4,22.7 L402.7,175.3 L276.9,177.7 L245.0,196.5 L220.1,226.7 L188.5,306.8 L187.7,408.5 L174.1,449.5 L106.3,472.5 L60.2,433.7 L43.5,433.3 L58.9,447.5 L41.9,459.2 L37.5,504.4 L23.5,503.5 L20.0,527.5 Z"

// clipPathUnits="objectBoundingBox" maps the 1040x929 user space into the 0..1
// box of whatever element references it, so the clip scales with the frame.
const CLIP_STYLE = {
  clipPath: "url(#mh-boundary)",
  WebkitClipPath: "url(#mh-boundary)",
} as const

const HERO_TABS = [
  { label: "Road Damage", tag: "Concern · Road Damage" },
  { label: "Flooding", tag: "Concern · Flooding" },
  { label: "Illegal Dumping", tag: "Concern · Dumping" },
  { label: "Stray Animals", tag: "Concern · Strays" },
  { label: "Emergency Alert", tag: "SOS · Location Sent" },
]

export function HeroSection() {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState(0)
  const [paused, setPaused] = useState(false)
  const [pageVisible, setPageVisible] = useState(true)

  useEffect(() => {
    // Flip on the next frame so the initial (hidden) state paints first and the
    // entrance transition reliably plays. Also keeps setState out of the effect body.
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onVisibility = () => setPageVisible(!document.hidden)
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  useEffect(() => {
    if (paused || !pageVisible) return
    const id = setInterval(() => {
      setActiveTab((prev) => (prev + 1) % HERO_TABS.length)
    }, 4000)
    return () => clearInterval(id)
  }, [paused, pageVisible])

  return (
    <section id="top" className="relative overflow-hidden bg-white pt-1.5 pb-12 md:pt-3 md:pb-16">
      {/* Subtle dot texture + bottom gradient into the navy marquee band */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, #020c4e 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-b from-transparent via-[#020c4e]/50 to-[#020c4e]"
      />

      <div className="relative z-10 px-5 md:px-10 lg:px-16">
        <div className="relative grid grid-cols-1 items-center gap-10 pt-2 pb-2 md:pt-1 md:pb-6 lg:grid-cols-12 lg:gap-12 lg:pt-2 lg:pb-8">
          {/* Copy */}
          <div className="max-w-2xl lg:col-span-5 xl:col-span-5 lg:self-start">
            <h1
              style={{ fontFamily: '"omegaSans", "Saans", "Mulish", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}
              className={`text-[2.9rem] font-bold leading-[1.05] tracking-tight text-[#020c4e] sm:text-[3.2rem] md:text-[4rem] transition-all duration-700 ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
              }`}
            >
              Boses na tunay,
              <span className="mt-2 block text-[1.9rem] font-bold leading-snug text-gray-600 sm:text-[2rem] md:text-[2.1rem]">
                tulong na alalay para sa
                <br />
                <span className="text-[#ff5003]">Marikina Heights</span>.
              </span>
            </h1>
            <p
              className={`mt-5 max-w-xl font-sans text-sm leading-relaxed text-gray-600 md:text-base transition-all duration-700 delay-100 ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
              }`}
            >
              E-Boses is the online home of Barangay Marikina Heights. Report problems with a
              photo and location, send emergency alerts straight to tanods and health workers,
              and follow every report until it is resolved.
            </p>
            <div
              className={`mt-8 flex flex-wrap gap-4 transition-all duration-700 delay-200 ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
              }`}
            >
              <Link to="/sign-up">
                <ArrowPillButton size="lg">Report a Concern</ArrowPillButton>
              </Link>
              <a href="#how-it-works">
                <OutlinePillButton>See How It Works</OutlinePillButton>
              </a>
            </div>
          </div>

          {/* Marikina Heights boundary silhouette stack */}
          <div className="relative w-full lg:col-span-7 xl:col-span-7 lg:self-start lg:-mt-5">
            {/* Off-screen clip definition: the actual barangay boundary outline */}
            <svg
              className="pointer-events-none absolute h-0 w-0"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <clipPath id="mh-boundary" clipPathUnits="objectBoundingBox">
                  {/* scale 1040x929 user space into the 0..1 objectBoundingBox */}
                  <path transform="scale(0.00096153846, 0.00107642626)" d={BOUNDARY_PATH} />
                </clipPath>
              </defs>
            </svg>

            <div
              className={`relative mx-auto w-[92%] max-w-[560px] transition-all duration-700 delay-150 ${
                mounted ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-95 opacity-0"
              }`}
              style={{ aspectRatio: "1040 / 929" }}
            >
              {/* Layered depth: real boundary shape offset behind the image */}
              <div
                aria-hidden="true"
                className="absolute inset-0 translate-x-5 translate-y-5 bg-[#020c4e] opacity-25 transition-transform duration-700"
                style={CLIP_STYLE}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 translate-x-2.5 translate-y-2.5 bg-[#020c4e] opacity-50 transition-transform duration-700"
                style={CLIP_STYLE}
              />
              <div className="absolute inset-0" style={CLIP_STYLE}>
                <PlaceholderImage
                  tone={HERO_TABS[activeTab].label === "Emergency Alert" ? "dark" : "navy"}
                  label={HERO_TABS[activeTab].label}
                  iconClassName="size-12"
                  className="h-full w-full transition-transform duration-500"
                />
              </div>

              {/* Floating badge */}
              <div
                className={`absolute left-[2%] top-[42%] z-20 flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white/95 px-2.5 py-1 shadow-xl shadow-black/15 ring-1 ring-black/5 transition-all duration-500 delay-500 sm:gap-2 sm:px-3 sm:py-1.5 ${
                  mounted ? "scale-100 opacity-100" : "scale-75 opacity-0"
                }`}
              >
                <span className="relative flex size-2">
                  <span
                    className={`absolute inset-0 animate-ping rounded-full opacity-60 ${
                      HERO_TABS[activeTab].label === "Emergency Alert" ? "bg-red-600" : "bg-[#ff8133]"
                    }`}
                  />
                  <span
                    className={`absolute inset-0 rounded-full ${
                      HERO_TABS[activeTab].label === "Emergency Alert" ? "bg-red-600" : "bg-[#ff8133]"
                    }`}
                  />
                </span>
                <span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-700 sm:text-[11px] sm:tracking-[0.12em]">
                  {HERO_TABS[activeTab].tag}
                </span>
              </div>
            </div>

            {/* Thumbnail tabs */}
            <div
              className={`mt-6 flex items-center justify-center gap-3 md:mt-8 transition-all duration-700 delay-300 ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
              }`}
              role="tablist"
              aria-label="Concern categories"
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
            >
              {HERO_TABS.map((tab, i) => {
                const active = i === activeTab
                return (
                  <button
                    key={tab.label}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={tab.label}
                    onClick={() => setActiveTab(i)}
                    className={`relative shrink-0 overflow-hidden rounded-full transition-all duration-500 ${
                      active
                        ? "size-14 shadow-lg ring-2 ring-[#020c4e] ring-offset-2 ring-offset-white md:size-16"
                        : "size-10 opacity-55 ring-1 ring-gray-200 hover:opacity-100 hover:ring-gray-400 md:size-12"
                    }`}
                  >
                    <PlaceholderImage
                      tone={tab.label === "Emergency Alert" ? "dark" : "navy"}
                      label={active ? tab.label : undefined}
                      iconClassName="size-4"
                      className={`h-full w-full transition-all duration-300 ${
                        active ? "opacity-100" : "opacity-75"
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
