import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { ActivityIcon, ChevronRightIcon, ScrollTextIcon } from "lucide-react"

import { apiRequest } from "@/lib/api"
import { cn } from "@workspace/ui/lib/utils"
import { PageSection } from "@/components/ui/page-header"

type ModuleStatus = "operational" | "degraded" | "down" | "not_configured" | "unknown"
type DayStatus = "operational" | "degraded" | "down" | "not_configured" | "no_data"

interface ServiceModule {
  key: string
  label: string
  description: string
  status: ModuleStatus
  message: string
  latency_ms: number
  history: DayEntry[]
  availability: Availability
}

interface DayEntry {
  date: string
  status: DayStatus
  issues: { severity: number; text: string }[]
  checks_total: number
  measured_checks: number
  up_checks: number
  degraded_checks: number
  down_checks: number
  unknown_checks: number
  availability_percent: number | null
}

interface Availability {
  percent: number | null
  measured_checks: number
  up_checks: number
  degraded_checks: number
  down_checks: number
  sample_minutes: number
}

interface ServiceGroup {
  title: string
  modules: ServiceModule[]
  worst: number
  history: DayEntry[]
  availability: Availability
}

interface ServiceStatus {
  headline: string
  worst: number
  checked_at: number
  history_days: number
  groups: ServiceGroup[]
  counts: {
    total: number
    operational: number
    degraded: number
    down: number
    unknown: number
    not_configured: number
  }
}

// A working service says nothing. Only trouble earns a word.
const STATUS_WORD: Partial<Record<ModuleStatus, string>> = {
  degraded: "Slow",
  down: "Not working",
  not_configured: "Not set up",
  unknown: "Not checked",
}

/**
 * Uptime across the days on screen, so the number always answers the range in
 * the header. Days never sampled are left out of both sides of the fraction —
 * counting them as good would invent a track record we do not have.
 */
function availabilityLabel(availability: Availability): string {
  if (availability.percent === null) return "No measured history"
  const rounded = Number.isInteger(availability.percent)
    ? String(availability.percent)
    : availability.percent.toFixed(2)
  return `${rounded}% availability`
}

function groupStatusWord(group: ServiceGroup): string {
  if (group.modules.some((mod) => mod.status === "down")) return "Needs attention"
  if (group.modules.some((mod) => mod.status === "degraded")) return "Running slow"
  if (group.modules.some((mod) => mod.status === "unknown")) return "Not verified"
  if (group.modules.some((mod) => mod.status === "not_configured")) return "Needs setup"
  return ""
}

const WINDOW_DAYS = 90

/* ── Status marks ── */

// Messages share one type style with "No issues." — same size, same weight.
// Only the colour changes, so severity reads at a glance without a badge.
const MESSAGE_TONE: Record<number, string> = {
  0: "text-neutral-500",
  1: "text-neutral-500",
  2: "text-severity-moderate",
  3: "text-sos",
}

function severityOf(status: ModuleStatus): number {
  if (status === "down") return 3
  if (status === "degraded") return 2
  if (status === "operational") return 0
  return 1
}

function StatusMark({ severity, className }: { severity: number; className?: string }) {
  const tone =
    severity >= 3
      ? "bg-sos"
      : severity === 2
        ? "bg-severity-moderate"
        : severity === 1
          ? "bg-neutral-300"
          : "bg-status-closed"

  // Sized in `em` so the mark always matches the line it sits on, and centered
  // on that line rather than pinned to the top of the text block.
  //
  // `text-white` goes last on purpose: this project's font-size tokens are
  // custom, tailwind-merge reads them as colour classes, and anything passed in
  // would otherwise strip the white glyph and leave it inheriting navy.
  return (
    <span
      className={cn(
        "inline-flex size-[1.15em] shrink-0 select-none items-center justify-center self-center rounded-full",
        tone,
        className,
        "text-white",
      )}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-[62%]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {severity >= 3 ? (
          <>
            <path d="M4 4l8 8" />
            <path d="M12 4l-8 8" />
          </>
        ) : severity === 2 ? (
          <>
            <path d="M8 4.5v4" />
            <path d="M8 11.5h.01" />
          </>
        ) : severity === 1 ? (
          <path d="M4.5 8h7" />
        ) : (
          <path d="M3.5 8.5l3 3 6-6.5" />
        )}
      </svg>
    </span>
  )
}


/* ── Timeline ── */

