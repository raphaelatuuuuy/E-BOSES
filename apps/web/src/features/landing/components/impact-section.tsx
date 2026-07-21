import {
  Clock,
  FileText,
  MapPin,
  ShieldCheck,
  Stack,
  Users,
} from "@phosphor-icons/react"

import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const STATS = [
  { icon: Clock, value: "24/7", label: "Report anytime, even after office hours" },
  { icon: Stack, value: "2", label: "Clear paths for concerns and emergencies" },
  { icon: FileText, value: "1", label: "Tracking number for every report" },
  { icon: ShieldCheck, value: "100%", label: "Residents verified by phone and ID" },
  { icon: MapPin, value: "Location", label: "Alerts show responders where to go" },
  { icon: Users, value: "Nearby", label: "Residents close by are notified to help" },
]

export function ImpactSection() {
  return (
    <section id="impact" className={`relative overflow-hidden bg-[#020c4e] text-white ${SECTION_PADDING}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full bg-[linear-gradient(to_right,#ffffff14_1px,transparent_1px),linear-gradient(to_bottom,#ffffff14_1px,transparent_1px)] bg-[size:48px_48px]"
      />
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-12 md:gap-16">
          <Reveal className="max-w-4xl">
            <ParallaxText
              as="h2"
              speed={1}
              className="mb-8 font-heading text-3xl font-bold leading-tight text-white md:text-5xl"
            >
              A Barangay Run on <span className="text-[#ffb37f]">Everyday Reports</span>
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="mb-8 text-lg leading-relaxed text-white/90">
              E-Boses turns visits, phone calls, and logbook entries into clear records that are
              checked, sorted, and followed from the moment they are sent until they are resolved.
            </ParallaxText>
            <div className="max-w-2xl rounded-r-2xl border-l-4 border-[#ff8133] bg-white/5 p-6 backdrop-blur-md">
              <p className="text-xl font-medium italic leading-relaxed text-white/95">
                &ldquo;Every report strengthens how the barangay serves its community.&rdquo;
              </p>
            </div>
          </Reveal>

          <Reveal delay={150}>
            <div className="grid grid-cols-2 gap-[2px] border-2 border-white/40 bg-white/40 md:grid-cols-3">
              {STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="group relative bg-[#020c4e] p-5 transition-colors duration-300 hover:bg-white/5 md:p-8"
                >
                  <div className="mb-5 flex size-14 items-center justify-center rounded-xl border border-white/25 bg-white/5 text-[#ffb37f] transition-all duration-300 group-hover:border-white/40 group-hover:bg-white/10 group-hover:text-white">
                    <stat.icon className="size-6" />
                  </div>
                  <div className="mb-2 font-heading text-3xl font-bold leading-[1.05] text-white transition-colors group-hover:text-[#ffb37f] md:text-5xl">
                    {stat.value}
                  </div>
                  <div className="text-sm font-medium uppercase tracking-wider text-white/70">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
