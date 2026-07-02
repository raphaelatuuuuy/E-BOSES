import { Link } from "react-router-dom"
import { MenuIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-8">
        {/* Logo — left */}
        <Link to="/" className="shrink-0">
          <img src="/images/logo.png" alt="E-Boses" className="h-10 w-auto object-contain" />
        </Link>

        {/* Desktop nav links — center */}
        <nav className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] transition-colors">
            Home
          </Link>
          <Link to="/about" className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] transition-colors">
            About E-Boses
          </Link>
          <Link to="/features" className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] transition-colors">
            Features
          </Link>
          <Link to="/contact" className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] transition-colors">
            Contact Us
          </Link>
        </nav>

        {/* Auth buttons — right */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            to="/sign-in"
            className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] transition-colors px-3 py-2"
          >
            Sign in
          </Link>
          <Button
            asChild
            className="h-9 rounded-lg bg-[#ff8133] px-4 text-sm font-semibold text-white hover:bg-[#ff5003] active:scale-[0.97]"
          >
            <Link to="/sign-up">Sign up</Link>
          </Button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="md:hidden flex size-10 items-center justify-center text-[#020c4e]"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <XIcon className="size-6" /> : <MenuIcon className="size-6" />}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white">
          <nav className="flex flex-col items-center gap-4 px-4 py-6">
            <Link to="/" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e]">
              Home
            </Link>
            <Link to="/about" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e]">
              About E-Boses
            </Link>
            <Link to="/features" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e]">
              Features
            </Link>
            <Link to="/contact" onClick={() => setMobileOpen(false)} className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e]">
              Contact Us
            </Link>
            <div className="flex items-center gap-3 pt-3 border-t border-gray-200 w-full justify-center">
              <Link
                to="/sign-in"
                onClick={() => setMobileOpen(false)}
                className="text-sm font-medium text-[#020c4e]/70 hover:text-[#020c4e] px-3 py-2"
              >
                Sign in
              </Link>
              <Button
                asChild
                className="h-9 rounded-lg bg-[#ff8133] px-4 text-sm font-semibold text-white hover:bg-[#ff5003]"
                onClick={() => setMobileOpen(false)}
              >
                <Link to="/sign-up">Sign up</Link>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
