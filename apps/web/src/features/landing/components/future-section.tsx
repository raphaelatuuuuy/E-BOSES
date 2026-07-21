import {
  BellRinging,
  ClipboardText,
  MagnifyingGlass,
  Siren,
  SquaresFour,
} from "@phosphor-icons/react"

import { PlaceholderImage } from "./placeholder-image"
import { ArrowPillButton, ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const PLATFORM_LAYER = [
  { icon: ClipboardText, label: "Concern reports" },
  { icon: Siren, label: "Emergency alerts" },
  { icon: MagnifyingGlass, label: "Report checking" },
  { icon: BellRinging, label: "Nearby alerts" },
  { icon: SquaresFour, label: "Admin dashboard" },
]

export function FutureSection() {
  return (
    <section id="future" className={`relative overflow-hidden bg-white ${SECTION_PADDING}`}>
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-16 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <ParallaxText
              as="h2"
              speed={1}
              className="mb-6 font-heading text-3xl font-bold leading-tight text-[#020c4e] md:text-5xl"
            >
              Growing Into the Barangay&rsquo;s Everyday Tool
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="mb-6 text-lg leading-relaxed text-gray-600">
              As more residents report and respond, E-Boses becomes a clear record of what the
              community needs. That record helps the barangay decide what to fix first and where
              to spend.
            </ParallaxText>
            <div>
              <a href="#contact">
                <ArrowPillButton size="lg">Talk to the Team</ArrowPillButton>
              </a>
            </div>
          </Reveal>
          <Reveal delay={150}>
            <div className="relative h-[400px] overflow-hidden rounded-[32px] lg:h-[500px]">
              <PlaceholderImage tone="navy" label="Barangay civic record" iconClassName="size-12" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="mb-2 inline-block rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-900 backdrop-blur">
                  Network Vision
                </div>
                <h3 className="text-2xl font-bold text-white">The barangay&rsquo;s civic record</h3>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <h3 className="mb-6 text-center text-xl font-bold text-[#020c4e]">
            What E-Boses gives you today
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {PLATFORM_LAYER.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-border bg-gray-50 p-6 text-center transition-all duration-300 hover:border-[#ff8133]/20 hover:bg-[#ff8133]/5"
              >
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#ff8133]/10 text-[#ff5003]">
                  <item.icon className="size-5" />
                </div>
                <div className="text-sm font-bold text-[#020c4e]">{item.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
