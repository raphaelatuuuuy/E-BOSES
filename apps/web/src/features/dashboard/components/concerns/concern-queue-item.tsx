import { useState } from "react"
import { toast } from "sonner"
import {
  ArrowUpIcon,
  CircleCheck,
  CircleX,
  ClockIcon,
  MapPinIcon,
  MessageCircleIcon,
  ScaleIcon,
  ShieldUserIcon,
  SignalHighIcon,
  SignalIcon,
  SignalLowIcon,
  SignalMediumIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { categoryLabels, truncateDescription, unitShortTag } from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"
import { SEVERITY_LABEL, priorityReasons } from "@/features/dashboard/components/record/severity"
import {
  commentOnConcern,
  getConcern,
  type ConcernComment,
} from "@/features/dashboard/api"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"

export const avatarTone = "bg-slate-soft text-navy-muted"

const CATEGORY_TONE: Record<string, string> = {
  infrastructure: "bg-brand-orange-soft text-severity-high-ink",
  environment: "bg-status-closed-surface text-status-closed-ink",
  public_safety: "bg-severity-critical-surface text-severity-critical-ink",
  vehicle: "bg-status-active-surface text-status-active-ink",
  others: "bg-neutral-100 text-neutral-600",
}

export function categoryTone(category: string) {
  return CATEGORY_TONE[category] ?? avatarTone
}

const SEVERITY_TINT: Record<string, string> = {
  critical: "#fbdedd",
  high: "#fae2e0",
  moderate: "var(--color-severity-moderate-surface)",
  low: "#f4f4f5",
}

export const SEVERITY_TONE: Record<string, string> = {
  critical: "text-[#d62018]",
  high: "text-[#cf4a40]",
  moderate: "text-severity-moderate",
  low: "text-neutral-400",
}

export const SEVERITY_ICON: Record<string, typeof ClockIcon> = {
  critical: SignalIcon,
  high: SignalHighIcon,
  moderate: SignalMediumIcon,
  low: SignalLowIcon,
}

const RESIDENT_ROW_TINT = {
  backgroundImage:
    "radial-gradient(115% 130% at 100% 0%, var(--color-brand-orange-soft), #ffffff 68%)",
} as const

const STATUS_TINT: Record<string, string> = {
  resolved: "var(--color-status-closed-surface)",
  rejected: "var(--color-severity-critical-surface)",
  appealed: "var(--color-severity-moderate-surface)",
  submitted: "var(--color-status-active-surface)",
  under_review: "var(--color-status-active-surface)",
  assigned: "var(--color-brand-orange-soft)",
  in_progress: "var(--color-brand-orange-soft)",
}

function statusTintStyle(status: string) {
  const tint = STATUS_TINT[status]
  if (!tint) return undefined
  return {
    backgroundImage: `radial-gradient(115% 130% at 100% 0%, ${tint}, #ffffff 68%)`,
  }
}

export function severityTintStyle(severity: string, assessed = true) {
  const tint = assessed ? SEVERITY_TINT[severity] : undefined
  if (!tint) return undefined
  return {
    backgroundImage: `radial-gradient(115% 130% at 100% 0%, ${tint}, #ffffff 68%)`,
  }
}

export function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  const raw = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0]?.[0] ?? "R")
  return raw.toUpperCase()
}

export function concernReporterName(concern: RankedConcern["concern"]) {
  const primary = concern.community_incident?.reports?.find((report) => report.is_primary)
  const fromReporter =
    concern.reporter?.full_name?.trim() ||
    (concern.reporter_full_name ?? "").trim()
  if (fromReporter && fromReporter.toLowerCase() !== "resident") return fromReporter
  const mediaNameRaw = concern.media?.find((media) => "reporter_name" in media)?.reporter_name
  const mediaName = typeof mediaNameRaw === "string" ? mediaNameRaw.trim() : ""
  return (
    primary?.reporter_name?.trim() ||
    concern.community_incident?.reports?.[0]?.reporter_name?.trim() ||
    mediaName ||
    fromReporter ||
    "Resident"
  )
}

function queueTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `Today at ${formatter.format(date)}`
  if (new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString())
    return `Yesterday at ${formatter.format(date)}`
  return formatter.format(date)
}

function staffBadgeClass(role: string) {
  if (role === "barangay_official") return "bg-brand-orange"
  if (role === "first_responder") return "bg-brand-blue"
  return ""
}

