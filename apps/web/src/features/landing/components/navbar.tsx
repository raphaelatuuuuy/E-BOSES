import { Link } from "react-router-dom"
import { ArrowRight, List, X } from "@phosphor-icons/react"
import { useEffect, useRef, useState } from "react"

const NAV_LINKS = [
  { label: "Home", href: "#top" },
  { label: "How E-Boses helps", href: "#about" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Resident benefits", href: "#impact" },
  { label: "Contact", href: "#contact" },
]

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [hidden, setHidden] = useState(false)
  const lastScrollY = useRef(0)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      setScrolled(y > 24)
      const delta = y - lastScrollY.current
      if (y >= 80 && delta > 6) setHidden(true)
      if (delta < -6) setHidden(false)
      lastScrollY.current = y
    }
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()
    const menuButton = menuButtonRef.current

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false)
        return
      }
      if (event.key !== "Tab" || !menuRef.current) return
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = ""
      document.removeEventListener("keydown", onKeyDown)
      menuButton?.focus()
    }
  }, [mobileOpen])

  const closeMenu = () => setMobileOpen(false)

  return (
    <>
      <header className={`sticky top-0 z-40 w-full bg-transparent transition-transform duration-200 ${hidden && !mobileOpen ? "-translate-y-full" : "translate-y-0"}`}>
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 -z-10 border-b border-white/10 bg-[#07070b]/70 backdrop-blur-md transition-opacity duration-200 ${scrolled ? "opacity-100" : "opacity-0"}`}
        />
        <div className="px-5 md:px-10 lg:px-16">
          <div className="mx-auto flex h-20 max-w-7xl items-center justify-between">
            <Link to="/" className="flex shrink-0 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]">
              <img src="/contents/logo.png" alt="E-Boses" className="h-10 w-auto object-contain" />
              <span className="text-lg font-bold text-[#ff8133] px-2">Boses</span>
            </Link>

            <nav aria-label="Primary navigation" className="hidden items-center gap-7 lg:flex">
              {NAV_LINKS.map((link) => (
                <a key={link.label} href={link.href} className="min-h-11 py-3 text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#020c4e]">
                  {link.label}
                </a>
              ))}
            </nav>

            <Link to="/sign-in" className="hidden min-h-11 items-center px-4 text-sm font-semibold text-white underline decoration-[#ff8133] decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#020c4e] lg:inline-flex">
              Sign in
            </Link>

            <button ref={menuButtonRef} type="button" onClick={() => setMobileOpen(true)} className="inline-flex size-11 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#020c4e] lg:hidden" aria-label="Open menu" aria-expanded={mobileOpen} aria-controls="mobile-navigation">
              <List className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div ref={menuRef} id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation menu" aria-hidden={!mobileOpen} className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#07070b] text-white transition-opacity duration-200 lg:hidden ${mobileOpen ? "opacity-100" : "pointer-events-none invisible opacity-0"}`}>
        <img
          src="/contents/marikina-heights.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 w-[120%] -translate-x-1/2 -translate-y-1/2 opacity-[0.03]"
        />
        <div className="relative z-10 flex h-20 items-center justify-between px-5">
          <Link to="/" onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1} className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]">
            <img src="/contents/logo.png" alt="E-Boses" className="h-10 w-auto object-contain" />
          </Link>
          <button ref={closeButtonRef} type="button" onClick={closeMenu} className="flex size-11 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#020c4e]" aria-label="Close menu" tabIndex={mobileOpen ? 0 : -1}>
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Mobile navigation" className="relative z-10 flex flex-col px-5 pt-6">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.href} onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1} className="flex min-h-14 items-center justify-between border-b border-white/10 py-4 text-xl font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#020c4e]">
              {link.label}<ArrowRight className="size-5 text-[#ff5003]" aria-hidden="true" />
            </a>
          ))}
          <Link to="/sign-in" onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1} className="flex min-h-14 items-center justify-between border-b border-white/10 py-4 text-xl font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#020c4e]">
            Sign in<ArrowRight className="size-5 text-[#ff5003]" aria-hidden="true" />
          </Link>
        </nav>

        <div className="relative z-10 mt-auto p-5 pb-8">
          <Link to="/sign-up" onClick={closeMenu} tabIndex={mobileOpen ? 0 : -1} className="flex min-h-12 w-full items-center justify-center bg-[#ff5003] px-6 font-semibold text-white transition-colors hover:bg-[#d94300] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]">
            Create an account to report
          </Link>
        </div>
      </div>
    </>
  )
}
