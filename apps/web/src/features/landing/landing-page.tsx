import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Navbar } from "./components/navbar"
import { useScrollParallax } from "./hooks/use-scroll-parallax"

export default function LandingPage() {
  const [mounted, setMounted] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  const bgSpeed = isMobile ? 0.05 : 0.15
  const textSpeed = isMobile ? 0.03 : 0.05

  const bgOffset = useScrollParallax(bgSpeed)
  const textOffset = useScrollParallax(textSpeed)

  useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia("(max-width: 767px)")
    setIsMobile(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* ── Background: gradient + hands.png (fixed, parallax) ── */}
      <div
        className="fixed inset-0 bg-gradient-to-b from-[#020c4e] to-[#ff8133]"
        style={{
          transform: `translateY(${bgOffset}px)`,
          willChange: isMobile ? "auto" : "transform",
          backgroundImage: isMobile ? `url(/contents/hands-mb.png)` : `url(/contents/hands.png)`,
          backgroundSize: "cover",
          backgroundPosition: "calc(50% - 10px) bottom",
          backgroundRepeat: "no-repeat",
        }}
        aria-hidden="true"
      />
      {/* ── Dark overlay for readability ── */}
      <div className="fixed inset-0 bg-black/20" aria-hidden="true" />

      {/* ── Navigation (always on top) ── */}
      <Navbar />

      {/* ── Foreground content ── */}
      <main
        className="relative z-10 flex min-h-screen flex-col items-center justify-center md:justify-start md:pt-48"
        style={{
          transform: `translateY(${textOffset}px)`,
          willChange: isMobile ? "auto" : "transform",
        }}
      >
        <div className="flex flex-col items-center text-center px-4 md:px-8 md:max-w-6xl md:mx-auto">
          <p
            className={`font-heading text-[clamp(2rem,6vw,4rem)] font-bold leading-none tracking-tight text-white drop-shadow-lg transition-all duration-700 delay-100 ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
            }`}
          >
            Boses na tunay,<br className="md:hidden" />{" "}
            <span className="italic">tulong na alalay</span>
          </p>
          <p
            className={`mt-4 text-sm leading-relaxed text-white/80 drop-shadow transition-all duration-700 delay-200 md:text-base md:whitespace-nowrap ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
            }`}
          >
            Report concerns. Send emergency alerts.<br className="md:hidden" /> Stay connected with your community.
          </p>
          <div
            className={`mt-8 transition-all duration-700 delay-300 ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
            }`}
          >
            <Link
              to="/sign-up"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-lg hover:bg-[#ff5003] hover:shadow-xl hover:scale-105 active:scale-[0.97] transition-all duration-300"
            >
              Get started
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
