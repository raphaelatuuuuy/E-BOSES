import { BellRinging, MapPin, Users } from "@phosphor-icons/react"

import { PlaceholderImage } from "./placeholder-image"
import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const LOOPS = [
  {
    icon: MapPin,
    when: "Every report you send",
    then: "can be followed until it is resolved",
  },
  {
    icon: BellRinging,
    when: "Every emergency alert",
    then: "reaches responders with your location",
  },
  {
    icon: Users,
    when: "Every nearby resident gets alerted",
    then: "so they stay aware of what is happening nearby",
  },
]

export function CommunitySection() {
  return (
    <section id="community" className={`relative overflow-hidden bg-white ${SECTION_PADDING}`}>
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-16 grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <ParallaxText
              as="h2"
              speed={1}
              className="mb-6 font-heading text-3xl font-bold leading-tight text-[#020c4e] md:text-5xl"
            >
              Built for Barangay Marikina Heights.
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="mb-4 text-lg leading-relaxed text-gray-600">
              E-Boses is built around how the barangay really works. Two hired staff, volunteer
              tanods and health workers, and residents who are mostly on mobile data.
            </ParallaxText>
            <ParallaxText as="p" speed={0.55} className="text-lg leading-relaxed text-gray-600">
              Every report, alert, and reply feeds the same cycle. Residents take part, officials
              act on real proof, and responders know exactly where to go.
            </ParallaxText>
          </Reveal>
          <Reveal delay={150}>
            <div className="relative h-[400px] overflow-hidden rounded-[32px] lg:h-[500px]">
              <PlaceholderImage tone="navy" label="Marikina Heights community" iconClassName="size-12" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="inline-block rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-900 backdrop-blur">
                  Marikina Heights
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {LOOPS.map((loop, i) => (
            <Reveal key={loop.when} delay={i * 120}>
              <div className="group relative flex h-full flex-col overflow-hidden rounded-[32px] border border-border bg-white transition-all duration-500 hover:-translate-y-1 hover:shadow-xl hover:shadow-[#ff8133]/5">
                <div className="p-7 pb-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-[#ff8133]/10 text-[#ff5003] transition-colors duration-300 group-hover:bg-[#ff8133] group-hover:text-white">
                      <loop.icon className="size-4" />
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
                      When
                    </div>
                  </div>
                  <div className="mb-3 font-heading text-lg font-bold leading-snug text-[#020c4e] md:text-xl">
                    {loop.when}
                  </div>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-[#ff5003]">
                    Then
                  </div>
                  <div className="font-heading text-lg font-bold leading-snug text-[#ff5003] md:text-xl">
                    {loop.then}
                  </div>
                </div>
                <div className="relative h-72 flex-grow overflow-hidden bg-gray-50">
                  <PlaceholderImage label={loop.when} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
