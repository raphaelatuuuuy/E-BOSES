import { type FormEvent } from "react"
import { toast } from "sonner"

import { Reveal, SECTION_PADDING } from "./ui-bits"

const INPUT_CLASS =
  "h-9 w-full min-w-0 rounded-full border border-gray-200 bg-transparent px-3 py-1 text-base outline-none transition-[color,box-shadow] placeholder:text-gray-400 focus-visible:border-[#ff8133] focus-visible:ring-[3px] focus-visible:ring-[#ff8133]/30 md:text-sm"

export function ContactSection() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.currentTarget.reset()
    toast.success("Message sent", {
      description: "Thanks for reaching out. The team will get back to you soon.",
    })
  }

  return (
    <section id="contact" className={`bg-white ${SECTION_PADDING}`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto mb-12 max-w-3xl text-center">
          <h2 className="mb-6 font-heading text-3xl font-bold text-[#020c4e] md:text-5xl">
            Contact Us
          </h2>
          <p className="text-xl text-gray-600">Have questions about E-Boses? We&rsquo;re here to help.</p>
        </Reveal>

        <Reveal delay={150}>
          <div className="mx-auto max-w-2xl rounded-[32px] border border-border bg-white p-8 md:p-12">
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="contact-name" className="text-sm font-medium leading-none">
                    Name
                  </label>
                  <input id="contact-name" name="name" placeholder="Full Name" className={INPUT_CLASS} />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="contact-email" className="text-sm font-medium leading-none">
                    Email
                  </label>
                  <input
                    id="contact-email"
                    name="email"
                    type="email"
                    placeholder="email@example.com"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <label htmlFor="contact-subject" className="text-sm font-medium leading-none">
                  Subject
                </label>
                <input
                  id="contact-subject"
                  name="subject"
                  placeholder="What is this about?"
                  className={INPUT_CLASS}
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="contact-message" className="text-sm font-medium leading-none">
                  Message
                </label>
                <textarea
                  id="contact-message"
                  name="message"
                  placeholder="Your message..."
                  className="min-h-[120px] w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base transition-all placeholder:text-gray-400 focus:border-[#ff8133] focus:outline-none focus:ring-2 focus:ring-[#ff8133]/20"
                />
              </div>
              <button
                type="submit"
                disabled
                className="mt-4 inline-flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#ff8133]/50 px-6 text-base font-medium text-white/70"
              >
                Send Message
              </button>
            </form>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
