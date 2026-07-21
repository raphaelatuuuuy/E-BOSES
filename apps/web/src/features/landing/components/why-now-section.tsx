import { DeviceMobile, Lightbulb, Scales, Users } from "@phosphor-icons/react"

import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const SHIFTS = [
  {
    icon: Scales,
    color: "text-red-600 bg-red-50",
    title: "A Duty to Respond",
    body: "The law requires barangays to act on community concerns, and the DILG expects clear records and timely response.",
  },
  {
    icon: Users,
    color: "text-orange-600 bg-orange-50",
    title: "Few People Take Part",
    body: "Only a small share of residents attend assemblies. An online channel finally includes the people who cannot show up in person.",
  },
  {
    icon: DeviceMobile,
    color: "text-emerald-600 bg-emerald-50",
    title: "Residents Are on Their Phones",
    body: "Most residents go online through mobile data, so a website that works well on a phone is the most practical way to reach them.",
  },
  {
    icon: Lightbulb,
    color: "text-yellow-600 bg-yellow-50",
    title: "The Tools Are Ready",
    body: "The technology to read photos and check written reports is now reliable enough to help sort real concerns from fake ones.",
  },
]

export function WhyNowSection() {
  return (
    <section id="why-now" className={`relative overflow-hidden bg-white ${SECTION_PADDING}`}>
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto mb-16 max-w-4xl text-center">
          <ParallaxText
            as="h2"
            speed={1}
            className="mb-6 font-heading text-3xl font-bold text-[#020c4e] md:text-5xl"
          >
            Why the Barangay Is Going Online
          </ParallaxText>
          <ParallaxText
            as="p"
            speed={0.7}
            className="mx-auto max-w-3xl text-lg leading-relaxed text-gray-600"
          >
            Four things are coming together at the same time, and a simple online platform is the
            answer to all of them.
          </ParallaxText>
        </Reveal>

        <div className="mb-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SHIFTS.map((shift, i) => (
            <Reveal key={shift.title} delay={i * 100}>
              <div className="h-full rounded-2xl border border-border bg-white p-6 transition-all duration-300 hover:-translate-y-1">
                <div
                  className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${shift.color}`}
                >
                  <shift.icon className="size-6" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[#020c4e]">{shift.title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{shift.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={200}>
          <div className="relative overflow-hidden rounded-3xl bg-[#020c4e] p-8 text-center text-white md:p-12">
            <div className="relative z-10 mx-auto max-w-3xl">
              <p className="text-xl font-medium leading-relaxed text-white md:text-2xl">
                <span className="text-center">
                  Taking part in the barangay can now happen anytime, even beyond office hours.
                </span>{" "}
                <span className="text-white/80">
                  E-Boses gives every resident a clear voice they can follow.
                </span>
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
