import { Reveal } from "./ui-bits"

const PEOPLE = [
  ["Residents", "Report local concerns, send emergency alerts, and check updates."],
  ["Barangay staff", "Review reports, prioritize alerts, and keep residents informed."],
  ["Responders", "Receive emergency details and locations before responding."],
] as const

export function CommunitySection() {
  return (
    <section id="community" className="scroll-mt-24 overflow-hidden bg-[#ff6a1a] px-5 py-16 text-[#020c4e] md:px-10 md:py-20 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-4xl">
          <p className="text-wrap-balance font-heading text-4xl font-bold leading-tight md:text-6xl">Built for every role in the community.</p>
        </Reveal>
        <div className="mt-12 grid border-y border-[#020c4e]/30 md:grid-cols-3">
          {PEOPLE.map(([title, body], index) => (
            <Reveal key={title} delay={index * 80} className="border-b border-[#020c4e]/30 py-8 md:border-b-0 md:border-r md:px-8 md:first:pl-0 md:last:border-0">
              <h3 className="text-2xl font-bold">{title}</h3>
              <p className="mt-3 leading-relaxed text-[#020c4e]/80">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