function StaffAvatar({ name, role }: { name: string; role: string }) {
  const badge = staffBadgeClass(role)
  return (
    <span className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", avatarTone)}>
      {initialsOf(name).charAt(0)}
      {badge ? (
        <span className={cn("absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full ring-1 ring-white", badge)}>
          <ShieldUserIcon className="size-1.5 text-white" strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  )
}

export function ConcernQueueItem({
  entry,
  active,
  onSelect,
  variant = "staff",
  tintBy = "Priority",
}: {
  entry: RankedConcern
  active: boolean
  onSelect: () => void
  variant?: "staff" | "resident"
  tintBy?: "Status" | "Priority"
}) {
  const { concern } = entry
  const resident = variant === "resident"
  const unit = concern.assigned_department ?? concern.community_incident?.assigned_unit ?? null
  const unitTag = unitShortTag(unit)
  const titleText = concern.title?.trim() || ""
  const summaryText = concern.summary?.trim() || ""
  const descriptionText = concern.description?.trim() || ""
  const displayTitle = titleText || truncateDescription(descriptionText, 60)
  const showBody = resident
    ? Boolean(descriptionText)
    : Boolean(summaryText) || (Boolean(titleText) && Boolean(descriptionText))
  const full = concernReporterName(concern)
  const initials = (concern.reporter?.initials || initialsOf(full)).charAt(0)
  const statusLabel = statusLabelOf(concern.status)
  const othersCount = concern.also_reported_count ?? 0
  const statusGlyph =
    concern.status === "resolved"
      ? { Icon: CircleCheck, cls: "text-status-closed/90" }
      : concern.status === "rejected"
        ? { Icon: CircleX, cls: "text-status-open/80" }
        : concern.status === "appealed"
          ? { Icon: ScaleIcon, cls: "text-severity-high/80" }
          : { Icon: ClockIcon, cls: "text-[#f97316]" }
  const StatusGlyph = statusGlyph.Icon
  const statusCls = statusGlyph.cls

  const isPublic = concern.visibility === "community"
  const upvoterNames = (concern.upvoters ?? []).slice(0, 3)
  const extraUpvoters = Math.max((concern.vote_count ?? 0) - upvoterNames.length, 0)
  const address = streetOnly(concern.community_incident?.address || concern.address)

  const severity = concern.severity ?? entry.severity
  const assessed = concern.severity_assessed ?? entry.assessed
  const priorityLabel = assessed ? SEVERITY_LABEL[severity] : "Not yet assessed"
  const modelReason = (concern.severity_reason ?? concern.ai_assessment?.severity_reason ?? "").trim()
  const priorityWhy = assessed
    ? modelReason || priorityReasons({
        severity,
        urgentAttention: concern.urgent_attention ?? concern.ai_assessment?.urgent_attention ?? false,
        linkedReports: (concern.also_reported_count ?? 0) + 1,
        voteCount: concern.vote_count,
        categoryLabel: concern.category_ref?.name || categoryLabels[concern.category],
      })[0]
    : "the review model has not scored this report yet"

  const PriorityIcon = assessed ? (SEVERITY_ICON[severity] ?? ClockIcon) : ClockIcon
  const priorityTone = assessed ? (SEVERITY_TONE[severity] ?? "text-neutral-500") : "text-neutral-400"

  const [showRaw, setShowRaw] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<ConcernComment[] | null>(null)
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [preview, setPreview] = useState<{ items: MediaPreviewItem[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const commentCount = comments ? comments.length : (concern.comment_count ?? 0)

  async function openPreview() {
    if (previewLoading) return
    setPreviewLoading(true)
    try {
      const detail = await getConcern(concern.public_id)
      const images = (detail.media ?? []).filter((media) => media.mime_type.startsWith("image/"))
      const items = images.length
        ? images.map((media) =>
            toMediaPreviewItem(mediaDisplaySource(media), media.original_filename, media.mime_type, media),
          )
        : [{ src: concern.first_photo ?? "", filename: concern.title, kind: "image" as const }]
      setPreview({ items })
    } catch {
      setPreview({ items: [{ src: concern.first_photo ?? "", filename: concern.title, kind: "image" as const }] })
    } finally {
      setPreviewLoading(false)
    }
  }

  async function loadComments() {
    setCommentsLoading(true)
    try {
      const detail = await getConcern(concern.public_id)
      setComments(detail.comments ?? [])
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  async function toggleComments() {
    const next = !showComments
    setShowComments(next)
    if (next && comments == null) await loadComments()
  }

  async function submitComment() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      await commentOnConcern(concern.id, { body })
      setDraft("")
      await loadComments()
    } catch {
      toast.error("Could not post the comment.")
    } finally {
      setPosting(false)
    }
  }

  const metaRow = (
    <>
      <span className="shrink-0">{queueTime(concern.created_at)}</span>
      {othersCount > 0 ? (
        <>
          <span aria-hidden className="text-neutral-300">·</span>
          <span className="shrink-0">{othersCount} other{othersCount === 1 ? "" : "s"} reported this</span>
        </>
      ) : null}
    </>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={displayTitle}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col rounded-[24px] bg-white p-4 text-left ring-1 transition duration-150",
        active && "flex-1",
        active
          ? "ring-neutral-300"
          : "ring-neutral-200 hover:ring-neutral-300 focus-visible:ring-neutral-400",

      )}
      style={
        resident
          ? RESIDENT_ROW_TINT
          : tintBy === "Status"
            ? statusTintStyle(concern.status)
            : severityTintStyle(severity, assessed)
      }
    >
      {resident ? (
        <div className="flex items-center gap-2.5">
          {unitTag ? (
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full px-1 text-center text-[9px] font-bold leading-none", avatarTone)}>
              {unitTag}
            </span>
          ) : (
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", categoryTone(concern.category))}>
              {(() => {
                const Icon = resolveIconByKey(concern.category_ref?.icon_key)
                return Icon ? <Icon className="size-[17px] shrink-0" strokeWidth={1.8} /> : null
              })()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-normal leading-tight text-subtle-foreground">
              {unit ? unit.name : "Awaiting assignment"}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-faint-foreground">
              {concern.category_ref?.name || categoryLabels[concern.category]}
            </span>
          </span>
          <span className="mr-1.5 shrink-0" title={statusLabel}>
            <StatusGlyph className={cn("size-5", statusCls)} />
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold", avatarTone)}>
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-normal leading-tight text-subtle-foreground">
                {full}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-faint-foreground">
                {concern.category_ref?.name || categoryLabels[concern.category]}
              </span>
            </span>
            <span
              className={cn("flex shrink-0 items-center gap-1 text-[11px] font-medium", priorityTone)}
              title={`${priorityLabel} priority`}
            >
              <PriorityIcon className="size-3.5 shrink-0" strokeWidth={2} />
              {priorityLabel}
            </span>
            <span className="mr-1.5 shrink-0" title={statusLabel}>
              <StatusGlyph className={cn("size-5", statusCls)} />
            </span>
          </div>

          <p className="mt-2.5 text-[16px] font-medium leading-snug text-foreground">
            {concern.official_title || concern.title}
          </p>
        </>
      )}

      <div className={cn("flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint-foreground", resident ? "mt-2" : "mt-1")}>
        {metaRow}
      </div>
      {showBody ? (
        <>
          <div className="mt-1.5 border-t border-neutral-100" />
          <p className="mt-1.5 text-[12px] leading-relaxed text-subtle-foreground">
            {resident
              ? descriptionText || "No description provided."
              : summaryText || descriptionText || "No description provided."}
            {!resident && priorityWhy ? ` ${priorityWhy.replace(/\.*$/, ".")}` : null}
          </p>
          {!resident && summaryText && descriptionText && summaryText !== descriptionText ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  setShowRaw((value) => !value)
                }}
                className="mt-1 self-start text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-700"
              >
                {showRaw ? "Hide original" : "Show original"}
              </button>
              {showRaw ? (
                <p className="mt-1 border-l-2 border-neutral-200 pl-2.5 text-[12px] leading-relaxed text-faint-foreground">
                  {descriptionText}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {address ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-faint-foreground">
          <MapPinIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">{address}</span>
        </span>
      ) : null}

      {concern.first_photo ? (
        <div className={cn("relative mt-2.5", active && "flex min-h-0 flex-1 flex-col")}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void openPreview()
            }}
            className={cn(
              "block w-full cursor-zoom-in overflow-hidden rounded-[16px] bg-card-raised",
              active && "flex min-h-36 flex-1",
            )}
            aria-label="Open photo preview"
          >
            <AuthenticatedMediaImage
              src={concern.first_photo}
              alt={concern.title}
              className={cn("w-full object-cover", active ? "min-h-0 flex-1" : "h-36")}
            />
            {(concern.photo_count ?? 1) > 1 ? (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-bold text-white">
                +{(concern.photo_count ?? 1) - 1}
              </span>
            ) : null}
          </button>
        </div>
      ) : null}

      {isPublic ? (
        <div className="mt-3 border-t border-neutral-100 pt-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="flex -space-x-1.5">
                {upvoterNames.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="flex size-5 items-center justify-center rounded-full bg-slate-soft text-[8px] font-semibold text-navy-muted ring-1 ring-white"
                  >
                    {initialsOf(name).charAt(0)}
                  </span>
                ))}
                {extraUpvoters > 0 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100 text-[8px] font-semibold text-neutral-500 ring-1 ring-white">
                    +{extraUpvoters}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] font-normal text-faint-foreground">upvotes</span>
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void toggleComments()
              }}
              aria-label={showComments ? "Hide comments" : "See comments"}
              className={cn(
                "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
                showComments ? "text-neutral-800" : "text-neutral-500 hover:text-neutral-800",
              )}
            >
              <MessageCircleIcon className="size-3.5" strokeWidth={2} />
              <span>{commentCount}</span>
            </button>
          </div>

          {showComments ? (
            <div className="mt-3 space-y-3" onClick={(event) => event.stopPropagation()}>
              {commentsLoading ? (
                <p className="text-[11px] text-faint-foreground">Loading comments…</p>
              ) : (comments?.length ?? 0) === 0 ? (
                <p className="text-[11px] text-faint-foreground">No comments yet.</p>
              ) : (
                comments?.map((comment) => (
                  <div key={comment.id}>
                    <div className="flex items-stretch gap-2">
                      <div className="flex w-7 shrink-0 flex-col items-center">
                        <StaffAvatar name={comment.author?.full_name || "R"} role={comment.author?.role ?? ""} />
                        {(comment.replies ?? []).length > 0 ? (
                          <span aria-hidden className="w-px flex-1 bg-neutral-200" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-neutral-800">
                          {comment.author?.full_name || "Resident"}
                          <span className="ml-1.5 text-[10px] font-normal text-faint-foreground">
                            {queueTime(comment.created_at)}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">{comment.body}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo(replyTo === comment.id ? null : comment.id)
                            setReplyDraft("")
                          }}
                          className="mt-0.5 text-[10.5px] font-medium text-neutral-400 transition-colors hover:text-neutral-700"
                        >
                          {replyTo === comment.id ? "Cancel" : "Reply"}
                        </button>
                      </div>
                    </div>

                    {replyTo === comment.id ? (
                      <div className="ml-9 mt-1.5 flex items-center gap-2 rounded-full bg-neutral-100 py-0.5 pl-3 pr-0.5">
                        <input
                          autoFocus
                          value={replyDraft}
                          onChange={(event) => setReplyDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault()
                              const body = replyDraft.trim()
                              if (!body || posting) return
                              setPosting(true)
                              commentOnConcern(concern.id, { body, parent: comment.id })
                                .then(() => {
                                  setReplyDraft("")
                                  return loadComments()
                                })
                                .catch(() => toast.error("Could not post the reply."))
                                .finally(() => setPosting(false))
                            }
                          }}
                          placeholder={`Reply to ${comment.author?.full_name?.split(" ")[0] || "this comment"}…`}
                          className="h-7 min-w-0 flex-1 bg-transparent text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400"
                        />
                        <button
                          type="button"
                          disabled={posting || !replyDraft.trim()}
                          onClick={() => {
                            const body = replyDraft.trim()
                            if (!body || posting) return
                            setPosting(true)
                            commentOnConcern(concern.id, { body, parent: comment.id })
                              .then(() => {
                                setReplyDraft("")
                                setReplyTo(null)
                                return loadComments()
                              })
                              .catch(() => toast.error("Could not post the reply."))
                              .finally(() => setPosting(false))
                          }}
                          aria-label="Post reply"
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
                            replyDraft.trim() ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-400",
                          )}
                        >
                          <ArrowUpIcon className="size-3" strokeWidth={2.5} />
                        </button>
                      </div>
                    ) : null}

                    {(comment.replies ?? []).length > 0 ? (
                      <div className="mt-2 space-y-2.5">
                        {(comment.replies ?? []).map((reply) => (
                          <div key={reply.id} className="relative pl-9">
                            <div className="flex items-stretch gap-2">
                              <div className="relative flex w-7 shrink-0 flex-col items-center">
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute -left-[22px] -top-4 h-8 w-[22px] rounded-bl-[12px] border-b border-l border-neutral-200"
                                />
                                <StaffAvatar name={reply.author?.full_name || "R"} role={reply.author?.role ?? ""} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-neutral-800">
                                  {reply.author?.full_name || "Resident"}
                                  <span className="ml-1.5 text-[10px] font-normal text-faint-foreground">
                                    {queueTime(reply.created_at)}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">{reply.body}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              <div className="flex items-center gap-2 rounded-full bg-neutral-100 py-1 pl-3 pr-1">
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      void submitComment()
                    }
                  }}
                  placeholder="Add a comment"
                  className="h-8 min-w-0 flex-1 bg-transparent text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <button
                  type="button"
                  onClick={() => void submitComment()}
                  disabled={posting || !draft.trim()}
                  aria-label="Post comment"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                    draft.trim() ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-400",
                  )}
                >
                  <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {preview ? (
        <MediaLightbox items={preview.items} index={0} onClose={() => setPreview(null)} />
      ) : null}
    </div>
  )
}
