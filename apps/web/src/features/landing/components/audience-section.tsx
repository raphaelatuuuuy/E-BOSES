import { Bank, GearSix, Heartbeat, Users } from "@phosphor-icons/react"

import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const ROLES = [
  {
    icon: Users,
    color: "text-emerald-600 bg-emerald-50",
    title: "Residents",
    body: "Send concerns, raise emergency alerts, support issues near them, and follow every report until it is resolved.",
  },
  {
    icon: Bank,
    color: "text-blue-600 bg-blue-50",
    title: "Barangay Officials",
    body: "See checked reports, how serious each one is, and what needs attention first, all on one dashboard.",
  },
  {
    icon: Heartbeat,
    color: "text-orange-600 bg-orange-50",
    title: "Tanods and Health Workers",
    body: "Get emergency alerts with the exact location and post updates from the field as they respond.",
  },
  {
    icon: GearSix,
    color: "text-purple-600 bg-purple-50",
    title: "System Administrators",
    body: "Manage accounts, settings, records, and data privacy across the whole platform.",
  },
]

export function AudienceSection() {
  return (
    <section id="who-its-for" className={`relative overflow-hidden bg-gray-50 ${SECTION_PADDING}`}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, black 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto mb-16 max-w-4xl text-center">
          <ParallaxText
            as="h2"
            speed={1}
            className="mb-6 font-heading text-3xl font-bold leading-tight text-[#020c4e] md:text-5xl"
          >
            Made for the People Who Keep the Barangay Running
          </ParallaxText>
          <ParallaxText
            as="p"
            speed={0.7}
            className="mx-auto max-w-3xl text-lg leading-relaxed text-gray-600"
          >
            Four roles, one platform. Each one sees exactly what they need, and nothing they do
            not.
          </ParallaxText>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role, i) => (
            <Reveal key={role.title} delay={i * 100}>
              <div className="h-full rounded-2xl border border-border bg-white p-6 transition-all duration-300 hover:-translate-y-1">
                <div
                  className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${role.color}`}
                >
                  <role.icon className="size-6" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[#020c4e]">{role.title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">{role.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
