import { Link, useLocation, useNavigate } from "react-router-dom"
import { DownloadIcon } from "lucide-react"
import { APK_DOWNLOAD_URL } from "../constants"

type PlatformLink = { label: string; href?: string; to?: string }

const PLATFORM_LINKS: PlatformLink[] = [
  { label: "How it Works", href: "#how-it-works" },
  { label: "Community", href: "#community" },
  { label: "Resident Benefits", href: "#impact" },
  { label: "Help Center", to: "/help" },
]

export function Footer() {
  const location = useLocation()
  const navigate = useNavigate()

  const scrollTo = (href: string) => {
    const id = href.slice(1)
    if (location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" })
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 80)
      }
    } else {
      navigate("/" + href)
      window.scrollTo({ top: 0, behavior: "instant" })
    }
  }
  return (
    <footer className="relative overflow-hidden border-t border-white/10 bg-linear-to-b from-landing-bg to-landing-bg text-white">    
      {/* Backdrop: ember horizon. Deep red-orange glow rising from the bottom
          edge into black, with a warmer highlight off to the right. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-x-0 bottom-0 h-80"
          style={{
            background:
              "radial-gradient(135% 100% at 50% 132%, rgba(255,129,51,0.5) 0%, rgba(214,48,18,0.38) 36%, rgba(128,22,10,0.2) 62%, transparent 84%)",
          }}
        />
        {/* Deep red band hugging the very bottom edge, the reference's most intense strip */}
        <div
          className="absolute inset-x-0 bottom-0 h-24"
          style={{
            background: "linear-gradient(to top, rgba(196,32,10,0.38), rgba(150,26,10,0.16) 55%, transparent)",
          }}
        />
        <div
          className="absolute bottom-0 right-[4%] h-44 w-[42%]"
          style={{
            background: "radial-gradient(85% 100% at 62% 125%, rgba(255,196,120,0.22), transparent 72%)",
          }}
        />
      </div>

      {/* Matches the navbar / page sections (max-w-7xl + px-5 md:px-10 lg:px-16)
          so the footer's left edge aligns with the page content instead of the
          default `container` padding, which sat at a different x-offset. */}
      <div className="mx-auto max-w-7xl px-5 pt-16 pb-12 md:px-10 lg:px-16 min-[1600px]:max-w-[92rem]">
        <div className="relative z-10 mb-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          <div className="space-y-6">
            <div>
              <Link to="/" className="flex items-center gap-2">
                <img src="/contents/logo.webp" alt="E-Boses" className="h-10 w-auto object-contain" />
                <span className="text-lg font-bold text-primary">Boses</span>
              </Link>
              <p className="mt-3 text-sm leading-relaxed text-white/40">
                E-Boses gives communities one place to report local concerns, send emergency
                alerts, and follow every update until it is resolved.
              </p>
            </div>
          </div>

          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h4 className="mb-6 font-bold text-white">Platform</h4>
                <ul className="space-y-4 text-sm text-white/50">
                  {PLATFORM_LINKS.map((link) => (
                    <li key={link.label}>
                      {link.to ? (
                        <Link className="transition-colors hover:text-primary" to={link.to}>
                          {link.label}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          className="transition-colors hover:text-primary"
                          onClick={() => scrollTo(link.href!)}
                        >
                          {link.label}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="text-center md:text-left">
            <h4 className="mb-6 text-left font-bold text-white">Get the app</h4>
            <p className="mb-5 text-sm leading-relaxed text-white/50">
              Faster reporting and SOS alerts with the E-Boses Android app.
            </p>
            <a
              href={APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground sm:w-auto"
            >
              <DownloadIcon className="size-4" strokeWidth={2} aria-hidden="true" />
              Download the app
            </a>
            <p className="mt-3 text-xs text-white/40">Free for Android</p>
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm text-white/40 md:flex-row">
          <p>© 2026 E-Boses. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
