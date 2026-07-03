import { useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Navbar } from "./components/navbar"

export default function LandingPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#020c4e] to-[#ff8133]">
      <div className="flex flex-col flex-1">
        {/* Top navigation */}
        <Navbar />

        {/* Hero section — centered on remaining viewport */}
        <main className="flex flex-1 flex-col items-center justify-center md:pt-28">
          {/* Text content container — only what needs padding/max-width */}
          <div className="flex flex-col items-center text-center px-4 md:px-8 md:max-w-6xl md:mx-auto">
            <p
              className={`font-heading text-[clamp(2rem,6vw,4rem)] font-bold leading-none tracking-tight text-white transition-all duration-700 delay-100 ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              }`}
            >
              Boses na tunay,<br className="md:hidden" />{" "}
              <span className="italic">tulong na alalay</span>
            </p>
            <p
              className={`mt-4 text-sm leading-relaxed text-white/70 transition-all duration-700 delay-200 md:text-base md:whitespace-nowrap ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              }`}
            >
              Report concerns. Send emergency alerts.<br className="md:hidden" /> Stay connected with your community.
            </p>
            <div
              className={`mt-8 transition-all duration-700 delay-300 md:invisible ${
                mounted ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
              }`}
            >
              <Link
                to="/sign-up"
                className="inline-flex h-12 items-center justify-center rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-lg hover:bg-[#ff5003] hover:shadow-xl active:scale-[0.97]"
              >
                Get started
              </Link>
            </div>
          </div>

          {/* Image inside main on mobile only */}
          <div
            className={`w-full md:hidden transition-all duration-700 delay-500 ${
              mounted ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
            }`}
          >
            <img
              src="/contents/kamay.png"
              alt="Community hands illustration"
              className="h-auto w-full"
            />
          </div>
        </main>

        {/* Image outside main on desktop only */}
        <div
          className={`hidden md:block w-full transition-all duration-700 delay-500 md:-mt-30 ${
            mounted ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
          }`}
        >
          <img
            src="/contents/kamay.png"
            alt="Community hands illustration"
            className="h-auto w-full object-contain"
          />
        </div>
      </div>
    </div>
  )
}
