import { Link } from "react-router-dom"
import { MapPinIcon, PhoneIcon } from "lucide-react"

type PlatformLink = { label: string; href?: string; to?: string }

const PLATFORM_LINKS: PlatformLink[] = [
  { label: "How it Works", href: "#how-it-works" },
  { label: "Community", href: "#community" },
  { label: "Resident Benefits", href: "#impact" },
  { label: "Contact", href: "#contact" },
  { label: "Help Center", to: "/help" },
]

export function Footer() {
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

      {/* Peeking mascot pinned to the right screen edge (desktop) */}
      <img
        src="/contents/footer.webp"
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="pointer-events-none absolute bottom-24 right-0 z-0 hidden h-40 w-auto object-contain md:block lg:h-48"
      />
  
      <div className="container mx-auto px-4 pt-16 pb-12 sm:px-6 lg:px-8">
        <div className="relative z-10 mb-16 grid grid-cols-1 gap-12 md:grid-cols-3">
          <div className="space-y-6">
            <div>
              <Link to="/" className="flex items-center gap-2">
                <img src="/contents/logo.webp" alt="E-Boses" className="h-10 w-auto object-contain" />
                <span className="text-lg font-bold text-primary">Boses</span>
              </Link>
              <p className="mt-3 text-sm leading-relaxed text-white/40">
                E-Boses helps Marikina Heights residents report local concerns, send emergency
                alerts, and follow updates in one place.
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
                        <a className="transition-colors hover:text-primary" href={link.href}>
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <img
                src="/contents/footer.webp"
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
            <ul className="space-y-4 text-sm text-white/50">
              <li className="flex items-start gap-3">
                <MapPinIcon className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <span>Barangay Hall, Marikina Heights, Marikina City</span>
              </li>
              <li className="flex items-start gap-3">
                <PhoneIcon className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                <span>Marikina City hotline 161</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="relative z-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-sm text-white/40 md:flex-row">
          <p>© 2026 E-Boses. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}