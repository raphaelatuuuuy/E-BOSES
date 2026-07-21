import { Reveal } from "./ui-bits"

const PROBLEMS = [
  {
    title: "Paper Logbook Records",
    image: "/contents/logbook.png",
    body: "Complaints are handwritten into logbooks, kept in cabinets, and thrown out after ten years. They are slow to find and easy to lose.",
  },
  {
    title: "No Tracking or Feedback",
    image: "/contents/tracking.png",
    body: "Residents only get updates by visiting the hall or calling again. There is no way to know if a report was received, acted on, or resolved.",
  },
  {
    title: "Left Out Residents",
    image: "/contents/elder.png",
    body: "Elderly residents, PWDs, and working adults cannot always attend assemblies or visit during office hours, so their concerns go unrecorded.",
  },
  {
    title: "Scattered Emergency Contact",
    image: "/contents/emergency.png",
    body: "Emergencies rely on phone calls, radios, and word of mouth. Responders get no exact location, and nearby residents are never alerted.",
  },
]

export function ProblemSection() {
  return (
    <section id="about" className="relative overflow-hidden bg-gray-50 pt-6 pb-16 md:px-12 md:pt-10 md:pb-24 lg:px-20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, black 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto mb-12 max-w-4xl text-center">
          <h2 className="mb-6 font-heading text-3xl font-bold text-[#020c4e] md:text-5xl">
            Barangay Reporting Still Runs on
            <br />
            <span className="text-[#ff5003]">Visits, Calls, and Logbooks</span>
          </h2>
          <p className="mx-auto max-w-3xl text-lg leading-relaxed text-gray-600">
            Residents of Marikina Heights report concerns by visiting the barangay hall or calling
            a hotline. Complaints are written into logbooks with no way to follow them, and
            emergencies depend on whoever happens to be nearby.
          </p>
          <div className="mx-auto mt-8 h-1 w-20 rounded-full bg-[#ff8133]" />
        </Reveal>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEMS.map((problem, i) => (
            <Reveal key={problem.title} delay={i * 100}>
              <div className="h-full rounded-2xl border border-border bg-white p-6 transition-all duration-300 hover:-translate-y-1">
                <div className="relative -mx-6 -mt-6 mb-5 h-48 overflow-hidden rounded-t-2xl bg-gray-50">
                  <img
                    src={problem.image}
                    alt={problem.title}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[10%] bg-gradient-to-b from-transparent to-white"
                  />
                </div>
                <h3 className="mb-2 text-lg font-bold text-[#020c4e]">{problem.title}</h3>
                <p className="font-sans text-sm leading-relaxed text-gray-600">{problem.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
