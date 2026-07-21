import { Link } from "react-router-dom"
import { ArrowRight, List, X } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

import { ArrowPillButton } from "./ui-bits"

const NAV_LINKS = [
  { label: "Home", href: "#top" },
  { label: "About E-Boses", href: "#about" },
  { label: "Features", href: "#features" },
  { label: "Impact", href: "#impact" },
  { label: "Partners", href: "#partners" },
]

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const lastScrollY = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 24)
      const delta = y - lastScrollY.current
      if (y < 80) {
        setHidden(false)
      } else if (delta > 6) {
        setHidden(true)
      } else if (delta < -6) {
        setHidden(false)
      }
      lastScrollY.current = y
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileOpen])

  const openMenu = () => setMobileOpen(true)
  const closeMenu = () => setMobileOpen(false)

  return (
    <>
      <header
        className={`sticky top-0 z-[100] w-full border-b bg-white transition-transform transition-colors duration-300 ${
          scrolled ? "border-gray-200" : "border-transparent"
        } ${hidden && !mobileOpen ? "-translate-y-full" : "translate-y-0"}`}
      >
        <div className="px-5 md:px-10 lg:px-16">
          <div className="flex h-20 items-center justify-between">
            <Link to="/" className="relative z-50 flex shrink-0 items-center">
              <img
                src="/contents/logo.png"
                alt="E-Boses"
                className="h-10 w-auto object-contain md:h-12"
              />
            </Link>

            {/* Desktop nav links */}
            <nav className="hidden lg:flex items-center gap-8">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="group relative text-sm font-medium text-gray-600 transition-colors hover:text-[#ff5003]"
                >
                  {link.label}
                  <span className="absolute -bottom-1 left-0 h-0.5 w-0 bg-[#ff8133] opacity-0 transition-all duration-300 group-hover:w-full group-hover:opacity-100" />
                </a>
              ))}
            </nav>

            <div className="hidden lg:flex items-center">
              <Link
                to="/sign-in"
                className="rounded-full px-5 py-2 text-sm font-medium text-gray-600 transition-all duration-300 hover:bg-[#ff8133] hover:text-white"
              >
                Sign in
              </Link>
            </div>

            {/* Hamburger */}
            <button
              type="button"
              onClick={openMenu}
              className="lg:hidden relative z-50 inline-flex size-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors duration-300"
              aria-label="Open menu"
            >
              <List className="size-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Fullscreen mobile overlay (lenol style: white, circle reveal, silhouette watermark) */}
      <div
        className={`lg:hidden fixed inset-0 z-[110] flex flex-col overflow-hidden bg-white transition-[clip-path] duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          mobileOpen
            ? "[clip-path:circle(150%_at_100%_0%)]"
            : "pointer-events-none [clip-path:circle(0%_at_100%_0%)]"
        }`}
        aria-hidden={!mobileOpen}
      >
        {/* Placeholder watermark */}
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -right-20 h-[360px] w-[360px] rounded-full bg-gradient-to-br from-[#ff8133]/15 to-[#020c4e]/10 blur-2xl"
        />

        <div className="flex h-20 items-center justify-between px-5">
          <Link to="/" className="shrink-0" onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1}>
            <img src="/contents/logo-name.png" alt="E-Boses" className="h-10 w-auto object-contain" />
          </Link>
          <button
            type="button"
            onClick={closeMenu}
            className="flex size-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700"
            aria-label="Close menu"
            tabIndex={mobileOpen ? 0 : -1}
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex flex-col gap-2 px-5 pt-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={closeMenu}
              tabIndex={mobileOpen ? 0 : -1}
              className="group flex items-center justify-between border-b border-gray-100 py-4 text-2xl font-semibold text-[#020c4e]"
            >
              {link.label}
              <ArrowRight className="size-6 text-[#ff5003] transition-transform duration-300 group-hover:-rotate-45" />
            </a>
          ))}
          <Link
            to="/sign-in"
            onClick={closeMenu}
            tabIndex={mobileOpen ? 0 : -1}
            className="group flex items-center justify-between border-b border-gray-100 py-4 text-2xl font-semibold text-[#020c4e]"
          >
            Sign in
            <ArrowRight className="size-6 text-[#ff5003] transition-transform duration-300 group-hover:-rotate-45" />
          </Link>
        </nav>

        <div className="mt-auto px-5 pb-8">
          <Link to="/sign-up" onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1} className="block">
            <ArrowPillButton size="lg" className="w-full justify-center">
              Get Started
            </ArrowPillButton>
          </Link>
        </div>
      </div>
    </>
  )
}
