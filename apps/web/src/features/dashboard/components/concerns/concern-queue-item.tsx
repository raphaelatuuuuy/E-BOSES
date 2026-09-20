import { useCallback, useState } from "react"
import { toast } from "sonner"
import {
  Check,
  ClockIcon,
  MapPinIcon,
  MessageCircleIcon,
  ShieldUserIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { ReportPhotoPreview } from "@/features/dashboard/components/concerns/resolved-photo"
import {
  categoryLabels,
  formatDate,
  formatTime,
  truncateDescription,
  unitShortTag,
} from "@/features/dashboard/components/concerns/concern-display"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"
import {
  priorityReasons,
  SEVERITY_LABEL,
} from "@/features/dashboard/components/record/severity"
import {
  commentOnConcern,
  getConcern,
  type Concern,
  type ConcernComment,
  type PublicUser,
} from "@/features/dashboard/api"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { concernSummaryText } from "@/features/dashboard/components/feed-post-text"
import {
  CommentAttachment,
  CommentComposer,
} from "@/features/dashboard/components/comments"

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
  critical: "var(--color-severity-critical-map-surface)",
  high: "#fae2e0",
  moderate: "var(--color-severity-moderate-surface)",
  low: "#f4f4f5",
}

export const SEVERITY_TONE: Record<string, string> = {
  critical: "text-severity-critical-map-ink",
  high: "text-[#cf4a40]",
  moderate: "text-severity-moderate",
  low: "text-neutral-600",
}

export const SEVERITY_ICON: Record<string, typeof ClockIcon> = {
  critical: SignalHighIcon,
  high: SignalHighIcon,
  moderate: SignalMediumIcon,
  low: SignalLowIcon,
}

const STATUS_TINT: Record<string, string> = {
  resolved: "var(--color-status-closed-surface)",
  rejected: "var(--color-severity-critical-surface)",
  appealed: "var(--color-severity-moderate-surface)",
  submitted: "var(--color-status-active-surface)",
  under_review: "var(--color-status-active-surface)",
  assigned: "var(--color-brand-orange-soft)",
  in_progress: "var(--color-brand-orange-soft)",
}

export function statusTintStyle(status: string) {
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
  const raw =
    parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : (parts[0]?.[0] ?? "R")
  return raw.toUpperCase()
}

export function concernReporterName(concern: RankedConcern["concern"]) {
  const primary = concern.community_incident?.reports?.find(
    (report) => report.is_primary
  )
  const fromReporter =
    concern.reporter?.full_name?.trim() ||
    (concern.reporter_full_name ?? "").trim()
  if (fromReporter && fromReporter.toLowerCase() !== "resident")
    return fromReporter
  const mediaNameRaw = concern.media?.find(
    (media) => "reporter_name" in media
  )?.reporter_name
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
  if (date.toDateString() === now.toDateString())
    return `Today at ${formatter.format(date)}`
  if (
    new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString()
  )
    return `Yesterday at ${formatter.format(date)}`
  return formatter.format(date)
}

function staffBadgeClass(role: string) {
  if (role === "barangay_official") return "bg-brand-orange"
  if (role === "first_responder") return "bg-brand-blue"
  return ""
}

function StaffAvatar({ user, name, role }: { user?: PublicUser | null; name: string; role: string }) {
  const badge = staffBadgeClass(role)
  return (
    <span className="relative shrink-0">
      <UserAvatar
        user={user ?? { full_name: name }}
        size="sm"
        className={cn("!size-7 text-[11px]", avatarTone)}
      />
      {badge ? (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full ring-1 ring-white",
            badge
          )}
        >
          <ShieldUserIcon className="size-1.5 text-white" strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  )
}

type ConcernEngagementSource = Pick<
  Concern,
  "visibility" | "upvoters" | "vote_count" | "comment_count"
>

