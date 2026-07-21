import { useEffect, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { MapPin, Phone } from "@phosphor-icons/react"

import { ArrowPillButton } from "./ui-bits"

const PLATFORM_LINKS = [
  { label: "How it Works", href: "#how-it-works" },
  { label: "Community", href: "#community" },
  { label: "Resident Benefits", href: "#impact" },
  { label: "Contact", href: "#contact" },
]

export function Footer() {
  const handsRef = useRef<HTMLDivElement | null>(null)
  const [handsInView, setHandsInView] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  )

  useEffect(() => {
    const el = handsRef.current
    if (!el || handsInView) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setHandsInView(true)
            observer.disconnect()
          }
        }
      },
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [handsInView])

  return (
    <footer className="relative overflow-hidden border-t border-zinc-800 bg-zinc-950 text-white">
      {/* Peeking mascot pinned to the right screen edge (desktop) */}
      <img
        src="/contents/footer.png"
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="pointer-events-none absolute bottom-28 right-0 z-0 hidden h-44 w-auto object-contain md:block lg:h-52 xl:h-60"
      />
      {/* CTA band */}
      <div className="overflow-hidden border-b border-zinc-800 bg-zinc-900/50">
        <div className="mx-auto px-4 pt-20 text-center sm:px-6 lg:px-8">
          <h2 className="font-heading text-3xl font-bold leading-tight text-white md:text-5xl">
            Be the <span className="text-[#ff8133]">Voice</span> that Drives{" "}
            <span className="text-[#ff8133]">Change</span>
          </h2>
        </div>

        {/* Hands meeting at center, edge to edge */}
        <div
          ref={handsRef}
          className="relative mt-6 flex h-40 w-full items-center justify-center sm:h-56 md:h-72 lg:h-80"
        >
          <img
            src="/contents/lefthand.png"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={`absolute left-0 top-1/2 w-1/2 max-w-[640px] -translate-y-1/2 object-contain transition-all duration-1000 ease-out ${
              handsInView ? "translate-x-0 opacity-100" : "-translate-x-40 opacity-0"
            }`}
          />
          <img
            src="/contents/righthand.png"
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className={`absolute right-0 top-1/2 w-1/2 max-w-[640px] -translate-y-1/2 object-contain transition-all delay-100 duration-1000 ease-out ${
              handsInView ? "translate-x-0 opacity-100" : "translate-x-40 opacity-0"
            }`}
          />
        </div>

        <div
          className={`flex justify-center px-4 pb-20 transition-all delay-500 duration-700 sm:px-6 lg:px-8 ${
            handsInView ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        >
          <Link to="/sign-up">
            <ArrowPillButton size="lg">Get Started</ArrowPillButton>
          </Link>
        </div>
      </div>

      {/* Link columns */}
      <div className="container mx-auto px-4 pt-16 pb-12 sm:px-6 lg:px-8">
        <div className="relative z-10 mb-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          <div className="space-y-6">
            <div>
              <Link to="/" className="flex items-center gap-2">
                <img src="/contents/logo.png" alt="E-Boses" className="h-10 w-auto object-contain" />
                <span className="text-lg font-bold text-[#ff8133]">Boses</span>
              </Link>
              <p className="mt-3 text-sm leading-relaxed text-zinc-500">
                E-Boses helps Marikina Heights residents report local concerns, send emergency
                alerts, and follow updates in one place.
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h4 className="mb-6 font-bold text-white">Platform</h4>
                <ul className="space-y-4 text-sm text-zinc-400">
                  {PLATFORM_LINKS.map((link) => (
                    <li key={link.label}>
                      <a className="transition-colors hover:text-[#ff8133]" href={link.href}>
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <img
                src="/contents/footer.png"
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className="pointer-events-none w-28 shrink-0 self-end sm:w-32 md:hidden"
              />
            </div>
          </div>

          <div>
            <h4 className="mb-6 font-bold text-white">Contact</h4>
            <ul className="space-y-4 text-sm text-zinc-400">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span>Barangay Hall, Marikina Heights, Marikina City</span>
              </li>
              <li className="flex items-start gap-3">
                <Phone className="mt-0.5 size-4 shrink-0" />
                <span>Marikina City hotline 161</span>
              </li>
            </ul>

          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center justify-between gap-4 border-t border-zinc-800 pt-8 text-sm text-zinc-500 md:flex-row">
          <p>© 2026 E-Boses · A PUP Capstone Project. All rights reserved.</p>
          <p>Privacy and terms will be published before public launch.</p>
        </div>
      </div>
    </footer>
  )
}
