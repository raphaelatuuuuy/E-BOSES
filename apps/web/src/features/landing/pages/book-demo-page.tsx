import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "lucide-react"

import { apiRequest } from "@/lib/api"
import {
  EMAIL_PATTERN,
  LandingPageShell,
} from "../components/landing-page-shell"

const AUDIENCES = [
  ["apartment", "Barangay officials", "Configuration hub, verification queue, and audit trail."],
  ["crisis_alert", "First responders", "Dispatch, live location, and shift handover."],
  ["groups", "Residents' associations", "Reports, alerts, and announcements reach members."],
] as const

const SLOTS = [
  ["09:00", "9:00 AM"],
  ["10:00", "10:00 AM"],
  ["11:00", "11:00 AM"],
  ["13:00", "1:00 PM"],
  ["14:00", "2:00 PM"],
  ["15:00", "3:00 PM"],
  ["16:00", "4:00 PM"],
] as const

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

const MONTH_FORMAT = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric" })
const DAY_FORMAT = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric" })

function pad(value: number) {
  return String(value).padStart(2, "0")
}

const SQUARE_FIELD =
  "min-h-12 w-full rounded-none border border-white/15 bg-white/[0.04] px-4 text-sm text-landing-cream placeholder:text-white/40 transition-colors focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

const SQUARE_LABEL = "mb-2 block text-xs font-medium text-white/50"

function TimeSlotDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = SLOTS.find(([v]) => v === value)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${SQUARE_FIELD} flex items-center justify-between pr-10 text-left`}
      >
        <span className={selected ? "text-landing-cream" : "text-white/40"}>
          {selected ? selected[1] : "Select a time…"}
        </span>
        <ChevronDownIcon
          className={`pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-white/50 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 border border-white/15 bg-landing-bg shadow-xl">
          {SLOTS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => { onChange(v); setOpen(false) }}
              className={`block w-full px-4 py-3 text-left text-sm transition-colors ${v === value ? "bg-accent text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function BookDemoPage() {
  const today = useMemo(() => {
    const now = new Date()
    now.setHours(0, 0, 0, 0)
    return now
  }, [])

  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [slot, setSlot] = useState("")
  const [form, setForm] = useState({ name: "", email: "", organization: "", role: "", message: "" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const lead: (Date | null)[] = Array.from({ length: first.getDay() }, () => null)
    return lead.concat(
      Array.from({ length: total }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
    )
  }, [month])

  const atFirstMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()

  const shiftMonth = (delta: number) =>
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1))

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      setError("Enter a valid email address so we can reply.")
      return
    }
    if (!selectedDay || !slot) {
      setError("Pick a date and a time slot for the demo.")
      return
    }
    setError("")
    setPending(true)
    try {
      const preferred = `${selectedDay.getFullYear()}-${pad(selectedDay.getMonth() + 1)}-${pad(selectedDay.getDate())}T${slot}:00+08:00`
      await apiRequest(
        "/public/community-requests/",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "demo",
            name: form.name.trim(),
            email: form.email.trim(),
            organization: form.organization.trim(),
            role: form.role.trim(),
            message: form.message.trim(),
            preferred_date: preferred,
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
      <section className="mx-auto max-w-5xl px-5 pb-24 pt-12 md:px-10 lg:px-16 lg:pt-20">
        {/* ── header ── */}
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-heading text-[clamp(2.5rem,6vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.02em]">
            See <span className="text-accent">E-Boses</span> in action.
          </h1>
          <p className="mx-auto mt-5 max-w-lg leading-relaxed text-white/60">
            Reporting, emergency alerts, dispatch, and configuration — a walkthrough using your community.
          </p>
        </div>

        {/* ── features row ── */}
        <div className="mt-14 grid gap-10 sm:grid-cols-3">
          {AUDIENCES.map(([name, title, body]) => (
            <div key={title} className="flex flex-col items-center gap-4 text-center">
              <span
                aria-hidden
                className="material-symbols-outlined select-none transition-all duration-300"
                style={{
                  color: "var(--color-brand-orange)",
                  fontSize: "56px",
                  lineHeight: 1,
                  textShadow: "0 0 14px rgba(255,106,26,0.5), 0 0 32px rgba(255,106,26,0.2)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.textShadow = "0 0 18px rgba(255,106,26,0.85), 0 0 44px rgba(255,106,26,0.45), 0 0 64px rgba(255,106,26,0.15)"
                  e.currentTarget.style.transform = "scale(1.1)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.textShadow = "0 0 14px rgba(255,106,26,0.5), 0 0 32px rgba(255,106,26,0.2)"
                  e.currentTarget.style.transform = "scale(1)"
                }}
              >
                {name}
              </span>
              <div>
                <p className="font-semibold text-landing-cream">{title}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {sent ? (
          <div className="mx-auto mt-16 flex max-w-md flex-col items-start gap-4 py-8">
            <CheckCircle2Icon className="size-10 text-accent" strokeWidth={1.5} aria-hidden />
            <h2 className="font-heading text-2xl font-bold">Demo request received</h2>
            <p className="max-w-sm leading-relaxed text-white/60">
              We will email you back from{" "}
              <a className="font-semibold text-primary underline underline-offset-4" href="mailto:eboses@gmail.com">
                eboses@gmail.com
              </a>{" "}
              to confirm your slot.
            </p>
          </div>
        ) : (
          /* ── form + calendar ── */
          <form onSubmit={onSubmit} noValidate className="mt-14 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            {/* left: info text + form fields */}
            <div className="min-w-0 space-y-5">
              <p className="max-w-md text-sm leading-relaxed text-white/60">
                Fill in your information.
              </p>
              <div>
                <label className={SQUARE_LABEL} htmlFor="bd-email">Email</label>
                <input id="bd-email" type="email" className={SQUARE_FIELD} value={form.email} onChange={set("email")} autoComplete="email" placeholder="you@example.com" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="bd-org">Organization</label>
                <input id="bd-org" className={SQUARE_FIELD} value={form.organization} onChange={set("organization")} autoComplete="organization" placeholder="Barangay Bagong Silang" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="bd-role">Role</label>
                <input id="bd-role" className={SQUARE_FIELD} value={form.role} onChange={set("role")} autoComplete="organization-title" placeholder="e.g. Barangay Captain" required />
              </div>
              <div>
                <label className={SQUARE_LABEL} htmlFor="bd-message">Message</label>
                <textarea id="bd-message" rows={4} className={`${SQUARE_FIELD} resize-y py-3 [&::-webkit-resizer]:hidden`} value={form.message} onChange={set("message")} placeholder="Tell us about your community…" />
              </div>
              {error && <p role="alert" className="text-sm text-primary">{error}</p>}
              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-12 items-center gap-2 rounded-none bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Sending…" : "Send request"}
                {!pending && <ArrowRightIcon className="size-4" strokeWidth={2} aria-hidden />}
              </button>
            </div>

            {/* right: calendar + time dropdown */}
            <div className="min-w-0 space-y-6 rounded-none p-6 md:p-8">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    disabled={atFirstMonth}
                    aria-label="Previous month"
                    className="flex size-9 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <ChevronLeftIcon className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                  <p aria-live="polite" className="text-sm font-semibold text-landing-cream">
                    {MONTH_FORMAT.format(month)}
                  </p>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    aria-label="Next month"
                    className="flex size-9 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <ChevronRightIcon className="size-4" strokeWidth={2} aria-hidden />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAYS.map((day) => (
                    <span key={day} className="py-1 font-mono text-[10px] uppercase tracking-[0.15em] text-white/35">
                      {day}
                    </span>
                  ))}
                  {cells.map((day, index) => {
                    if (!day) return <span key={`pad-${index}`} aria-hidden />
                    const past = day.getTime() < today.getTime()
                    const active = selectedDay?.getTime() === day.getTime()
                    return (
                      <button
                        key={day.toISOString()}
                        type="button"
                        disabled={past}
                        aria-pressed={active}
                        onClick={() => setSelectedDay(day)}
                        className={`flex h-10 items-center justify-center rounded-none text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-white/20 ${active ? "bg-accent font-semibold text-white" : "text-white/75 hover:bg-white/10"}`}
                      >
                        {day.getDate()}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className={SQUARE_LABEL}>Time slot</label>
                <TimeSlotDropdown value={slot} onChange={setSlot} />
                <p className="mt-3 flex items-center gap-2 text-xs text-white/45">
                  <ClockIcon className="size-3.5" strokeWidth={1.5} aria-hidden />
                  Philippine Time (GMT+8)
                  {selectedDay && slot ? ` · ${DAY_FORMAT.format(selectedDay)}` : ""}
                </p>
              </div>
            </div>
          </form>
        )}
      </section>
    </LandingPageShell>
  )
}