/** Shared public-report footer used by queue rows and report detail views. */
export function ConcernEngagementFooter({
  concern,
  commentCount = concern.comment_count ?? 0,
  commentsOpen = false,
  onCommentsClick,
}: {
  concern: ConcernEngagementSource
  commentCount?: number
  commentsOpen?: boolean
  onCommentsClick?: () => void
}) {
  if (concern.visibility !== "community") return null

  const upvoterNames = (concern.upvoters ?? []).slice(0, 3)
  const extraUpvoters = Math.max(
    (concern.vote_count ?? 0) - upvoterNames.length,
    0
  )
  const upvoteCount = Math.max(concern.vote_count ?? 0, 0)
  const safeCommentCount = Math.max(commentCount, 0)
  const commentContent = (
    <>
      <MessageCircleIcon className="size-3.5" strokeWidth={2} />
      <span>{safeCommentCount} comments</span>
    </>
  )

  return (
    <div className="mt-3 border-t border-neutral-100 pt-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex -space-x-1.5" aria-hidden="true">
            {upvoterNames.map((name, i) => (
              <UserAvatar
                key={`${name}-${i}`}
                user={{ full_name: name }}
                size="sm"
                className="!size-5 text-[8px] ring-1 ring-white"
              />
            ))}
            {extraUpvoters > 0 ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100 text-[8px] font-semibold text-neutral-500 ring-1 ring-white">
                +{extraUpvoters}
              </span>
            ) : null}
          </div>
          <span className="text-[10px] font-medium text-neutral-500">
            {upvoteCount} {upvoteCount === 1 ? "upvote" : "upvotes"}
          </span>
        </div>

        {onCommentsClick ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onCommentsClick()
            }}
            aria-label={commentsOpen ? "Hide comments" : "See comments"}
            className={cn(
              "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
              commentsOpen
                ? "text-neutral-800"
                : "text-neutral-500 hover:text-neutral-800"
            )}
          >
            {commentContent}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-neutral-500">
            {commentContent}
          </span>
        )}
      </div>
    </div>
  )
}

export function useConcernComments(publicId: string) {
  const [comments, setComments] = useState<ConcernComment[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const detail = await getConcern(publicId)
      setComments(detail.comments ?? [])
    } catch {
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [publicId])

  return { comments, loading, load }
}

function commentRows(
  comments: ConcernComment[],
  depth = 0
): Array<{ comment: ConcernComment; depth: number }> {
  return comments.flatMap((comment) => [
    { comment, depth },
    ...commentRows(comment.replies ?? [], depth + 1),
  ])
}

