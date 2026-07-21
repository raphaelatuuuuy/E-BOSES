import { Reveal } from "./ui-bits"

const STEPS = [
  {
    title: "Send your report",
    label: "Submitted",
    body: "Add a photo, a short description, and the location of the concern.",
  },
  {
    title: "See when it is reviewed",
    label: "Received",
    body: "The barangay confirms that your report arrived and sends it to the right office or responder.",
  },
  {
    title: "See who is handling it",
    label: "Assigned",
    body: "Your report shows who is responsible and includes each dated status update.",
  },
  {
    title: "See how it was resolved",
    label: "Resolved",
    body: "The final update records the action taken and the date the report was completed.",
  },
] as const

export function PlatformSection() {
  return (
    <section id="features" className="scroll-mt-24 bg-white px-5 py-24 md:px-10 md:py-32 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <Reveal className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:gap-16">
          <div>
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.18em] text-[#ff5003]">How E-Boses works</p>
            <h2 className="font-heading text-4xl font-bold leading-tight text-[#020c4e] md:text-6xl">
              Follow a community report from submission to resolution.
            </h2>
          </div>
          <p className="max-w-xl text-lg leading-relaxed text-gray-600">
            Community concerns move through a clear review process. Emergency alerts take a separate, faster path to officials and responders.
          </p>
        </Reveal>

        <div id="how-it-works" className="mt-14 scroll-mt-24 lg:grid lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <aside className="hidden lg:block">
            <div className="sticky top-28 border-l-4 border-[#ff5003] bg-[#020c4e] p-8 text-white">
              <p className="text-base font-semibold text-[#ffb37f]">Your report history</p>
              <p className="mt-5 text-3xl font-bold">Every update stays with your report.</p>
              <p className="mt-4 leading-relaxed text-white/75">
                Submission, assignment, action, and resolution appear on one dated timeline, so you can check progress without calling or visiting again.
              </p>
            </div>
          </aside>

          <ol className="border-t border-[#020c4e]/20">
            {STEPS.map((step, index) => (
              <li key={step.label} className="border-b border-[#020c4e]/20 py-8 md:py-10">
                <Reveal delay={index * 50} className="grid gap-4 sm:grid-cols-[5rem_1fr] sm:gap-8">
                  <div className="flex items-center gap-3 sm:block">
                    <span className="font-mono text-sm text-[#ff5003]">0{index + 1}</span>
                    <span className="ml-3 text-sm font-semibold text-[#020c4e]/60 sm:ml-0 sm:mt-2 sm:block">{step.label}</span>
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-[#020c4e] md:text-4xl">{step.title}</h3>
                    <p className="mt-3 max-w-xl text-base leading-relaxed text-gray-600 md:text-lg">{step.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
