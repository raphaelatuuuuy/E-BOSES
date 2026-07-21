import { useState } from "react"
import { PlaceholderImage } from "./placeholder-image"
import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const MODULES = [
  {
    tag: "Reporting",
    title: "Report a Concern",
    body: "Send a photo, a short description, and your location. Each report gets an official tracking number so you can follow it from the moment you send it until it is fixed.",
  },
  {
    tag: "Emergency",
    title: "Emergency Alert",
    body: "One tap sends an alert with your location straight to tanods and health workers on duty, while nearby residents are notified so they can help.",
  },
  {
    tag: "Checking",
    title: "The System Checks It",
    body: "Every report is reviewed by the system to estimate how serious the problem is and to filter out fake or unrelated submissions before it reaches officials.",
  },
]

export function PlatformSection() {
  const [active, setActive] = useState(0)

  return (
    <section id="features" className={`bg-white ${SECTION_PADDING}`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-16 flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div className="max-w-3xl">
            <ParallaxText
              as="h2"
              speed={1}
              className="mb-6 font-heading text-3xl font-bold leading-tight text-[#020c4e] md:text-5xl"
            >
              Everyday concerns and emergencies, handled in one place.
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="max-w-2xl font-sans text-lg text-gray-600">
              E-Boses keeps everyday concerns separate from emergencies. Each one has its own
              clear path, from sending it in to getting a response and seeing it resolved.
            </ParallaxText>
          </div>
          <div className="hidden gap-2 md:flex" aria-hidden="true">
            {MODULES.map((mod, i) => (
              <div
                key={mod.tag}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: i === active ? "32px" : "8px",
                  backgroundColor: i === active ? "#ff8133" : "#e5e7eb",
                }}
              />
            ))}
          </div>
        </Reveal>

        <Reveal delay={150}>
          <div className="flex h-[800px] flex-col gap-4 lg:h-[500px] lg:flex-row">
            {MODULES.map((mod, i) => {
              const isActive = i === active
              return (
                <div
                  key={mod.tag}
                  role="button"
                  tabIndex={0}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className="group relative cursor-pointer overflow-hidden rounded-[32px] bg-gray-900 transition-all duration-500"
                  style={{ flex: isActive ? 3.5 : 1, opacity: isActive ? 1 : 0.7 }}
                >
                  <div className="absolute inset-0">
                    <PlaceholderImage tone="dark" label={mod.tag} iconClassName="size-12" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-black/80" />
                  <div className="absolute top-6 left-6 z-10 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-white backdrop-blur-md">
                    {mod.tag}
                  </div>
                  <div className="absolute bottom-0 left-0 z-10 flex h-full w-full flex-col justify-end p-6 md:p-8">
                    <div>
                      <h3
                        className={`mb-2 font-bold text-white transition-all duration-300 origin-bottom-left ${
                          isActive
                            ? "text-2xl md:text-3xl"
                            : "text-xl lg:absolute lg:bottom-12 lg:left-8 lg:-rotate-90 lg:whitespace-nowrap lg:translate-x-1/2"
                        }`}
                      >
                        {mod.title}
                      </h3>
                      {isActive && (
                        <p className="max-w-lg font-sans text-base leading-relaxed text-gray-300 md:text-lg">
                          {mod.body}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Reveal>
      </div>
    </section>
  )
}
