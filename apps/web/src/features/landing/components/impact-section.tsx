import { Reveal } from "./ui-bits"

const CAPABILITIES = [
  ["Report from anywhere", "Send a concern without making an extra trip to the barangay hall"],
  ["Know what happens next", "Check who is handling your report and see each dated update"],
  ["Share urgent details quickly", "Give officials and responders the information and location they need"],
] as const

export function ImpactSection() {
  return (
    <section id="impact" className="scroll-mt-24 bg-[#020c4e] px-5 py-20 text-white md:px-10 md:py-28 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <Reveal className="grid gap-8 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 className="text-wrap-balance font-heading text-4xl font-bold leading-tight md:text-6xl">Practical benefits for residents.</h2>
          </div>
          <div className="self-end text-lg leading-relaxed text-white/75">
            <p>Report without another trip to the barangay hall, follow the response online, and share useful details when help is urgent.</p>
            <a href="#contact" className="mt-6 inline-flex min-h-12 items-center font-semibold text-white underline decoration-[#ff8133] decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">View official contact options</a>
          </div>
        </Reveal>
        <dl className="mt-12 grid border-y border-white/25 md:mt-16 md:grid-cols-3">
          {CAPABILITIES.map(([value, label]) => (
            <div key={label} className="border-b border-white/25 py-9 md:border-b-0 md:border-r md:px-9 md:first:pl-0 md:last:border-0">
              <dt className="max-w-xs text-base leading-relaxed text-white/75">{label}</dt>
              <dd className="mt-3 text-3xl font-bold text-[#ffb37f] md:text-4xl">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
