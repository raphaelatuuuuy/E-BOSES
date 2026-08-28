import { Link, useLocation, useNavigate } from "react-router-dom"
import { ArrowRightIcon, MenuIcon, MinusIcon } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent } from "react"

type NavLink = { label: string; href?: string; to?: string }

const NAV_LINKS: NavLink[] = [
  { label: "Home", href: "#top" },
  { label: "How E-Boses helps", href: "#about" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Resident benefits", href: "#impact" },
  { label: "Help Center", to: "/help" },
  { label: "Active Communities", to: "/communities" },
]

const PANEL_LINKS: NavLink[] = [...NAV_LINKS, { label: "Sign in", to: "/sign-in" }]

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

const OUTLINE_CTA = "min-h-10 items-center rounded-none border border-white/20 px-5 text-sm font-medium text-white/85 transition-colors hover:border-white/40 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
const SOLID_CTA = "min-h-10 items-center gap-2 rounded-none bg-accent px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:px-5"
const NAV_DEMO_CTA = "min-h-9 items-center rounded-none bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const lastScrollY = useRef(0)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      const delta = y - lastScrollY.current
      if (y >= 80 && delta > 6) setHidden(true)
      if (delta < -6) setHidden(false)
      setScrolled(y > 10)
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
    if (!menuOpen) return
    document.body.style.overflow = "hidden"
    const menuButton = menuButtonRef.current
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false)
        return
      }
      if (event.key !== "Tab" || !panelRef.current || !menuButton) return
      const focusable = [menuButton, ...Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!last) return
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
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)
  const tab = menuOpen ? 0 : -1
  const location = useLocation()
  const navigate = useNavigate()

  const goToAnchor = (event: MouseEvent<HTMLAnchorElement>, href?: string) => {
    event.preventDefault()
    closeMenu()
    if (!href) return
    const scroll = () => document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" })
    if (location.pathname === "/") {
      scroll()
    } else {
      navigate("/" + href)
      requestAnimationFrame(() => requestAnimationFrame(scroll))
    }
  }

  return (
    <header className={`sticky top-0 z-[999] w-full transition-transform duration-200 motion-reduce:transition-none ${hidden && !menuOpen ? "-translate-y-full" : "translate-y-0"}`}>
      <div className={`px-5 transition-colors duration-200 md:px-10 lg:px-16 ${menuOpen || scrolled ? "bg-landing-bg border-b border-white/8" : "bg-transparent"}`}>
        <div className="mx-auto flex h-20 max-w-7xl items-center gap-3 min-[1600px]:max-w-[92rem] min-[1600px]:gap-8">
          <Link to="/" onClick={closeMenu} className="flex shrink-0 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground">
            <img src="/contents/logo.webp" alt="E-Boses" className="h-10 w-auto object-contain" />
            <span className="px-2 text-2xl font-bold text-accent">Boses</span>
          </Link>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <Link
              to="/book-demo"
              onClick={closeMenu}
              className={`${NAV_DEMO_CTA} ${menuOpen ? "hidden" : "inline-flex"}`}
            >
              Book a Demo
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex size-11 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="primary-menu"
            >
              {menuOpen ? <MinusIcon className="size-6" strokeWidth={1.5} aria-hidden="true" /> : <MenuIcon className="size-6" strokeWidth={1.5} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      <div
        ref={panelRef}
        id="primary-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!menuOpen}
        className={`absolute inset-x-0 top-20 grid transition-[grid-template-rows] duration-300 ease-out ${menuOpen ? "grid-rows-[1fr]" : "pointer-events-none grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden bg-landing-bg">
          <div className="scrollbar-hide max-h-[calc(100dvh-5rem)] overflow-y-auto px-5 pb-8 md:px-10 lg:px-16">
            <div className="mx-auto max-w-7xl">
              <nav aria-label="Menu navigation" className="flex flex-col items-start pt-4">
                {PANEL_LINKS.map((link, index) => {
                  const className = `min-h-14 py-2 text-left text-2xl font-semibold text-white transition-[opacity,transform] duration-300 ease-out hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground motion-reduce:translate-y-0 sm:text-3xl ${menuOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`
                  const style = menuOpen ? { transitionDelay: `${60 + index * 40}ms` } : undefined
                  return link.to ? (
                    <Link key={link.label} to={link.to} onClick={closeMenu} style={style} tabIndex={tab} className={className}>
                      {link.label}
                    </Link>
                  ) : (
                    <a key={link.label} href={link.href} onClick={(event) => goToAnchor(event, link.href)} style={style} tabIndex={tab} className={className}>
                      {link.label}
                    </a>
                  )
                })}
              </nav>

              <div className="mt-8 flex flex-col gap-3">
                <Link to="/communities/new" onClick={closeMenu} tabIndex={tab} className={`${OUTLINE_CTA} flex min-h-12 w-full justify-center`}>
                  Make your Own Community
                </Link>
                <Link to="/book-demo" onClick={closeMenu} tabIndex={tab} className={`${SOLID_CTA} flex min-h-12 w-full justify-center`}>
                  Book a Demo <ArrowRightIcon className="size-4" strokeWidth={2} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
