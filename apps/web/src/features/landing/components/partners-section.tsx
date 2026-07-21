import { Bank, GraduationCap, Heartbeat, Shield } from "@phosphor-icons/react"

import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const PARTNERS = [
  {
    icon: Bank,
    gradient: "from-emerald-400 to-green-500",
    name: "Barangay Marikina Heights",
    body: "Our pilot barangay partner, shaping the real workflows, needs, and field testing.",
  },
  {
    icon: GraduationCap,
    gradient: "from-yellow-400 to-amber-500",
    name: "PUP CCIS",
    body: "Our academic partner. The College of Computer and Information Sciences guides the research and testing.",
  },
  {
    icon: Shield,
    gradient: "from-blue-400 to-indigo-500",
    name: "Tanods and BDRRMO",
    body: "Volunteer first responders who receive, confirm, and act on alerts out in the field.",
  },
  {
    icon: Heartbeat,
    gradient: "from-orange-400 to-red-500",
    name: "Barangay Health Workers",
    body: "Community health responders for medical emergencies and follow ups with residents.",
  },
]

export function PartnersSection() {
  return (
    <section id="partners" className={`relative overflow-hidden bg-[#202124] text-white ${SECTION_PADDING}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 h-[600px] w-[600px] -translate-y-1/2 translate-x-1/2 rounded-full bg-white/5 mix-blend-overlay blur-[150px]"
      />
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-20 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-xl">
            <ParallaxText
              as="h2"
              speed={1}
              className="mb-6 font-heading text-4xl font-bold tracking-tight text-white md:text-6xl"
            >
              Backed by the <span className="text-[#ff8133]">Community</span> It Serves
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="text-xl font-light leading-relaxed text-white/60">
              E-Boses is built together with Barangay Marikina Heights and the people who keep it
              running. Officials, volunteers, and residents.
            </ParallaxText>
          </div>
          <div className="hidden pb-2 md:block">
            <a
              href="#contact"
              className="inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white px-8 text-base font-medium text-gray-900 transition-colors hover:bg-white/90"
            >
              Become a Partner
            </a>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PARTNERS.map((partner, i) => (
            <Reveal key={partner.name} delay={i * 100}>
              <div className="group relative flex h-[320px] flex-col justify-between overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-8 transition-all duration-500 hover:bg-white/10">
                <div
                  className={`pointer-events-none absolute top-0 right-0 h-32 w-32 rounded-full bg-gradient-to-br ${partner.gradient} opacity-0 blur-[50px] transition-opacity duration-500 group-hover:opacity-20`}
                />
                <div>
                  <div
                    className={`mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${partner.gradient} text-white transition-transform duration-500 group-hover:scale-110`}
                  >
                    <partner.icon className="size-7" />
                  </div>
                  <h3 className="mb-2 text-2xl font-bold leading-tight">{partner.name}</h3>
                </div>
                <div>
                  <div className="mb-4 h-px w-full bg-white/10 transition-colors group-hover:bg-white/20" />
                  <p className="text-sm text-white/60 transition-colors group-hover:text-white/90">
                    {partner.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-12 md:hidden">
          <a
            href="#contact"
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white px-8 text-base font-medium text-gray-900 transition-colors hover:bg-white/90"
          >
            Become a Partner
          </a>
        </div>

        <Reveal delay={200} className="mt-20 border-t border-white/10 pt-10 text-center">
          <p className="mx-auto max-w-4xl text-xl font-light leading-relaxed text-white/50 md:text-2xl">
            &ldquo;If you&rsquo;re part of Marikina Heights and want to help shape the platform,
            <br />
            we&rsquo;d like to talk.&rdquo;
          </p>
        </Reveal>
      </div>
    </section>
  )
}
