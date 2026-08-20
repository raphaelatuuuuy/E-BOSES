import type { ReactNode } from "react"

import { Footer } from "./footer"
import { GrainOverlay } from "./grain-overlay"
import { Navbar } from "./navbar"

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const FIELD_CLASS =
  "min-h-12 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 text-sm text-landing-cream placeholder:text-white/30 transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

export const LABEL_CLASS = "mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-white/50"

export const EYEBROW_CLASS =
  "inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-accent"

export function LandingPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="landing-fonts flex min-h-screen flex-col overflow-x-hidden bg-landing-bg text-landing-cream">
      <Navbar />
      <main className="flex-grow">{children}</main>
      <Footer />
      <GrainOverlay />
    </div>
  )
}
