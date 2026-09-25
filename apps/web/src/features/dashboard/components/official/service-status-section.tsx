import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIcon,
  ChevronRightIcon,
  MapPinIcon,
  ScrollTextIcon,
  SignalIcon,
  ZoomInIcon,
} from "lucide-react"

import { apiRequest } from "@/lib/api"
import { getLlmDecisionLog, type LlmDecisionLogEntry } from "@/features/classification/api"
import { recheckOcrServiceHealth } from "@/features/ocr/api"
import { cn } from "@workspace/ui/lib/utils"
import { PageSection } from "@/components/ui/page-header"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { MediaLightbox, AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import type { MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationInfoRow, ConfigurationTable } from "@/features/dashboard/components/config/configuration-table"

function ImageButton({ src, label, onPreview }: { src: string; label: string; onPreview: () => void }) {
  return (
    <button type="button" onClick={onPreview} className="relative shrink-0 group">
      <AuthenticatedMediaImage
        src={src}
        alt={label}
        className="h-28 w-28 rounded-xl border border-neutral-200 object-cover"
        hideOnError
      />
      <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
        <ZoomInIcon className="size-5 text-white" />
      </span>
    </button>
  )
}

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
  unknown: "Inactive",
}

function mapOcrStatus(state: string): ModuleStatus {
  switch (state) {
    case "healthy":
      return "operational"
    case "degraded":
      return "degraded"
    case "unavailable":
      return "down"
    case "not_configured":
      return "not_configured"
    default:
      return "unknown"
  }
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
  target: { name: string } | null
  metadata: Record<string, unknown>
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

function priorityColor(value: string) {
  switch (value) {
    case "critical": return "text-red-700"
    case "high": return "text-orange-700"
    case "moderate": return "text-amber-700"
    case "low": return "text-emerald-700"
    default: return "text-neutral-500"
  }
}

function humaniseAction(value: string) {
  const text = value.replace(/_/g, " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Automated check completed"
}

type SheetRow =
  | { kind: "audit"; key: string; label: string; actor: string; created_at: string; entry: AuditLogEntry }
  | { kind: "llm"; key: string; label: string; actor: string; created_at: string; entry: LlmDecisionLogEntry }

function AuditLogSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [llmEntries, setLlmEntries] = useState<LlmDecisionLogEntry[]>([])
  const [llmTotal, setLlmTotal] = useState(0)
  const [categories, setCategories] = useState<AuditLogResponse["categories"]>([])
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)
  const requestKey = `${open}|${activeCategory}|${search}`
  const loading = open && loadedKey !== requestKey
  const isLlmFilter = activeCategory === "llm-verification"

  useEffect(() => {
    if (!open) return
    let cancelled = false
    if (activeCategory === "llm-verification") {
      void getLlmDecisionLog({
        domain: "concern",
        run_kind: "production",
        page: 1,
        page_size: 200,
        days: 30,
        search: search.trim() || undefined,
      })
        .then((next) => {
          if (cancelled) return
          setLlmEntries(next.results)
          setLlmTotal(next.count)
          setError("")
          setLoadedKey(requestKey)
        })
        .catch(() => {
          if (!cancelled) {
            setError("The automated decision log could not be loaded right now.")
            setLoadedKey(requestKey)
          }
        })
      return () => {
        cancelled = true
      }
    }
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

  const filterOptions = [
    { key: "all", label: "Everything", count: entries.length },
    ...categories.filter((category) => category.key !== "all").map((category) => ({
      key: category.key,
      label: category.label,
      count: entries.filter((entry) => entry.category === category.key).length,
    })),
  ]
  const llmDecisionLabel = (entry: LlmDecisionLogEntry) => {
    const decision = entry.final_decision?.label || humaniseAction(entry.recommended_action)
    return `System ${decision.toLowerCase()} a report`
  }
  const auditDecisionLabel = (entry: AuditLogEntry) => {
    const decision = String(entry.metadata?.decision || "decided").toLowerCase()
    return `System ${decision} a report`
  }
  const rows: SheetRow[] = isLlmFilter
    ? llmEntries.map((entry) => ({
        kind: "llm" as const,
        key: `llm-${entry.id}`,
        label: llmDecisionLabel(entry),
        actor: "Automated",
        created_at: entry.created_at,
        entry,
      }))
      : entries.map((entry) => ({
        kind: "audit" as const,
        key: `audit-${entry.id}`,
        label: entry.action === "concern.ai_decided" ? auditDecisionLabel(entry) : entry.label,
        actor: "Automated",
        created_at: entry.created_at,
        entry,
      }))
  const expandedRow = rows.find((row) => row.key === expandedId)
  const visibleEntries = expandedRow?.kind === "llm" ? [expandedRow] : rows.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  return (
    <>
      <SheetDialog
      open={open}
      onClose={onClose}
      onBack={onClose}
      showClose={false}
      title={<>Audit <span className="text-brand-orange">Log</span></>}
      titleClassName="text-center"
      size="wide"
      draggable
      bodyScrollable={false}
      footer={rows.length > 0 ? (
        <ConfigurationPager offset={offset} total={isLlmFilter ? llmTotal : entries.length} onChange={setOffset} noun="entries" className="py-0" inline />
      ) : null}
      className="h-auto max-h-[min(720px,92dvh)]"
      bodyClassName="px-5 sm:px-7 pb-0"
    >
      <div className="space-y-4">
        <ConfigurationListToolbar
          search={search}
          onSearch={(value) => { setSearch(value); setOffset(0) }}
          placeholder="Search audit activity"
          filters={filterOptions.map(({ key, label }) => ({ key, label }))}
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
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <ScrollTextIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
            <h2 className="mt-4 text-meta text-neutral-500">No activity matches this view</h2>
          </div>
                   ) : (
                   <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
               {visibleEntries.map((row) => {
                 const expanded = expandedId === row.key
                 return (
                   <div key={row.key}>
                     <button
                       type="button"
                       onClick={() => setExpandedId((current) => (current === row.key ? null : row.key))}
                       className="group flex w-full items-center gap-3 p-4 text-left"
                       aria-expanded={expanded}
                     >
                         <span className="min-w-0 flex-1">
                           <span className="block break-words text-[15px] leading-snug font-bold text-neutral-900">
                             {row.label}
                           </span>
                            <span className="mt-1 block break-words text-[13px] text-neutral-500">
                              {auditDate(row.created_at)}
                            </span>
                         </span>
                       <ChevronRightIcon
                         className={cn(
                           "size-5 shrink-0 text-neutral-400 transition-transform duration-200 group-hover:text-neutral-700",
                           expanded && "rotate-90",
                         )}
                         strokeWidth={1.9}
                         aria-hidden
                       />
                     </button>
                     {expanded && row.kind === "audit" && row.entry.action === "concern.ai_decided" ? (
                       <div className="max-h-[420px] overflow-y-auto border-t border-neutral-100 px-4 pb-4 pt-3">
                         <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                           <div><dt className="text-neutral-400">Report</dt><dd className="break-words font-medium text-neutral-900">{String(row.entry.metadata?.concern_title || "N/A")}</dd></div>
                           <div><dt className="text-neutral-400">Decision</dt><dd className="font-medium text-neutral-900">{String(row.entry.metadata?.decision || "N/A")}</dd></div>
                           <div className="sm:col-span-2"><dt className="text-neutral-400">Reason</dt><dd className="break-words font-medium text-neutral-900">{String(row.entry.metadata?.reason || "N/A")}</dd></div>
                           <div><dt className="text-neutral-400">Model</dt><dd className="font-medium text-neutral-900">{String(row.entry.metadata?.model_version || "N/A")}</dd></div>
                           <div><dt className="text-neutral-400">Rejection Code</dt><dd className="font-medium text-neutral-900">{String(row.entry.metadata?.rejection_code || "N/A")}</dd></div>
                           <div><dt className="text-neutral-400">Date</dt><dd className="font-medium text-neutral-900">{auditDate(row.created_at)}</dd></div>
                           {String(row.entry.metadata?.concern_id ?? "") !== "" && (
                             <div><dt className="text-neutral-400">Concern ID</dt><dd className="font-medium text-neutral-900">{String(row.entry.metadata?.concern_id)}</dd></div>
                           )}
                         </dl>
                       </div>
                     ) : expanded && row.kind === "audit" ? (
                       <div className="max-h-[420px] overflow-y-auto border-t border-neutral-100 px-4 pb-4 pt-3">
                         <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                           <div><dt className="text-neutral-400">Category</dt><dd className="font-medium text-neutral-900">{categories.find((category) => category.key === row.entry.category)?.label ?? row.entry.category}</dd></div>
                           <div><dt className="text-neutral-400">Actor</dt><dd className="font-medium text-neutral-900">{row.actor}</dd></div>
                            <div><dt className="text-neutral-400">Action</dt><dd className="break-words font-medium text-neutral-900">{row.entry.action}</dd></div>
                          </dl>
                       </div>
                     ) : expanded && row.kind === "llm" ? (
                       <div className="max-h-[420px] overflow-y-auto border-t border-neutral-100 px-4 pb-4 pt-3">
                          <dl className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
                                {row.entry.reporter?.name && (
                                  <div className="sm:col-span-2">
                                    <dt className="text-neutral-400">Reporter</dt>
                                    <dd className="flex items-center gap-2">
                                      <span className="font-medium text-neutral-900">{row.entry.reporter.name}</span>
                                      {(() => {
                                        if (row.kind !== "llm") return null
                                        const loc = row.entry.location || row.entry.address
                                        if (!loc) return null
                                        return (
                                          <span className="inline-flex items-center gap-1 text-[12px] text-neutral-500">
                                            <MapPinIcon className="size-3" aria-hidden />
                                            <span>{loc.replace(/,\s*marikina heights/i, "")}</span>
                                          </span>
                                        )
                                      })()}
                                    </dd>
                                  </div>
                                )}
                             <div><dt className="text-neutral-400">Department</dt><dd className="break-words font-medium text-neutral-900">{row.entry.assigned_department?.name || row.entry.assigned_unit?.name || "N/A"}</dd></div>
                            {row.entry.duration_ms != null && <div><dt className="text-neutral-400">Processing Time</dt><dd className="font-medium text-neutral-900">{row.entry.duration_ms} ms</dd></div>}
                          </dl>
                           {(row.entry.submitted_media?.some((m) => m.preview_url || m.raw_url) || row.entry.street_imagery?.status === "checked") ? (
                             <section className="mt-4">
                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                 {(() => {
                                   const validMedia = row.entry.submitted_media?.filter((m) => m.preview_url || m.raw_url)
                                   if (!validMedia || validMedia.length === 0) return null
                                   const first = validMedia[0]
                                   return (
                                     <div>
                                       <h4 className="text-[13px] font-semibold text-neutral-700">Concern photos</h4>
                                       <div className="mt-2 flex gap-3 items-start">
                                         <ImageButton
                                           src={first.preview_url || first.raw_url || ""}
                                           label={first.label || "Concern photo 1"}
                                           onPreview={() => setPreview({
                                             items: validMedia.map((m) => ({
                                               src: m.preview_url || m.raw_url,
                                               filename: m.label || `Concern photo ${m.id}`,
                                               kind: "image" as const,
                                               badge: "reported issue" as const,
                                             })),
                                             index: 0,
                                           })}
                                         />
                                      <div className="min-w-0 flex-1 space-y-1 text-[12px] text-neutral-600">
                                        {row.entry.final_decision?.reason || row.entry.routing_reason ? (
                                          <p className="font-medium text-neutral-700 break-words">
                                            {row.entry.final_decision?.reason || row.entry.routing_reason}
                                          </p>
                                        ) : null}
                                        <p className="break-words">{row.entry.resident_message || row.entry.report_description || "N/A"}</p>
                                        <p className="flex items-center gap-1.5">
                                          <SignalIcon className={cn("size-4 shrink-0", priorityColor(row.entry.priority || ""))} strokeWidth={2} aria-hidden />
                                          <span className={cn("font-medium", priorityColor(row.entry.priority || ""))}>{row.entry.priority || "N/A"}</span>
                                        </p>
                                       </div>
                                     </div>
                                    </div>
                                  )
                                })()}
                                {row.entry.street_imagery?.status === "checked" ? (
                                  <div>
                                    <h4 className="text-[13px] font-semibold text-neutral-700">Road photo comparison</h4>
                                    <div className="mt-2 flex gap-3 items-start">
                                      {row.entry.street_imagery.image_url || row.entry.street_imagery.image ? (
                                        <ImageButton
                                          src={row.entry.street_imagery.image_url || row.entry.street_imagery.image!}
                                          label="Road photo comparison"
                                          onPreview={() => setPreview({
                                            items: [{
                                              src: row.entry.street_imagery!.image_url || row.entry.street_imagery!.image!,
                                              filename: "Road photo comparison",
                                              kind: "image" as const,
                                              badge: "reported issue" as const,
                                            }],
                                            index: 0,
                                          })}
                                        />
                                      ) : (
                                        <div className="h-28 w-28 shrink-0 rounded-xl border border-neutral-200 bg-neutral-50 flex items-center justify-center">
                                          <span className="text-[12px] text-neutral-400">No image</span>
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1 space-y-1 text-[12px] text-neutral-600">
                                        <p className="font-medium text-neutral-700">Area is not the same.</p>
                                        {row.entry.street_imagery.reason && <p className="break-words">{row.entry.street_imagery.reason}</p>}
                                        {row.entry.street_imagery.explanation && (
                                          <p className="break-words">
                                            Concern photo shows {row.entry.street_imagery.explanation.replace(/^image 1 shows?\s*/i, "").replace(/\s*while\s+image 2 shows?\s*/i, " while road area shows ")}
                                          </p>
                                        )}
                                        {row.entry.street_imagery.distance_meters != null && (
                                          <p>{row.entry.street_imagery.distance_meters} m</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            </section>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
                   </div>
                   )}
                 </div>
              </SheetDialog>
              {preview ? (
                <MediaLightbox
                  items={preview.items}
                  index={preview.index}
                  onClose={() => setPreview(null)}
                  simpleCounter
                  hideCounter
                />
              ) : null}
      </>
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
        group.modules
          .filter((mod) => mod.label !== "Phone alerts" && mod.label !== "Street names" && !["Saved records", "Quick memory", "Live updates", "Background jobs"].includes(mod.label))
          .map((mod) => ({
            ...mod,
            groupTitle: group.title,
            ...(mod.label === "Map areas" ? { description: "Area for pinning coordinates" } : {}),
            ...(mod.label === "Report checking" ? { description: "Screens reports" } : {}),
          }))
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
      const ocrHealth = await recheckOcrServiceHealth().catch(() => null)
      await apiRequest("/notifications/browser-push/test/", { method: "POST" }).catch(() => null)
      const next = await fetchStatus(true)
      if (ocrHealth && next?.groups) {
        const ocrStatus = mapOcrStatus(ocrHealth.status)
        const ocrMessage = ocrHealth.message ?? (ocrHealth.configured ? "OCR service is running." : "OCR not configured.")
        next.groups = next.groups.map((group) => ({
          ...group,
          modules: group.modules.map((mod) => {
            if (mod.key === "ocr" || mod.label === "ID reading" || mod.label === "Submissions") {
              return { ...mod, status: ocrStatus, message: ocrMessage }
            }
            return mod
          }),
        }))
      }
      setStatus(next)
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
          title="System Status"
          description="Records, messaging, ID checks and map services"
          actions={
            <button type="button" onClick={() => setOpen(true)} aria-label="Open System Status" className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
              <ChevronRightIcon className="size-5" strokeWidth={2} aria-hidden />
            </button>
          }
        />
        <ConfigurationInfoRow
          icon={ScrollTextIcon}
          title="Audit Log"
          description="Who did what, including who opened private photos"
          actions={
            <button type="button" onClick={() => setAuditOpen(true)} aria-label="Open Audit Log" className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
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
        title={<>System <span className="text-brand-orange">Status</span></>}
        titleClassName="text-center"
        size="wide"
        draggable
        bodyScrollable={false}
        footer={filteredModules.length > 0 ? (
          <ConfigurationPager key={offset} offset={offset} total={filteredModules.length} onChange={setOffset} noun="services" className="py-0" inline />
        ) : null}
        className="h-auto max-h-none"
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
                    retry={runChecks}
                    checking={checking}
                  />
                {error ? (
                  <p className="py-8 text-meta text-neutral-500">
                    The status check did not answer. Nothing is known about the services right now.
                  </p>
                ) : !status ? (
                  <p className="py-8 text-meta text-neutral-500">Checking every service…</p>
                ) : filteredModules.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="mx-auto flex size-7 items-center justify-center">
                      <ActivityIcon className="size-7 text-neutral-300" aria-hidden />
                    </div>
                    <p className="mt-4 text-[15px] text-neutral-500">
                      {search.trim() || statusFilter !== "all"
                        ? "No services match this view"
                        : "There are no services to show"}
                    </p>
                  </div>
                ) : (
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
               )}
           </div>
       </SheetDialog>
       <AuditLogSheet open={auditOpen} onClose={() => setAuditOpen(false)} />
     </PageSection>
  )
}
