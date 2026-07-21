import { MapPin, Phone } from "@phosphor-icons/react"

const CONTACT_OPTIONS = [
  {
    icon: Phone,
    title: "Emergency help",
    body: "For urgent medical, fire, or safety assistance, call the Marikina City emergency hotline.",
    action: "Call 161",
    href: "tel:161",
  },
  {
    icon: MapPin,
    title: "Visit the barangay hall",
    body: "For in-person questions and concerns, visit the Barangay Marikina Heights office.",
    action: "Barangay Hall, Marikina Heights",
    href: "https://www.google.com/maps/search/?api=1&query=Barangay+Hall+Marikina+Heights+Marikina+City",
  },
] as const

export function ContactSection() {
  return (
    <section id="contact" className="scroll-mt-24 bg-white px-5 py-16 md:px-10 md:py-24 lg:px-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <h2 className="text-wrap-balance font-heading text-4xl font-bold leading-tight text-[#020c4e] md:text-5xl">
              Emergency help and contact options
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-gray-700">
              E-Boses can send emergency alerts to barangay officials and responders. If someone is in immediate danger, call 161 directly. Visit the barangay hall for in-person assistance.
            </p>
          </div>

          <div id="emergency-help" className="scroll-mt-24 border-t border-[#020c4e]/20">
            {CONTACT_OPTIONS.map(({ icon: Icon, title, body, action, href }) => (
              <div key={title} className="grid gap-5 border-b border-[#020c4e]/20 py-7 sm:grid-cols-[3rem_1fr]">
                <span className="flex size-11 items-center justify-center rounded-full bg-[#020c4e] text-white" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="text-xl font-bold text-[#020c4e]">{title}</h3>
                  <p className="mt-2 max-w-xl leading-relaxed text-gray-700">{body}</p>
                  <a
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel={href.startsWith("http") ? "noreferrer" : undefined}
                    className="mt-4 inline-flex min-h-11 items-center font-semibold text-[#c93f00] underline decoration-[#ff8133] decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#020c4e]"
                  >
                    {action}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
