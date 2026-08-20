import { useState, type FormEvent } from "react"
import { ArrowRightIcon, CheckCircle2Icon, MegaphoneIcon, ShieldCheckIcon, UsersRoundIcon } from "lucide-react"

import { apiRequest } from "@/lib/api"
import { EMAIL_PATTERN, LandingPageShell } from "../components/landing-page-shell"

const BENEFITS = [
  [UsersRoundIcon, "One place for your residents", "Reports, emergency alerts, and announcements stop living in scattered chat groups."],
  [MegaphoneIcon, "Routing that matches your offices", "Categories, units, and responders are configured to how your community already works."],
  [ShieldCheckIcon, "Verified accounts only", "ID checks and role permissions keep the feed accountable, not anonymous."],
] as const

const SQUARE_FIELD =
  "min-h-12 w-full rounded-none border border-white/15 bg-white/[0.04] px-4 text-sm text-landing-cream placeholder:text-white/40 transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

const SQUARE_LABEL = "mb-2 block text-xs font-medium text-white/50"

export default function CreateCommunityPage() {
  const [form, setForm] = useState({ name: "", email: "", organization: "", role: "", message: "" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      setError("Enter a valid email address so we can reply.")
      return
    }
    setError("")
    setPending(true)
    try {
      await apiRequest(
        "/public/community-requests/",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "community",
            name: form.name.trim(),
            email: form.email.trim(),
            organization: form.organization.trim(),
            role: form.role.trim(),
            message: form.message.trim(),
          }),
        },
        { auth: false, csrf: true, refreshOnUnauthorized: false },
      )
      setSent(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not send your request. Try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <LandingPageShell>
      <section className="mx-auto grid max-w-7xl gap-14 px-5 pb-24 pt-12 md:px-10 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-20 lg:px-16 lg:pt-20">
        <div className="min-w-0">
          <h1 className="font-heading text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">
            Bring <span className="text-accent">E-Boses</span> to your barangay.
          </h1>
          <p className="mt-5 max-w-lg leading-relaxed text-white/60">
            Tell us about your community and we&apos;ll give you a workspace you can set up your own way.
          </p>

          <ul className="mt-10 space-y-7">
            {BENEFITS.map(([Icon, title, body]) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center">
                  <Icon className="size-9 text-accent drop-shadow-[0_0_12px_rgba(255,80,3,0.65)]" strokeWidth={1.5} aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-landing-cream">{title}</p>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-white/55">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          {sent ? (
            <div className="flex flex-col items-start gap-4 py-8">
              <CheckCircle2Icon className="size-10 text-accent" strokeWidth={1.5} aria-hidden />
              <h2 className="font-heading text-2xl font-bold">Request received</h2>
              <p className="max-w-sm leading-relaxed text-white/60">
                We will email you back from{" "}
                <a className="font-semibold text-primary underline underline-offset-4" href="mailto:eboses@gmail.com">
                  eboses@gmail.com
                </a>{" "}
                with the next steps for setting up your community.
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <p className="mb-4 max-w-md text-base leading-relaxed text-white/70">
                Send us a message so we can get started, and we will help you set up your community
                the way you want it to be.
              </p>
              <div>
                <label className={SQUARE_LABEL} htmlFor="cc-name">Name</label>
                <input id="cc-name" className={SQUARE_FIELD} value={form.name} onChange={set("name")} autoComplete="name" placeholder="Juan Dela Cruz" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="cc-email">Email</label>
                <input id="cc-email" type="email" className={SQUARE_FIELD} value={form.email} onChange={set("email")} autoComplete="email" placeholder="you@example.com" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="cc-org">Organization</label>
                <input id="cc-org" className={SQUARE_FIELD} value={form.organization} onChange={set("organization")} autoComplete="organization" placeholder="Barangay Bagong Silang" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="cc-role">Role</label>
                <input id="cc-role" className={SQUARE_FIELD} value={form.role} onChange={set("role")} autoComplete="organization-title" placeholder="e.g. Barangay Captain" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="cc-message">Message</label>
                <textarea
                  id="cc-message"
                  rows={4}
                  className={`${SQUARE_FIELD} resize-y py-3 [&::-webkit-resizer]:hidden`}
                  value={form.message}
                  onChange={set("message")}
                  placeholder="Tell us about your community…"
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-primary">{error}</p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-12 items-center gap-2 rounded-none bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send request"}
                {!pending && <ArrowRightIcon className="size-4" strokeWidth={2} aria-hidden />}
              </button>
            </form>
          )}
        </div>
      </section>
    </LandingPageShell>
  )
}
