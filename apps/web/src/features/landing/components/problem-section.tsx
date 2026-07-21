import { Reveal } from "./ui-bits"

const PRESSURES = [
  ["Paper records", "Reports can be difficult to find, review, and track over time."],
  ["No visible progress", "Residents must call or return to the hall to ask for an update."],
  ["Limited access", "Older adults, people with disabilities, and working residents cannot always visit in person."],
  ["Missing locations", "Calls and radio messages may not include the exact location responders need."],
] as const

export function ProblemSection() {
  return (
    <section id="about" className="scroll-mt-24 bg-[#f4f3ef] px-5 py-20 md:px-10 md:py-28 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <Reveal className="max-w-5xl">
          <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#ff5003]">How E-Boses helps</p>
          <h2 className="text-wrap-balance font-heading text-4xl font-bold leading-tight text-[#020c4e] md:text-6xl">
            A simpler way to report local concerns and follow what happens next.
          </h2>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-gray-700">
            E-Boses gives Marikina Heights residents one place for community concerns and emergency
            alerts. Barangay staff can manage reports, while responders receive urgent details and
            locations without replacing the people who serve the community.
          </p>
        </Reveal>
        <div className="mt-16 border-y border-[#020c4e]/20">
          {PRESSURES.map(([title, body], index) => (
            <Reveal key={title} delay={index * 60} className="grid gap-3 border-b border-[#020c4e]/15 py-7 last:border-0 md:grid-cols-[4rem_1fr_1.4fr] md:items-center">
              <span className="font-mono text-sm text-[#ff5003]">0{index + 1}</span>
              <h3 className="text-xl font-bold text-[#020c4e]">{title}</h3>
              <p className="text-gray-600">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