const DAY_BAR_COLOR: Record<DayStatus, string> = {
  operational: "bg-status-closed",
  not_configured: "bg-neutral-300",
  degraded: "bg-severity-moderate",
  down: "bg-sos",
  no_data: "bg-neutral-200",
}
const DAY_BAR_HOVER: Record<DayStatus, string> = {
  operational: "bg-emerald-700",
  not_configured: "bg-neutral-400",
  degraded: "bg-amber-600",
  down: "bg-red-700",
  no_data: "bg-neutral-300",
}

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(y!, (m ?? 1) - 1, d)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function DayTooltip({ day, anchor }: { day: DayEntry; anchor: DOMRect }) {
  // Positioned straight on the node: it lives in a portal, so it is never
  // clipped by the card, and it flips below the bar when the top runs out.
  const place = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      const rect = node.getBoundingClientRect()
      const gap = 8
      const left = Math.min(
        Math.max(8, anchor.left + anchor.width / 2 - rect.width / 2),
        window.innerWidth - rect.width - 8,
      )
      const above = anchor.top - rect.height - gap
      node.style.top = `${above >= 8 ? above : anchor.bottom + gap}px`
      node.style.left = `${left}px`
      node.style.visibility = "visible"
    },
    [anchor],
  )

  return createPortal(
    <div
      ref={place}
      style={{ top: 0, left: 0, visibility: "hidden" }}
      className="pointer-events-none fixed z-[100] w-64 rounded-xl border border-neutral-200 bg-card px-3.5 py-3 shadow-xl"
    >
      <p className="text-meta font-normal text-neutral-500">{formatDay(day.date)}</p>
      {day.status === "no_data" ? (
        <p className="mt-2 text-meta text-neutral-500">No data was recorded on this day.</p>
      ) : day.issues.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {day.issues.map((issue, i) => (
            <li key={i} className="flex items-center gap-2 text-meta">
              <StatusMark severity={issue.severity} />
              <span className={cn("leading-snug", MESSAGE_TONE[issue.severity] ?? "text-neutral-500")}>
                {issue.text}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2 flex items-center gap-2 text-meta">
          <StatusMark severity={0} />
          <span className="leading-snug text-neutral-500">No issues.</span>
        </div>
      )}
    </div>,
    document.body,
  )
}

function StatusBar({ days, className }: { days: DayEntry[]; className?: string }) {
  const [hovered, setHovered] = useState<{ index: number; rect: DOMRect } | null>(null)

  return (
    <div className={cn("flex gap-[2px]", className)} onMouseLeave={() => setHovered(null)}>
      {days.map((day, i) => (
        <span
          key={day.date}
          onMouseEnter={(e) => setHovered({ index: i, rect: e.currentTarget.getBoundingClientRect() })}
          className={cn(
            "h-5 flex-1 cursor-default rounded-[2px] transition-colors duration-100",
            hovered?.index === i ? DAY_BAR_HOVER[day.status] : DAY_BAR_COLOR[day.status],
          )}
        />
      ))}
      {hovered && days[hovered.index] && (
        <DayTooltip key={hovered.index} day={days[hovered.index]!} anchor={hovered.rect} />
      )}
    </div>
  )
}

/* ── Window nav ── */

function windowLabel(days: DayEntry[]): string {
  const measured = days.filter((day) => day.checks_total > 0)
  if (measured.length === 0) return "No measured history"
  const fmt = (iso: string) => {
    const [y, m] = iso.split("-").map(Number)
    return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })
  }
  const first = fmt(measured[0]!.date)
  const last = fmt(measured[measured.length - 1]!.date)
  return first === last ? first : `${first} – ${last}`
}

function checkedLabel(timestamp?: number): string {
  if (!timestamp) return ""
  return `Checked ${new Date(timestamp * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`
}

/* ── Section ── */

function fetchStatus(refresh = false) {
  return apiRequest<ServiceStatus>(`/config/service-status/${refresh ? "?refresh=1" : ""}`)
}

interface AuditStatus {
  status: string | null
  detail: string
  needs_attention: boolean
}

