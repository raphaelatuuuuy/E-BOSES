import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import {
  ActivityIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  ScrollTextIcon,
} from "lucide-react"

import { apiRequest } from "@/lib/api"
import { cn } from "@workspace/ui/lib/utils"
import { PageSection } from "@/components/ui/page-header"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationInfoRow, ConfigurationTable } from "@/features/dashboard/components/config/configuration-table"

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

interface AuditLogEntry {
  id: number
  action: string
  label: string
  category: string
  sensitive: boolean
  actor: { name: string } | null
  created_at: string
}

interface AuditLogResponse {
  total: number
  categories: { key: string; label: string }[]
  entries: AuditLogEntry[]
}

function auditDate(iso: string) {
  return new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function AuditLogSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [categories, setCategories] = useState<AuditLogResponse["categories"]>([])
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const requestKey = `${open}|${activeCategory}|${search}`
  const loading = open && loadedKey !== requestKey

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const params = new URLSearchParams({
      category: activeCategory,
      days: "30",
      limit: "200",
      offset: "0",
    })
    if (search.trim()) params.set("search", search.trim())
    void apiRequest<AuditLogResponse>(`/config/audit-log/?${params}`)
      .then((next) => {
        if (cancelled) return
        setEntries(next.entries)
        setCategories(next.categories)
        setError("")
        setLoadedKey(requestKey)
      })
      .catch(() => {
        if (!cancelled) {
          setError("The audit log could not be loaded right now.")
          setLoadedKey(requestKey)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeCategory, open, requestKey, search])

  const filteredEntries = entries
  const filterOptions = [
    { key: "all", label: "Everything", count: entries.length },
    ...categories.filter((category) => category.key !== "all").map((category) => ({
      key: category.key,
      label: category.label,
      count: entries.filter((entry) => entry.category === category.key).length,
    })),
  ]
  const visibleEntries = filteredEntries.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      onBack={onClose}
      showClose={false}
      title={<>Audit <span className="text-brand-orange">log</span></>}
      titleClassName="text-center"
      size="wide"
      draggable
      bodyScrollable={false}
      className="h-auto max-h-[min(720px,92dvh)]"
      bodyClassName="px-5 sm:px-7 pb-0"
    >
      <div className="space-y-4">
        <ConfigurationListToolbar
          search={search}
          onSearch={(value) => { setSearch(value); setOffset(0) }}
          placeholder="Search audit activity"
          filters={filterOptions}
          activeFilter={activeCategory}
          onFilter={(value) => { setActiveCategory(value); setOffset(0) }}
        />

        {error ? (
          <p className="rounded-2xl border border-neutral-200 px-4 py-8 text-center text-[14px] text-neutral-500">
            {error}
          </p>
        ) : loading ? (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-[76px] animate-pulse bg-neutral-50" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <ScrollTextIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
            <h2 className="mt-4 text-row font-semibold text-brand-navy">No activity matches this view</h2>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
              {visibleEntries.map((entry) => {
                const expanded = expandedId === entry.id
                const categoryLabel =
                  categories.find((category) => category.key === entry.category)?.label ??
                  entry.category
                return (
                  <div key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
                      className="group flex w-full items-center gap-3 p-4 text-left"
                      aria-expanded={expanded}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-[15px] leading-snug font-bold text-neutral-900">
                          {entry.label}
                          {entry.sensitive ? (
                            <span className="ml-2 text-[12px] font-semibold text-brand-orange">Private data</span>
                          ) : null}
                        </span>
                        <span className="mt-1 block break-words text-[13px] text-neutral-500">
                          {entry.actor?.name || "System automation"} · {auditDate(entry.created_at)}
                        </span>
                      </span>
                      <ChevronRightIcon
                        className={cn(
                          "size-5 shrink-0 text-neutral-400 transition-all duration-200 group-hover:text-neutral-700",
                          expanded && "rotate-90",
                        )}
                        strokeWidth={1.9}
                        aria-hidden
                      />
                    </button>
                    {expanded && (
                      <dl className="max-h-[220px] space-y-1.5 overflow-y-auto px-4 pb-4 text-[13px]">
                        <div className="flex justify-between gap-3">
                          <dt className="text-neutral-400">Category</dt>
                          <dd className="text-right font-medium text-neutral-900">{categoryLabel}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-neutral-400">Actor</dt>
                          <dd className="text-right font-medium text-neutral-900">{entry.actor?.name || "System automation"}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-neutral-400">Date</dt>
                          <dd className="text-right font-medium text-neutral-900">{auditDate(entry.created_at)}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                )
              })}
            </div>
            <ConfigurationPager key={offset} offset={offset} total={filteredEntries.length} onChange={setOffset} noun="audit events" className="py-0" inline />
          </>
        )}
      </div>
    </SheetDialog>
  )
}

/* ── Section ── */

function fetchStatus(refresh = false) {
  return apiRequest<ServiceStatus>(`/config/service-status/${refresh ? "?refresh=1" : ""}`)
}

export function ServiceStatusSection({ initialOpen, embedded = false }: { initialOpen?: "system" | "audit"; embedded?: boolean }) {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [error, setError] = useState("")
  const [checking, setChecking] = useState(false)
  const [open, setOpen] = useState(initialOpen === "system")
  const [auditOpen, setAuditOpen] = useState(initialOpen === "audit")
  const [expandedMod, setExpandedMod] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const next = await fetchStatus()
        if (alive) {
          setStatus(next)
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

  const slice = useMemo(() => {
    return (history: DayEntry[]) => history.slice(-WINDOW_DAYS)
  }, [])

  const allModules = useMemo(
    () =>
      (status?.groups ?? []).flatMap((group) =>
        group.modules.map((mod) => ({ ...mod, groupTitle: group.title }))
      ),
    [status]
  )
  const attentionModules = allModules.filter(
    (mod) => mod.status === "down" || mod.status === "degraded"
  )
  const statusFilters = [
    { key: "all", label: "Everything", count: allModules.length },
    { key: "attention", label: "Needs attention", count: attentionModules.length },
  ]
  const filteredModules = allModules.filter((mod) => {
    if (statusFilter === "attention" && mod.status !== "down" && mod.status !== "degraded")
      return false
    const query = search.trim().toLowerCase()
    if (!query) return true
    return (
      mod.label.toLowerCase().includes(query) ||
      (mod.message || "").toLowerCase().includes(query) ||
      mod.groupTitle.toLowerCase().includes(query)
    )
  })
  const modulePage = filteredModules.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  function toggleMod(key: string) {
    setExpandedMod((current) => (current === key ? null : key))
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
    <PageSection title={embedded ? undefined : "Monitoring"} className={embedded ? "mt-0" : "mt-7 [&>div]:mb-3"}>
      <ConfigurationTable label="Monitoring" hideHeader>
        <ConfigurationInfoRow
          icon={ActivityIcon}
          title="System status"
          description="Records, messaging, ID checks and map services"
          actions={
            <button type="button" onClick={() => setOpen(true)} aria-label="Open System status" className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
              <ChevronRightIcon className="size-5" strokeWidth={2} aria-hidden />
            </button>
          }
        />
        <ConfigurationInfoRow
          icon={ScrollTextIcon}
          title="Audit log"
          description="Who did what, including who opened private photos"
          actions={
            <button type="button" onClick={() => setAuditOpen(true)} aria-label="Open Audit log" className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
              <ChevronRightIcon className="size-5" strokeWidth={2} aria-hidden />
            </button>
          }
        />
      </ConfigurationTable>
      <SheetDialog
        open={open}
        onClose={() => setOpen(false)}
        onBack={() => setOpen(false)}
        showClose={false}
        title={<>System <span className="text-brand-orange">status</span></>}
        titleClassName="text-center"
        size="wide"
        draggable
        bodyScrollable={false}
        className="h-auto max-h-[min(720px,92dvh)]"
        bodyClassName="px-5 sm:px-7 pb-0"
      >
                  <div className="space-y-4">
                <ConfigurationListToolbar
                  search={search}
                  onSearch={(value) => { setSearch(value); setOffset(0) }}
                  placeholder="Search services"
                  filters={statusFilters}
                  activeFilter={statusFilter}
                  onFilter={(value) => { setStatusFilter(value); setOffset(0) }}
                  trailing={
                    <button
                      type="button"
                      onClick={() => void runChecks()}
                      disabled={checking}
                      aria-label="Run checks"
                      title="Run checks"
                      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 transition-colors hover:bg-neutral-200 disabled:opacity-60"
                    >
                      <RefreshCwIcon className={cn("size-5", checking && "animate-spin")} aria-hidden="true" />
                    </button>
                  }
                />
                {error ? (
                  <p className="py-8 text-meta text-neutral-500">
                    The status check did not answer. Nothing is known about the services right now.
                  </p>
                ) : !status ? (
                  <p className="py-8 text-meta text-neutral-500">Checking every service…</p>
                ) : filteredModules.length === 0 ? (
                  <div className="py-16 text-center">
                    <ActivityIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
                    <h2 className="mt-4 text-row font-semibold text-brand-navy">
                      {search.trim() || statusFilter !== "all"
                        ? "No services match this view"
                        : "There are no services to show"}
                    </h2>
                  </div>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
                      {modulePage.map((mod) => {
                        const key = `${mod.groupTitle}|${mod.key}`
                        const expanded = expandedMod === key
                        const modDays = slice(mod.history)
                        const active = mod.status === "operational"
                        return (
                          <div key={key}>
                            <button
                              type="button"
                              onClick={() => toggleMod(key)}
                              className="group flex w-full items-center gap-3 p-4 text-left"
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block break-words text-[15px] leading-snug font-bold text-neutral-900">
                                  {mod.label}
                                </span>
                                <span className="mt-1 block break-words text-[13px] text-neutral-500">
                                  {mod.groupTitle}
                                </span>
                              </span>
                              <span className={cn(
                                "shrink-0 text-[13px] font-semibold",
                                active
                                  ? "text-emerald-700"
                                  : mod.status === "down"
                                    ? "text-sos"
                                    : mod.status === "degraded"
                                      ? "text-severity-moderate"
                                      : "text-neutral-500",
                              )}>
                                {active ? "Active" : (STATUS_WORD[mod.status] ?? mod.status)}
                              </span>
                              <ChevronRightIcon
                                className={cn(
                                  "size-5 shrink-0 text-neutral-400 transition-all duration-200 group-hover:text-neutral-700",
                                  expanded && "rotate-90",
                                )}
                                strokeWidth={1.9}
                                aria-hidden
                              />
                            </button>
                            {expanded && (
                              <div className="max-h-[220px] overflow-y-auto px-4 pb-4">
                                {mod.message || mod.description ? (
                                  <p className="mb-2 break-words text-[13px] leading-relaxed text-neutral-600">
                                    {mod.message || mod.description}
                                  </p>
                                ) : null}
                                <p className="mb-2 text-[12px] tabular-nums text-neutral-500">
                                  {availabilityLabel(mod.availability)}
                                </p>
                                {modDays.length > 0 ? (
                                  <StatusBar days={modDays} />
                                ) : (
                                  <p className="text-[12px] text-neutral-400">
                                    No history for this service yet. It builds up as the system runs.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    <ConfigurationPager key={offset} offset={offset} total={filteredModules.length} onChange={setOffset} noun="services" className="py-0" inline />
                  </>
                )
                }
              </div>
          </SheetDialog>
      <AuditLogSheet open={auditOpen} onClose={() => setAuditOpen(false)} />
    </PageSection>
  )
}
