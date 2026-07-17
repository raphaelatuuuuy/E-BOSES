import { Link } from "react-router-dom"
import { MenuIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuAnim, setMenuAnim] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mobileOpen) {
      requestAnimationFrame(() => setMenuAnim(true))
    } else {
      setMenuAnim(false)
    }
  }, [mobileOpen])

  const openMenu = () => setMobileOpen(true)
  const closeMenu = () => setMobileOpen(false)

  return (
    <>
      {/* Header bar — always transparent, just logo + hamburger */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 w-full transition-all duration-700 ${
          mounted ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="mx-auto flex h-20 max-w-7xl items-center px-4 md:px-8">
          <Link to="/" className="shrink-0">
            <img src="/contents/logo.png" alt="E-Boses" className="h-14 w-auto object-contain" />
          </Link>

          {/* Desktop nav links — absolute centered */}
          <nav className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-8">
            <Link to="/" className="text-sm font-medium text-white/70 hover:text-white transition-colors">
              Home
            </Link>
            <span className="text-sm font-medium text-white/40 cursor-not-allowed">
              About E-Boses
            </span>
            <span className="text-sm font-medium text-white/40 cursor-not-allowed">
              Features
            </span>
            <span className="text-sm font-medium text-white/40 cursor-not-allowed">
              Contact Us
            </span>
          </nav>

          <div className="hidden md:flex flex-1" />

          <div className="hidden md:flex items-center gap-3">
            <Link
              to="/sign-in"
              className="text-sm font-medium text-white/70 hover:text-white transition-colors px-3 py-2"
            >
              Sign in
            </Link>
            <Link
              to="/sign-up"
              className="inline-flex h-9 items-center justify-center rounded-full bg-[#ff8133] px-4 text-sm font-semibold text-white transition-all duration-300 hover:bg-[#ff5003] hover:scale-105 active:scale-[0.97]"
            >
              Sign up
            </Link>
          </div>

          {/* Hamburger */}
          <button
            type="button"
            onClick={openMenu}
            className="md:hidden flex size-10 items-center justify-center text-white ml-auto"
            aria-label="Open menu"
          >
            <MenuIcon className="size-6" />
          </button>
        </div>
      </header>

      {/* Fullscreen mobile overlay — covers EVERYTHING */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60] flex flex-col bg-[#020c4e]">
          {/* Top bar with logo + close */}
          <div className="flex h-20 items-center justify-between px-4">
            <Link to="/" className="shrink-0" onClick={closeMenu}>
              <img src="/contents/logo-name.png" alt="E-Boses" className="h-14 w-auto object-contain" />
            </Link>
            <button
              type="button"
              onClick={closeMenu}
              className="flex size-10 items-center justify-center text-white"
              aria-label="Close menu"
            >
              <XIcon className="size-6" />
            </button>
          </div>

          <nav className="flex flex-col gap-8 px-8 pt-16">
            <Link
              to="/"
              onClick={closeMenu}
              className={`text-4xl font-bold text-white/70 hover:text-white transition-all duration-500 ${
                menuAnim ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
              }`}
            >
              Home
            </Link>
            <span
              className={`text-4xl font-bold text-white/40 cursor-not-allowed transition-all duration-500 delay-100 ${
                menuAnim ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
              }`}
            >
              About E-Boses
            </span>
            <span
              className={`text-4xl font-bold text-white/40 cursor-not-allowed transition-all duration-500 delay-200 ${
                menuAnim ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
              }`}
            >
              Features
            </span>
            <span
              className={`text-4xl font-bold text-white/40 cursor-not-allowed transition-all duration-500 delay-[300ms] ${
                menuAnim ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
              }`}
            >
              Contact Us
            </span>
            <Link
              to="/sign-in"
              onClick={closeMenu}
              className={`text-4xl font-bold text-white/70 hover:text-white transition-all duration-500 delay-[400ms] ${
                menuAnim ? "translate-x-0 opacity-100" : "-translate-x-8 opacity-0"
              }`}
            >
              Sign in
            </Link>
          </nav>

          <div
            className={`mt-auto flex items-center justify-center pb-10 transition-all duration-500 delay-[500ms] ${
              menuAnim ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
            }`}
          >
            <Link
              to="/sign-up"
              onClick={closeMenu}
              className="inline-flex h-12 items-center justify-center rounded-full bg-[#ff8133] px-10 text-base font-semibold text-white transition-all duration-300 hover:bg-[#ff5003] hover:scale-105 active:scale-[0.97]"
            >
              Sign up
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