export function ServiceStatusSection() {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [audit, setAudit] = useState<AuditStatus | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [next, summary] = await Promise.all([
          fetchStatus(),
          apiRequest<{ sections: Record<string, AuditStatus> }> 
            ("/config/summary/").catch(() => null),
        ])
        if (alive) {
          setStatus(next)
          setAudit(summary?.sections?.audit ?? null)
          setError("")
        }
      } catch {
        if (alive) setError("We could not check the system right now.")
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const totalDays = status?.history_days ?? WINDOW_DAYS
  const maxOffset = Math.max(0, Math.ceil((totalDays - WINDOW_DAYS) / 30))

  const slice = useMemo(() => {
    return (history: DayEntry[]) => {
      const end = history.length - offset * 30
      return history.slice(Math.max(0, end - WINDOW_DAYS), Math.max(0, end))
    }
  }, [offset])

  const counts = status?.counts
  const worst = status?.worst ?? 0

  const headline = error || status?.headline || "Checking the system…"
  const subline = error
    ? "Open this page again in a moment."
    : worst >= 3
      ? "Some parts are not responding. Reports and alerts may be delayed."
      : worst === 2
        ? "Some parts are slow. The system still works."
        : counts && counts.unknown > 0
          ? `${counts.unknown} ${counts.unknown === 1 ? "service has" : "services have"} no recent end-to-end proof.`
        : counts && counts.not_configured > 0
          ? `${counts.not_configured} ${counts.not_configured === 1 ? "service is" : "services are"} not configured.`
          : "Every operational check passed."

  const summaryWord = !status
    ? "Checking…"
    : counts && (counts.down > 0 || counts.degraded > 0)
      ? "Needs attention"
      : counts && counts.unknown > 0
        ? "Needs verification"
        : counts && counts.not_configured > 0
          ? "Needs setup"
          : "All operational"

  const firstWindow = status?.groups[0] ? slice(status.groups[0].history) : undefined

  function toggleGroup(title: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  async function runChecks() {
    setChecking(true)
    try {
      await apiRequest("/notifications/browser-push/test/", { method: "POST" }).catch(() => null)
      setStatus(await fetchStatus(true))
      setError("")
    } catch {
      setError("We could not check the system right now.")
    } finally {
      setChecking(false)
    }
  }

  return (
    <PageSection title="Monitoring">
      <ul className="overflow-hidden rounded-xl border border-neutral-200">
        {/* System status row */}
        <li className="border-b border-neutral-200 last:border-b-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="group flex w-full items-center justify-between gap-4 px-8 py-7 text-left transition-colors hover:bg-neutral-100"
          >
            <div className="flex items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white transition-[background-color,box-shadow] duration-200 ease-out group-hover:bg-accent group-hover:shadow-lg motion-reduce:transition-none">
                <ActivityIcon
                  className="size-6 transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  strokeWidth={1.7}
                  aria-hidden
                />
              </span>
              <div>
                <p className="text-row font-normal text-brand-navy transition-colors group-hover:text-accent">
                  System status
                </p>
                <p className="mt-2 text-meta leading-relaxed text-neutral-500">
                  Records, messaging, ID checks and map services
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <StatusMark severity={worst} className="size-5" />
              <span className="text-row font-normal text-brand-navy transition-colors group-hover:text-accent">{summaryWord}</span>
              <ChevronRightIcon
                className={cn(
                  "size-6 shrink-0 text-neutral-400 transition-colors duration-200 group-hover:text-accent",
                  open && "rotate-90",
                )}
                strokeWidth={1.7}
                aria-hidden
              />
            </div>
          </button>

          {open && (
            <div className="border-t border-neutral-200">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 px-8 py-5">
              <div className="flex items-center gap-3">
                <StatusMark severity={error ? 1 : worst} className="size-6" />
                <div>
                  <p className="text-section font-normal text-brand-navy">{headline}</p>
                  <p className="mt-1 text-meta text-neutral-500">
                    {subline} {checkedLabel(status?.checked_at)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => void runChecks()}
                  disabled={checking}
                  className="text-meta font-normal text-neutral-500 transition-colors hover:text-accent disabled:cursor-wait disabled:opacity-50"
                >
                  {checking ? "Checking…" : "Run checks"}
                </button>
              {firstWindow && firstWindow.length > 0 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
                    disabled={offset >= maxOffset}
                    aria-label="Earlier days"
                    className={cn(
                      "rounded-md p-1 transition-colors",
                      offset < maxOffset
                        ? "text-neutral-500 hover:bg-neutral-100 hover:text-foreground"
                        : "text-neutral-300",
                    )}
                  >
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M10 3L5 8l5 5" />
                    </svg>
                  </button>
                  <span className="text-meta text-neutral-500 tabular-nums">{windowLabel(firstWindow)}</span>
                  <button
                    type="button"
                    onClick={() => setOffset((o) => Math.max(0, o - 1))}
                    disabled={offset === 0}
                    aria-label="Later days"
                    className={cn(
                      "rounded-md p-1 transition-colors",
                      offset > 0
                        ? "text-neutral-500 hover:bg-neutral-100 hover:text-foreground"
                        : "text-neutral-300",
                    )}
                  >
                    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 3l5 5-5 5" />
                    </svg>
                  </button>
                </div>
              )}
              </div>
            </div>

            {error ? (
              <p className="px-8 py-8 text-meta text-neutral-500">
                The status check did not answer. Nothing is known about the services right now.
              </p>
            ) : !status ? (
              <p className="px-8 py-8 text-meta text-neutral-500">Checking every service…</p>
            ) : status.groups.length === 0 ? (
              <p className="px-8 py-8 text-meta text-neutral-500">There are no services to show.</p>
            ) : (
              <div className="divide-y divide-neutral-200">
                {status.groups.map((group) => {
                  const expanded = expandedGroups.has(group.title)
                  const days = slice(group.history)
                  const measured = days.some((d) => d.checks_total > 0)
                  const operationalNow = group.modules.filter((mod) => mod.status === "operational").length
                  const groupStatus = groupStatusWord(group)
                  const completeHistory = group.modules.every((mod) => mod.availability.measured_checks > 0)
                  return (
                    <div key={group.title} className="px-8 py-5">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.title)}
                        className="group flex w-full items-center gap-3 text-left"
                      >
                        {/* Once open, each service states its own condition —
                            a summary mark on top of them only repeats it. */}
                        {!expanded && <StatusMark severity={group.worst} />}
                        <span className="text-row font-normal text-brand-navy transition-colors group-hover:text-accent">
                          {group.title}
                        </span>
                        <span className="text-meta text-neutral-400">
                          {group.modules.length} {group.modules.length === 1 ? "service" : "services"}
                        </span>
                        <span className="ml-auto flex shrink-0 items-center gap-3">
                          <span className="text-meta text-neutral-500 tabular-nums">
                            {operationalNow}/{group.modules.length} operational · {completeHistory ? availabilityLabel(group.availability) : "Not enough history"}
                          </span>
                          {groupStatus && (
                            <span className="text-meta font-normal text-foreground transition-colors group-hover:text-accent">
                              {groupStatus}
                            </span>
                          )}
                          <ChevronRightIcon
                            className={cn(
                              "size-5 shrink-0 text-neutral-400 transition-colors duration-200 group-hover:text-accent",
                              expanded && "rotate-90",
                            )}
                            strokeWidth={1.7}
                            aria-hidden
                          />
                        </span>
                      </button>

                      {days.length > 0 && <StatusBar days={days} className="mt-3" />}
                      {!measured && (
                        <p className="mt-2 text-meta text-neutral-400">
                          No history for these days yet. It builds up as the system runs.
                        </p>
                      )}

                      {expanded && (
                        <div className="mt-5 space-y-5 border-t border-neutral-200 pt-5">
                          {group.modules.map((mod) => {
                            const modDays = slice(mod.history)
                            return (
                              <div key={mod.key}>
                                <div className="flex items-center gap-2.5">
                                  <StatusMark severity={severityOf(mod.status)} />
                                  <span className="text-row font-normal text-foreground transition-colors group-hover:text-accent">{mod.label}</span>
                                  <span
                                    className={cn(
                                      "min-w-0 truncate text-meta leading-snug",
                                      mod.message
                                        ? MESSAGE_TONE[severityOf(mod.status)]
                                        : "text-neutral-400",
                                    )}
                                  >
                                    {mod.message || mod.description}
                                  </span>
                                  <span className="ml-auto flex shrink-0 items-center gap-3">
                                    {STATUS_WORD[mod.status] && (
                                      <span className="text-meta font-normal text-foreground transition-colors group-hover:text-accent">
                                        {STATUS_WORD[mod.status]}
                                      </span>
                                    )}
                                    <span className="text-meta text-neutral-500 tabular-nums">
                                      {availabilityLabel(mod.availability)}
                                    </span>
                                  </span>
                                </div>
                                {modDays.length > 0 && <StatusBar days={modDays} className="mt-2.5" />}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        </li>

        {/* Audit log row */}
        <li className="border-b border-neutral-200 last:border-b-0">
          <a
            href="/dashboard/configuration/audit-log"
            className="group flex w-full items-center justify-between gap-4 px-8 py-7 text-left transition-colors hover:bg-neutral-100"
          >
            <div className="flex items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white transition-[background-color,box-shadow] duration-200 ease-out group-hover:bg-accent group-hover:shadow-lg motion-reduce:transition-none">
                <ScrollTextIcon
                  className="size-6 transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  strokeWidth={1.7}
                  aria-hidden
                />
              </span>
              <div>
                <p className="text-row font-normal text-brand-navy transition-colors group-hover:text-accent">
                  Audit log
                </p>
                <p className="mt-2 text-meta leading-relaxed text-neutral-500">
                  Who did what, including who opened private photos
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-right">
                <span className="block text-row font-normal text-brand-navy transition-colors group-hover:text-accent">
                  {audit?.status ?? "Loading…"}
                </span>
                {audit?.detail ? (
                  <span className="mt-1 block text-meta text-neutral-400">
                    {audit.detail}
                  </span>
                ) : null}
              </span>
              <ChevronRightIcon
                className="size-6 shrink-0 text-neutral-400 transition-colors duration-200 group-hover:text-accent"
                strokeWidth={1.7}
                aria-hidden
              />
            </div>
          </a>
        </li>
      </ul>
    </PageSection>
  )
}
