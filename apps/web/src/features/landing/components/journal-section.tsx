import { ArrowRight } from "@phosphor-icons/react"

import { PlaceholderImage } from "./placeholder-image"
import { ParallaxText, Reveal, SECTION_PADDING } from "./ui-bits"

const ARTICLES = [
  {
    kind: "Guide",
    minutes: 4,
    title: "How to File a Barangay Concern That Gets Action",
    excerpt:
      "A good report has three things: a clear photo, the right location, and a simple description. Here is how the form helps you get all three, and how the tracking number keeps the barangay accountable.",
  },
  {
    kind: "Guide",
    minutes: 6,
    title: "What Happens After You Press the Emergency Button",
    excerpt:
      "From the moment you confirm to the moment help arrives: how your alert reaches tanods and health workers on duty, why nearby residents are notified, and what the response looks like.",
  },
  {
    kind: "Explainer",
    minutes: 5,
    title: "How the System Checks Your Report",
    excerpt:
      "Every report is looked at twice. One check reads the photo to estimate how serious the problem is, and the other reads your description to filter out fake or unrelated reports. Here is what each one does, and what it does not decide.",
  },
]

export function JournalSection() {
  return (
    <section id="journal" className={`bg-white ${SECTION_PADDING}`} aria-labelledby="journal-heading">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mb-2 flex flex-col items-start gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <ParallaxText
              as="h2"
              id="journal-heading"
              speed={1}
              className="font-heading text-3xl font-bold leading-tight text-[#020c4e] sm:text-4xl lg:text-5xl"
            >
              Your guide to <span className="italic text-[#ff5003]">the system.</span>
            </ParallaxText>
            <ParallaxText as="p" speed={0.7} className="mt-3 text-lg text-gray-600">
              Learn how E-Boses works from filing reports to tracking responses.
              <br />
              Step-by-step guides to help you navigate the platform.
            </ParallaxText>
          </div>
          <a
            href="#journal"
            className="inline-flex h-9 items-center justify-center gap-2 self-start whitespace-nowrap rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 lg:self-auto"
          >
            See all guides
            <ArrowRight className="size-4" />
          </a>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {ARTICLES.map((article, i) => (
            <Reveal key={article.title} delay={i * 100}>
              <article className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition hover:border-[#ff8133]/40 hover:shadow-md">
                <div className="aspect-[16/10] w-full overflow-hidden bg-gradient-to-br from-[#ff8133]/80 to-[#ff5003]">
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
                    <PlaceholderImage tone="navy" label={article.kind} />
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#ff5003]">
                    {article.kind} · {article.minutes} min
                  </div>
                  <h3 className="mt-2 font-heading text-lg font-semibold leading-snug text-[#020c4e] group-hover:text-[#ff5003]">
                    {article.title}
                  </h3>
                  <p className="mt-2 line-clamp-3 flex-1 text-sm text-gray-600">{article.excerpt}</p>
                  <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#ff5003]">
                    Read article
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