export function ConcernCommentsList({
  comments,
  loading,
}: {
  comments: ConcernComment[] | null
  loading: boolean
}) {
  if (loading)
    return (
      <p className="mt-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
        Loading comments…
      </p>
    )
  if (!comments?.length)
    return (
      <p className="mt-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
        No comments yet.
      </p>
    )

  return (
    <div className="mt-3 space-y-3 border-t border-neutral-100 pt-3">
      {commentRows(comments).map(({ comment, depth }) => (
        <div
          key={comment.id}
          className={cn(depth > 0 && "ml-7 border-l border-neutral-200 pl-3")}
        >
          <div className="flex items-start gap-2">
            <StaffAvatar
              user={comment.author}
              name={comment.author?.full_name || "R"}
              role={comment.author?.role ?? ""}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-neutral-800">
                {comment.author?.full_name || "Resident"}
                <span className="ml-1.5 text-[10px] font-normal text-neutral-500">
                  {queueTime(comment.created_at)}
                </span>
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">
                {comment.body}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ConcernQueueItem({
  entry,
  active,
  onSelect,
  variant = "staff",
}: {
  entry: RankedConcern
  active: boolean
  onSelect: () => void
  variant?: "staff" | "resident"
}) {
  const { user } = useAuthSession()
  const { concern } = entry
  const resident = variant === "resident"
  const unit =
    concern.validation_status === "accepted"
      ? (concern.assigned_department ??
        concern.community_incident?.assigned_unit ??
        null)
      : null
  const unitTag = unitShortTag(unit)
  const titleText = concern.title?.trim() || ""
  const summaryText = concern.summary?.trim() || ""
  const descriptionText = concern.description?.trim() || ""
  const generatedSummary = concernSummaryText({
    title: titleText,
    description: descriptionText,
    summary: summaryText,
  })
  const displayTitle = titleText || truncateDescription(descriptionText, 60)
  const showBody = Boolean(descriptionText || generatedSummary)
  const full = concernReporterName(concern)
  const othersCount = concern.also_reported_count ?? 0

  const isPublic = concern.visibility === "community"
  // A machine address ("Pinned location") must not hide the location row —
  // fall back to the barangay so every report still shows where it is.
  const address =
    streetOnly(concern.community_incident?.address || concern.address) ||
    (concern.barangay || "").trim()

  const severity = concern.severity ?? entry.severity
  const assessed = concern.severity_assessed ?? entry.assessed
  // A resolved report is done no matter how severe it once was — the corner
  // badge reads "Resolved" with a check instead of the old priority label.
  const concernResolved = isResolvedRecord(concern)
  const priorityLabel = assessed ? SEVERITY_LABEL[severity] : "Not yet assessed"
  const modelReason = (
    concern.severity_reason ??
    concern.ai_assessment?.severity_reason ??
    ""
  ).trim()
  const priorityWhy = assessed
    ? modelReason ||
      priorityReasons({
        severity,
        linkedReports: (concern.also_reported_count ?? 0) + 1,
        voteCount: concern.vote_count,
        categoryLabel:
          concern.category_ref?.name || categoryLabels[concern.category],
      })[0]
    : "the review model has not scored this report yet"
  const PriorityIcon = assessed
    ? (SEVERITY_ICON[severity] ?? ClockIcon)
    : ClockIcon
  const priorityTone = assessed
    ? (SEVERITY_TONE[severity] ?? "text-neutral-500")
    : "text-neutral-500"

  const [showComments, setShowComments] = useState(false)
  const [detail, setDetail] = useState<Concern | null>(null)
  const [comments, setComments] = useState<ConcernComment[] | null>(() => {
    const bundled = concern.comments ?? []
    return commentRows(bundled).length >= (concern.comment_count ?? 0)
      ? bundled
      : null
  })
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [preview, setPreview] = useState<{ items: MediaPreviewItem[] } | null>(
    null
  )
  const [previewLoading, setPreviewLoading] = useState(false)

  const commentCount = comments
    ? commentRows(comments).length
    : (concern.comment_count ?? 0)

  async function openPreview() {
    if (previewLoading) return
    setPreviewLoading(true)
    try {
      const detail = await getConcern(concern.public_id)
      const proof = (detail.resolution_evidence ?? []).filter((media) =>
        media.mime_type.startsWith("image/")
      )
      const images = (detail.media ?? []).filter((media) =>
        media.mime_type.startsWith("image/")
      )
      const items =
        proof.length || images.length
          ? [
              ...images.map((media) => ({
                ...toMediaPreviewItem(
                  mediaDisplaySource(media),
                  media.original_filename,
                  media.mime_type,
                  media
                ),
                eyebrow:
                  streetOnly(
                    detail.community_incident?.address || detail.address
                  ) || undefined,
                postedLabel: `${formatDate(detail.created_at)} at ${formatTime(detail.created_at)}`,
                heading:
                  (detail.notification_subject || detail.title || "").trim() ||
                  undefined,
                badge: "Reported issue",
                blurb: (detail.description || "").trim() || undefined,
              })),
              ...proof.map((media) => ({
                ...toMediaPreviewItem(
                  media.preview_url || media.raw_url,
                  media.original_filename,
                  media.mime_type
                ),
                eyebrow:
                  streetOnly(
                    detail.community_incident?.address || detail.address
                  ) || undefined,
                postedLabel: `${formatDate(detail.created_at)} at ${formatTime(detail.created_at)}`,
                heading:
                  (detail.notification_subject || detail.title || "").trim() ||
                  undefined,
                badge: "Resolved case",
                blurb: (detail.description || "").trim() || undefined,
              })),
            ]
          : [
              {
                src: concern.first_photo ?? "",
                filename: concern.title,
                kind: "image" as const,
              },
            ]
      setPreview({ items })
    } catch {
      setPreview({
        items: [
          {
            src: concern.first_photo ?? "",
            filename: concern.title,
            kind: "image" as const,
          },
        ],
      })
    } finally {
      setPreviewLoading(false)
    }
  }

  async function loadComments() {
    setCommentsLoading(true)
    try {
      const detail = await getConcern(concern.public_id)
      setDetail(detail)
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
    // List rows are intentionally slim and do not include resolution proof.
    // Fetch the full record before opening a resolved thread so the resolver
    // comment can render its proof image as well as its text.
    if (next && (comments == null || (concernResolved && detail == null)))
      await loadComments()
  }

  async function submitComment(media?: File | null): Promise<boolean> {
    const body = draft.trim()
    if ((!body && !media) || posting) return false
    setPosting(true)
    try {
      await commentOnConcern(concern.id, { body, media })
      setDraft("")
      await loadComments()
      return true
    } catch {
      toast.error("Could not post the comment.")
      return false
    } finally {
      setPosting(false)
    }
  }

  async function submitReply(
    commentId: number,
    media?: File | null
  ): Promise<boolean> {
    const body = replyDraft.trim()
    if ((!body && !media) || posting) return false
    setPosting(true)
    try {
      await commentOnConcern(concern.id, { body, parent: commentId, media })
      setReplyDraft("")
      setReplyTo(null)
      await loadComments()
      return true
    } catch {
      toast.error("Could not post the reply.")
      return false
    } finally {
      setPosting(false)
    }
  }

  const metaRow = (
    <>
      <span className="shrink-0">{queueTime(concern.created_at)}</span>
      {othersCount > 0 ? (
        <>
          <span aria-hidden className="text-neutral-300">
            ·
          </span>
          <span className="shrink-0">
            {othersCount} other{othersCount === 1 ? "" : "s"} reported this
          </span>
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
        "focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 focus-visible:outline-none"
      )}
    >
      {resident ? (
        <div className="flex items-center gap-2.5">
          {unitTag ? (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full px-1 text-center text-[9px] leading-none font-bold",
                avatarTone
              )}
            >
              {unitTag}
            </span>
          ) : (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                categoryTone(concern.category)
              )}
            >
              {(() => {
                if (concernResolved) {
                  return (
                    <Check
                      className="size-[17px] shrink-0 text-emerald-600"
                      strokeWidth={2.5}
                    />
                  )
                }
                const Icon = resolveIconByKey(concern.category_ref?.icon_key)
                return Icon ? (
                  <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
                ) : null
              })()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium text-neutral-700">
              {unit ? unit.name : "Awaiting assignment"}
            </span>
            <span className="mt-0.5 block truncate text-[11px] leading-tight font-medium text-neutral-500">
              {concern.category_ref?.name || categoryLabels[concern.category]}
            </span>
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <UserAvatar
              user={concern.reporter}
              size="sm"
              className={cn("!size-9 text-[14px]", avatarTone)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight font-medium text-neutral-700">
                {full}
              </span>
              <span className="mt-0.5 block truncate text-[11px] leading-tight font-medium text-neutral-500">
                {concern.category_ref?.name || categoryLabels[concern.category]}
              </span>
            </span>
            {concernResolved ? (
              <span className="mr-1.5 shrink-0 text-[11px] font-medium text-emerald-700">
                Resolved
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-[11px] font-medium",
                    priorityTone
                  )}
                  title={`${priorityLabel} priority`}
                >
                  <PriorityIcon className="size-3.5 shrink-0" strokeWidth={2} />
                  {priorityLabel}
                </span>
              </>
            )}
          </div>

          <p className="mt-2.5 text-[16px] leading-snug font-medium text-foreground">
            {concern.official_title || concern.title}
          </p>
        </>
      )}

      <div
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-[11.5px] text-neutral-500",
          resident ? "mt-2" : "mt-1"
        )}
      >
        {metaRow}
      </div>
      {showBody ? (
        <>
          <div className="mt-1.5 border-t border-neutral-100" />
          {descriptionText ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-700">
              {descriptionText}
            </p>
          ) : null}
          {generatedSummary ? (
            <div
              className={cn(
                "mt-1.5 flex w-full items-start gap-2 rounded-lg px-3 py-2.5",
                severity === "critical"
                  ? "bg-severity-critical-surface text-severity-critical-ink"
                  : "bg-brand-orange-soft text-orange-800"
              )}
            >
              <TriangleAlertIcon
                className="mt-[2px] size-5 shrink-0"
                strokeWidth={1.9}
                aria-hidden
              />
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed whitespace-pre-wrap">
                {generatedSummary}
                {!resident && priorityWhy
                  ? ` ${priorityWhy.replace(/\.*$/, ".")}`
                  : null}
              </p>
            </div>
          ) : null}
        </>
      ) : null}

      {address ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-neutral-600">
          <MapPinIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">{address}</span>
        </span>
      ) : null}

      {concern.first_photo ? (
        <div
          className={cn(
            "relative mt-2.5",
            active && "flex min-h-0 flex-1 flex-col"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <ReportPhotoPreview
            originalSrc={concern.first_photo}
            resolutionSrc={concern.resolution_photo}
            alt={concern.title}
            onOpen={() => void openPreview()}
          />
        </div>
      ) : null}

      {isPublic ? (
        <>
          <ConcernEngagementFooter
            concern={concern}
            commentCount={commentCount}
            commentsOpen={showComments}
            onCommentsClick={() => void toggleComments()}
          />
          {showComments ? (
            <div
              className="mt-3 space-y-3"
              onClick={(event) => event.stopPropagation()}
            >
              {commentsLoading ? (
                <p className="text-[11px] text-neutral-500">
                  Loading comments…
                </p>
              ) : (comments?.length ?? 0) === 0 ? (
                <p className="text-[11px] text-neutral-500">No comments yet.</p>
              ) : (
                comments?.map((comment) => (
                  <div key={comment.id}>
                    <div className="flex items-stretch gap-2">
                      <div className="flex w-7 shrink-0 flex-col items-center">
                        <StaffAvatar
                          user={comment.author}
                          name={comment.author?.full_name || "R"}
                          role={comment.author?.role ?? ""}
                        />
                        {(comment.replies ?? []).length > 0 ? (
                          <span
                            aria-hidden
                            className="w-px flex-1 bg-neutral-200"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium text-neutral-800">
                          {comment.author?.full_name || "Resident"}
                          <span className="ml-1.5 text-[10px] font-normal text-neutral-500">
                            {queueTime(comment.created_at)}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">
                          {comment.body}
                        </p>
                        <CommentAttachment
                          attachment={comment.attachment ?? null}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo(
                              replyTo === comment.id ? null : comment.id
                            )
                            setReplyDraft("")
                          }}
                          className="mt-0.5 text-[10.5px] font-medium text-neutral-600 transition-colors hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-1 focus-visible:outline-none"
                        >
                          {replyTo === comment.id ? "Cancel" : "Reply"}
                        </button>
                      </div>
                    </div>

                    {replyTo === comment.id ? (
                      <CommentComposer
                        compact
                        autoFocus
                        className="mt-1.5 ml-9"
                        value={replyDraft}
                        onChange={setReplyDraft}
                        onSubmit={(media) => submitReply(comment.id, media)}
                        placeholder={`Reply to ${comment.author?.full_name?.split(" ")[0] || "this comment"}…`}
                        sessionUser={user}
                        disabled={posting}
                      />
                    ) : null}

                    {(comment.replies ?? []).length > 0 ? (
                      <div className="mt-2 space-y-2.5">
                        {(comment.replies ?? []).map((reply) => (
                          <div key={reply.id} className="relative pl-9">
                            <div className="flex items-stretch gap-2">
                              <div className="relative flex w-7 shrink-0 flex-col items-center">
                                <span
                                  aria-hidden
                                  className="pointer-events-none absolute -top-4 -left-[22px] h-8 w-[22px] rounded-bl-[12px] border-b border-l border-neutral-200"
                                />
                                <StaffAvatar
                                  user={reply.author}
                                  name={reply.author?.full_name || "R"}
                                  role={reply.author?.role ?? ""}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium text-neutral-800">
                                  {reply.author?.full_name || "Resident"}
                                  <span className="ml-1.5 text-[10px] font-normal text-neutral-500">
                                    {queueTime(reply.created_at)}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">
                                  {reply.body}
                                </p>
                                <CommentAttachment
                                  attachment={reply.attachment ?? null}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              <CommentComposer
                compact
                value={draft}
                onChange={setDraft}
                onSubmit={submitComment}
                sessionUser={user}
                disabled={posting}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {preview ? (
        <MediaLightbox
          items={preview.items}
          index={0}
          simpleCounter
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  )
}
