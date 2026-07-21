import { Camera, Scan, Siren } from "@phosphor-icons/react"

import { PlaceholderImage } from "./placeholder-image"
import { Reveal, SECTION_PADDING } from "./ui-bits"

const STEPS = [
  {
    icon: Camera,
    step: "Step 01",
    title: "Report with Proof",
    body: "Add a photo, a short description, and your location using a simple form. No more logbooks, repeated phone calls, or lost complaints.",
    hasPhoto: true,
  },
  {
    icon: Scan,
    step: "Step 02",
    title: "The System Checks It",
    body: "The photo is reviewed to estimate how serious the problem is, and the description is checked to filter out fake or unrelated reports.",
    hasPhoto: true,
  },
  {
    icon: Siren,
    step: "Step 03",
    title: "Sent, Answered, Resolved",
    body: "Valid concerns reach the officials on their dashboard, while emergency alerts go straight to responders with your exact location.",
    hasPhoto: false,
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className={`relative overflow-hidden bg-gray-50 ${SECTION_PADDING}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-full w-full bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"
      />
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-16 text-center">
          <h2 className="mb-6 font-heading text-3xl font-bold text-[#020c4e] md:text-5xl">
            One Platform. Two Clear Paths.
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-gray-600">
            Everyday concerns are checked, sorted, and reviewed. Emergency alerts skip the line and
            reach responders right away.
          </p>
        </Reveal>

        <div className="mx-auto max-w-6xl">
          <div className="relative">
            <div
              aria-hidden="true"
              className="absolute top-[60px] left-0 hidden h-0.5 w-full border-t-2 border-dashed border-gray-200 lg:block"
            />
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <Reveal key={step.step} delay={i * 120} className="relative pt-4">
                  <div className="group relative h-full pt-4">
                    {step.hasPhoto && (
                      <div className="absolute -top-2 -left-2 z-20 size-24 overflow-hidden rounded-full shadow-xl shadow-black/10 ring-4 ring-white transition-transform duration-500 group-hover:scale-110 md:size-28">
                        <PlaceholderImage label={step.step} iconClassName="size-6" />
                      </div>
                    )}
                    <div className="flex h-full flex-col rounded-[32px] border border-border bg-white p-8 transition-all duration-300 hover:-translate-y-2">
                      <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8133]/10 text-[#ff5003] transition-colors duration-300 group-hover:bg-[#ff8133] group-hover:text-white md:mx-0 md:ml-auto">
                        <step.icon className="size-6" />
                      </div>
                      <div className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-[#ff5003] md:text-left">
                        {step.step}
                      </div>
                      <h3 className="mb-3 text-center text-xl font-bold text-[#020c4e] md:text-left">
                        {step.title}
                      </h3>
                      <p className="flex-grow text-center text-base leading-relaxed text-gray-500 md:text-left">
                        {step.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
