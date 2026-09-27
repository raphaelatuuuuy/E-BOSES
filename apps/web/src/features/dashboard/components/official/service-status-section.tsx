import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ActivityIcon,
  ChevronRightIcon,
  FileTextIcon,
  ScrollTextIcon,
} from "lucide-react"

import { apiRequest } from "@/lib/api"
import { getLlmDecisionLog, type LlmDecisionLogEntry } from "@/features/classification/api"
import { recheckOcrServiceHealth } from "@/features/ocr/api"
import { cn } from "@workspace/ui/lib/utils"
import { PageSection } from "@/components/ui/page-header"
import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { AuditReportDialog } from "@/features/dashboard/components/concerns/audit-report-dialog"
import { MediaLightbox, AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { toMediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import type { MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationInfoRow, ConfigurationTable } from "@/features/dashboard/components/config/configuration-table"
import { toast } from "sonner"

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

const AUDIT_PAGE_SIZE = 20

function textOf(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function humaniseValue(value: string) {
  const text = value.replace(/[_-]+/g, " ").trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ""
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

interface AuditPerson {
  id: number
  label: string
  name: string
  position: string
  role: string
  initials: string
  service: boolean
}

interface AuditLogEntry {
  id: number
  action: string
  label: string
  category: string
  sensitive: boolean
  actor: AuditPerson | null
  target: AuditPerson | null
  ip_address: string
  origin: string
  metadata: Record<string, unknown>
  created_at: string
}

interface AuditLogResponse {
  total: number
  categories: { key: string; label: string; count: number }[]
  entries: AuditLogEntry[]
}

function actorName(person: AuditLogEntry["actor"]): string {
  return person?.label?.trim() || "Unknown account"
}

type SheetRow =
  | { kind: "audit"; key: string; label: string; actor: string; created_at: string; entry: AuditLogEntry }
  | { kind: "llm"; key: string; label: string; actor: string; created_at: string; entry: LlmDecisionLogEntry }

const AUDIT_PHOTO_BADGES: Record<string, string> = {
  report: "Submitted Photo",
  resolution: "Resolution Photo",
  area: "Road Area",
}

interface AuditImage {
  kind: string
  label: string
  url: string
}

function auditPhotos(
  meta: Record<string, unknown>,
  action: string,
): { primary: AuditImage | null; related: AuditImage[] } {
  const media: AuditImage[] = (meta.media as AuditImage[] | undefined) ?? []

  const noImageActions = new Set([
    "auth.login_success",
    "auth.login_ip_blocked",
    "auth.registered",
    "password_reset.requested",
    "password_reset.requested_unknown",
    "password_reset.confirmed",
    "profile.updated",
    "settings.updated",
    "account.staff_updated",
    "account.resident_status_updated",
    "account.responder_updated",
    "account.name_changed",
    "account.phone_changed",
    "account.email_changed",
    "account.password_changed",
    "account.deactivated",
    "account.reactivated",
    "account.deletion_completed",
    "account.request_submitted",
    "account.request_reviewed",
    "account.request_withdrawn",
    "admin.user_created",
    "ocr.configuration_draft_saved",
    "ocr.configuration_published",
    "ocr.configuration_reset_defaults",
    "ocr.template_sample_uploaded",
    "ocr.template_restored",
    "ocr.test_run_created",
    "ocr.health_recheck",
    "ocr.case_retry_requested",
    "ocr.case_approved",
    "ocr.case_rejected",
    "concern.assigned",
    "concern.reassigned",
    "concern.chat_message",
    "concern.published",
    "concern.media_privacy_reprocessed",
    "emergency.en_route",
    "emergency.transferred",
    "emergency.reassigned",
    "emergency.assignment_removed",
    "emergency.backup_assigned",
    "emergency.duty_changed",
    "emergency.category_created",
    "map_boundary.updated",
    "map_dispatch_policy.updated",
    "content.flag_submitted",
    "content.flag_reviewed",
  ])

  if (noImageActions.has(action) || media.length === 0) {
    return { primary: null, related: [] }
  }

  const reports = media.filter((m) => m.kind === "report")
  const resolutions = media.filter((m) => m.kind === "resolution")
  const areas = media.filter((m) => m.kind === "area")

  let primary: AuditImage | null = null

  if (action === "concern.ai_decided") {
    primary = reports[0] ?? null
  } else if (action === "concern.resolved" || action === "emergency.resolved") {
    primary = resolutions[0] ?? reports[0] ?? null
  } else if (action === "concern.status_updated") {
    const analysis =
      meta.analysis !== undefined && meta.analysis !== null
        ? (meta.analysis as Record<string, unknown>)
        : null
    primary = analysis?.street_verdict ? areas[0] ?? reports[0] ?? null : null
  } else {
    primary = reports[0] ?? resolutions[0] ?? areas[0] ?? null
  }

  return { primary, related: media }
}

function auditSummary(entry: AuditLogEntry): string {
  const meta = entry.metadata
  const actor = actorName(entry.actor)
  const analysis =
    meta.analysis !== undefined && meta.analysis !== null
      ? (meta.analysis as Record<string, unknown>)
      : null
  const severity = analysis ? textOf(analysis.severity) : ""
  const streetVerdict = analysis ? textOf(analysis.street_verdict) : ""
  const streetReason = analysis ? textOf(analysis.street_reason) : ""
  const concernStatus = textOf(meta.concern_status)
  const trackingId = textOf(meta.tracking_id)
  const reason = textOf(meta.reason)
  const record = trackingId ? `report ${trackingId}` : "the record"

  switch (entry.action) {
    case "concern.ai_decided": {
      const concernTitle = textOf(meta.concern_title)
      const concernDescription = textOf(meta.concern_description)
      const assignedUnit = textOf(meta.assigned_unit)
      const description = concernDescription || concernTitle || ""
      const parts = [
        description ? `The resident reported: ${description}.` : null,
        severity ? `Severity was assessed as ${severity}.` : null,
        streetReason ? `Images show the same ${streetReason.toLowerCase()}.` : null,
        streetVerdict ? `The street-image analysis returned ${streetVerdict}.` : null,
        assignedUnit ? `Assigned unit: ${assignedUnit}.` : null,
      ].filter(Boolean)
      return parts.join(" ")
    }
    case "concern.resolved":
    case "concern.status_updated": {
      if (streetVerdict) {
        return [
          "A visible road scene was detected, so street-image comparison was performed together with GPS, map-pin, and barangay-boundary validation.",
          "The available location evidence matched and the report location passed validation.",
        ].join(" ")
      }
      if (concernStatus) {
        return `The concern was ${concernStatus.toLowerCase()}.`
      }
      return `${actor} updated the concern status.`
    }
    case "ocr.verification_accepted":
      return "The submitted identification document passed automated verification. The required information was detected and was consistent with the available account details. Sensitive details have been masked."
    case "ocr.verification_rejected":
      return "The submitted identification document did not pass automated verification. The required information could not be confirmed, and the case was held for review."
    case "media.raw_accessed":
      return "Sensitive visual details were detected and blurred before the image was displayed to other residents. The original media remains restricted to authorized personnel."
    case "announcement.created":
      return "A community advisory was published for the intended residents, and the related notification was sent successfully."
    case "account.staff_updated":
    case "account.resident_status_updated":
      return "The selected account's permissions were updated. The change was completed by an authorized administrator."
    case "auth.login_ip_blocked":
      return "The sign-in attempt failed because the submitted credentials were invalid. No protected information was accessed."
     default: {
      const status = textOf(meta.status)
      const result = concernStatus ?? status ?? "successfully"
      const previousValue = textOf(meta.previous_value)
      const updatedValue = textOf(meta.updated_value)
      const device = textOf(meta.origin)
      const ip = textOf(meta.ip_address)
      const location = device || ip ? ` from ${[device, ip].filter(Boolean).join(" · ")}` : ""
      if (previousValue && updatedValue) {
        const base = `${actor} updated ${record} from ${previousValue} to ${updatedValue}. The change was completed successfully.`
        return reason ? `${base} Reason: ${reason}.` : base
      }
      const base = `${actor} ${entry.label.toLowerCase()} on ${record}${location}. The action resulted in ${result}.`
      return reason ? `${base} Reason: ${reason}.` : base
    }
  }
}

function AuditEntryDetail({ entry }: { entry: AuditLogEntry }) {
  const meta = entry.metadata
  const { primary, related } = auditPhotos(meta, entry.action)
  const summary = auditSummary(entry)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [imageError, setImageError] = useState(false)

  const previewItems = useMemo<MediaPreviewItem[]>(
    () =>
      related.map((photo) => ({
        ...toMediaPreviewItem(photo.url, photo.label, "image"),
        badge: AUDIT_PHOTO_BADGES[photo.kind] ?? "",
      })),
    [related],
  )

  function openPreview(index: number) {
    setPreviewIndex(index)
    setPreviewOpen(true)
  }

  return (
    <div className="space-y-4">
      {primary ? (
        <div className="flex flex-row gap-4">
          <button
            type="button"
            onClick={() => openPreview(0)}
            aria-label={`Open ${primary.label}`}
            className="group relative block aspect-square w-[120px] shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100"
          >
            {imageError ? (
              <div className="flex size-full items-center justify-center">
                <span className="text-[11px] text-neutral-400">Image unavailable</span>
              </div>
            ) : (
              <AuthenticatedMediaImage
                src={primary.url}
                alt={primary.label}
                className="size-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                onStatus={(status: "loading" | "ready" | "error") => {
                  if (status === "error") {
                    setImageError(true)
                  }
                }}
              />
            )}
            <span className="absolute bottom-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-black/55 text-white">
              <ChevronRightIcon className="size-3.5 rotate-[-45deg]" aria-hidden />
            </span>
          </button>
          <p className="text-[13px] leading-relaxed text-neutral-600 flex-1">
            {summary}
          </p>
        </div>
      ) : (
        <p className="text-[13px] leading-relaxed text-neutral-600">
          {summary}
        </p>
      )}
      {previewOpen && previewItems.length > 0 ? (
        <MediaLightbox
          items={previewItems}
          index={previewIndex}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  )
}

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
  const [total, setTotal] = useState(0)
  const [categories, setCategories] = useState<AuditLogResponse["categories"]>([])
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState("all")
  const [loadedKey, setLoadedKey] = useState("")
  const [error, setError] = useState("")
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const requestKey = `${open}|${activeCategory}|${debouncedSearch}|${offset}`
  const loading = open && loadedKey !== requestKey
  const isLlmFilter = activeCategory === "llm-verification"

  // Typing a search must not fire a request per keystroke. One request, once
  // the user pauses.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (!open || loadedKey === requestKey) return
    let cancelled = false
    if (activeCategory === "llm-verification") {
      void getLlmDecisionLog({
        domain: "concern",
        run_kind: "production",
        page: Math.floor(offset / AUDIT_PAGE_SIZE) + 1,
        page_size: AUDIT_PAGE_SIZE,
        days: 30,
        search: debouncedSearch || undefined,
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
      category: activeCategory === "sensitive" ? "all" : activeCategory,
      days: "30",
      limit: String(AUDIT_PAGE_SIZE),
      offset: String(offset),
    })
    if (activeCategory === "sensitive") params.set("sensitive", "1")
    if (debouncedSearch) params.set("search", debouncedSearch)
    void apiRequest<AuditLogResponse>(`/config/audit-log/?${params}`, {}, { timeoutMs: 30000 })
      .then((next) => {
        if (cancelled) return
        setEntries(next.entries)
        setTotal(next.total)
        setCategories(next.categories)
        setError("")
        setLoadedKey(requestKey)
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : ""
          setError(
            msg.includes("too long") || msg.includes("timeout")
              ? "The audit log is taking too long to load. Try a narrower filter or fewer days."
              : "The audit log could not be loaded right now.",
          )
          setLoadedKey(requestKey)
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeCategory, debouncedSearch, loadedKey, offset, open, requestKey])

  function changeFilter(key: string) {
    setActiveCategory(key)
    setOffset(0)
    setExpandedId(null)
  }

  function changeSearch(value: string) {
    setSearch(value)
    setOffset(0)
    setExpandedId(null)
  }

  const filterOptions = [
     { key: "all", label: "Everything", count: total },
     ...categories.filter((category) => category.key !== "all").map((category) => ({
       key: category.key,
       label: category.label,
       count: entries.filter((entry) => entry.category === category.key).length,
     })),
     // A cross-category view of the actions that touch private data. Not every
     // entry in it is worth an alarm, but each one looked at something private.
     { key: "sensitive", label: "Private access", count: undefined },
   ]

  const llmDecisionLabel = (entry: LlmDecisionLogEntry) => {
    const decision = entry.final_decision?.label || humaniseValue(entry.recommended_action)
    return `System ${decision.toLowerCase()} a report`
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
        label: entry.label,
        actor: entry.actor ? actorName(entry.actor) : "System",
        created_at: entry.created_at,
        entry,
      }))

  const expandedRow = rows.find((row) => row.key === expandedId)
  // One open entry at a time: its siblings step aside so the detail is never
  // competing with a table of other rows for the same viewport.
   const visibleEntries = expandedRow ? [expandedRow] : rows

  function LlmEntryDetail() {
  return null
}

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
      bodyScrollable
      footer={rows.length > 0 ? (
        <ConfigurationPager
          offset={offset}
          total={isLlmFilter ? llmTotal : total}
          onChange={(next) => {
            setOffset(next)
            setExpandedId(null)
          }}
          noun="entries"
          className="py-0"
          inline
        />
      ) : null}
      className="h-auto max-h-[min(720px,92dvh)]"
      bodyClassName="px-5 sm:px-7 pb-0"
    >
      <div className="space-y-4">
        <ConfigurationListToolbar
          search={search}
          onSearch={changeSearch}
          placeholder="Search audit activity"
          filters={filterOptions.map(({ key, label }) => ({ key, label }))}
          activeFilter={activeCategory}
          onFilter={changeFilter}
          trailing={
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              aria-label="Generate report"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-orange text-white transition-colors hover:bg-orange-600"
            >
              <FileTextIcon className="size-5" aria-hidden />
            </button>
          }
        />

        {error && !loading ? (
          <p className="rounded-2xl border border-neutral-200 px-4 py-8 text-center text-[14px] text-neutral-500">
            {error}
          </p>
        ) : loading ? (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {Array.from({ length: AUDIT_PAGE_SIZE }).map((_, index) => (
              <div key={index} className="h-[76px] animate-pulse bg-neutral-50" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <ScrollTextIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
            <h2 className="mt-4 text-meta text-neutral-500">No activity matches this view</h2>
          </div>
        ) : (
          <div className={cn("overflow-hidden rounded-2xl border border-neutral-200 bg-white", expandedRow ? "" : "divide-y divide-neutral-100")}>
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
                        {row.actor} · {auditDate(row.created_at)}
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
                  {expanded ? (
                    <div className="border-t border-neutral-100 px-4 pb-4 pt-3">
                      {row.kind === "llm" ? <LlmEntryDetail /> : <AuditEntryDetail entry={row.entry} />}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
        </SheetDialog>
        <AuditReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
        />
        </>
    )
  }

/* ── Section ── */

function fetchStatus(refresh = false) {
  return apiRequest<ServiceStatus>(`/config/service-status/${refresh ? "?refresh=1" : ""}`)
}

function isLocal(): boolean {
  const host = typeof window !== "undefined" ? window.location.hostname : ""
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".lan")
  )
}

export function ServiceStatusSection({ initialOpen, embedded = false }: { initialOpen?: "system" | "audit"; embedded?: boolean }) {
  const navigate = useNavigate()
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
             <button type="button" onClick={() => { if (isLocal()) { toast.info("Currently in progress", { duration: 2000 }) } else { navigate("/dashboard/configuration") } }} aria-label="Open Audit Log" className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700">
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
