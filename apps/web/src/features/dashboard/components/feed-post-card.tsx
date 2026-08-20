/**
 * Shared feed post card — same markup as Home feed (avatar, body, media, votes, comments).
 * Used by Home and Resident Alerts Map expanded panel.
 */
import { useEffect, useState, type ReactNode } from "react"
import {
  BadgeCheckIcon,
  CheckCircle2Icon,
  CircleArrowUp,
  CircleCheck,
  GlobeIcon,
  MapPinIcon,
  MessageCircleIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  categoryLabel,
  concernBodyText,
} from "@/features/dashboard/components/feed-post-text"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { timeAgo } from "@/features/dashboard/lib/format"
import { mediaDisplaySource } from "@/features/dashboard/lib/authenticated-media"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { statusGroupOf, statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"
import { FS, IC, STROKE } from "@/features/dashboard/components/home/home-style"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import type { Concern, PublicUser } from "@/features/dashboard/api"
import {
  collectThreadMentionUsers,
  firstNameOf,
  mentionToken,
  toMentionUser,
} from "@/features/dashboard/components/comment-mentions"
import {
  PostMoreMenu,
  ReportPostDialog,
} from "@/features/dashboard/components/report-post-dialog"
import {
  CommentThread,
  fromConcernComment,
} from "@/features/dashboard/components/comments"

/**
 * Real comments are rendered by the shared `CommentThread`, so a concern, an
 * announcement and an emergency all use one row, one composer, one official
 * badge and one timestamp format.
 *
 * The resolution banner and the "neighbours also reported this" roll-up stay
 * local: they look like comments but are not, so they keep their own row and
 * are passed in as the thread's header.
 */
function PostCommentsBlock({
  post,
  isExpanded,
  commentInput,
  onCommentInputChange,
  onSubmitTopLevel,
  onSubmitReply,
  sessionUser,
  onEdit,
  onDelete,
  commentFieldId,
  onQuoteReply,
}: {
  post: Concern
  isExpanded: boolean
  commentInput: string
  onCommentInputChange: (value: string) => void
  onSubmitTopLevel: () => void
  onSubmitReply: (body: string, parentId: number) => void
  sessionUser: PublicUser | null
  onEdit: (commentId: number, body: string) => void
  onDelete: (commentId: number) => void
  commentFieldId: string
  onQuoteReply: (name: string) => void
}) {
  if (!isExpanded) return null

  const mentionUsers = collectThreadMentionUsers(post, sessionUser)
  const unified = post.comments.map((comment) => fromConcernComment(comment, sessionUser))

  return (
    <CommentThread
      className="pt-1"
      comments={unified}
      sessionUser={sessionUser}
      mentionUsers={mentionUsers}
      composerId={commentFieldId}
      collapseToLatest
      allowReplies
      value={commentInput}
      onValueChange={onCommentInputChange}
      onSubmit={(body: string, parentId: number | null) => {
        if (parentId == null) onSubmitTopLevel()
        else onSubmitReply(body, parentId)
      }}
      onEdit={onEdit}
      onDelete={onDelete}
      header={
        <>
          <ResolutionBanner post={post} onReply={onQuoteReply} />
          <RelatedReports post={post} onReply={onQuoteReply} />
        </>
      }
    />
  )
}


export type FeedPostCardProps = {
  post: Concern
  sessionUser: PublicUser | null
  /** When true, comments section is open (alerts map always wants this on expand) */
  commentsExpanded?: boolean
  onCommentsExpandedChange?: (open: boolean) => void
  focusCommentOnMount?: boolean
  onVote: (post: Concern) => void
  onComment: (postId: number, body: string, parent?: number | null) => Promise<void>
  onEditComment: (postId: number, commentId: number, body: string) => Promise<void>
  onDeleteComment: (postId: number, commentId: number) => Promise<void>
  /** Optional outer class (e.g. strip border when nested in panel) */
  className?: string
  /** Hide report menu (default false) */
  hideMoreMenu?: boolean
}

/**
 * Exact Home-feed post layout: header, body, media, vote/comment, threaded comments.
 */
const AVATAR_CLASS = "!size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"

function CommentRow({
  avatar,
  name,
  meta,
  badge,
  onReply,
  children,
}: {
  avatar: ReactNode
  name: string
  meta: string
  badge?: ReactNode
  onReply?: () => void
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="relative shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
          <span className="font-semibold text-neutral-900">{name}</span>
          {badge}
          <span className="text-neutral-500">· {meta}</span>
        </p>
        {children}
        {onReply ? (
          <button
            type="button"
            onClick={onReply}
            className="mt-1 text-[12px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
          >
            Reply
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ResolutionBanner({ post, onReply }: { post: Concern; onReply?: (prefix: string) => void }) {
  const group = statusGroupOf(post.status)
  if (group !== "closed") return null

  const evidence = (post.resolution_evidence ?? []).filter((item) =>
    item.mime_type?.startsWith("image/"),
  )
  const publicReportEvidence = (post.media ?? []).filter(
    (item) => item.mime_type?.startsWith("image/") && item.public_visible,
  )
  const displayEvidence = evidence.length ? evidence : publicReportEvidence
  const closingEvent = [...(post.status_events ?? [])]
    .reverse()
    .find((event) => event.status === post.status)
  const detail =
    (post.update_text || "").trim() ||
    closingEvent?.note ||
    "The barangay has completed the reported work."
  const official = evidence[0]?.uploaded_by ?? closingEvent?.actor ?? null
  const when = closingEvent?.created_at ?? post.updated_at

  const officialName = official?.full_name || "Barangay Hall"
  const replyPrefix = official?.id
    ? mentionToken(toMentionUser(official))
    : firstNameOf(officialName)
  const positive = post.status === "resolved"

  return (
    <div>
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1 text-[11px] font-semibold",
          positive ? "text-status-closed" : "text-neutral-500",
        )}
      >
        <CheckCircle2Icon className="size-3 shrink-0" strokeWidth={2.4} />
        {positive
          ? "Issue was resolved"
          : statusLabelOf(post.status, "resident", "concern")}
      </p>

      <CommentRow
        avatar={
          official ? (
            <>
              <UserAvatar user={official} size="sm" className={AVATAR_CLASS} />
              <BadgeCheckIcon
                aria-label="Verified barangay official"
                className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white text-brand-navy"
                strokeWidth={2.4}
              />
            </>
          ) : (
            <>
              <span className="flex size-8 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
                BH
              </span>
              <BadgeCheckIcon
                aria-label="Verified barangay official"
                className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-white text-brand-navy"
                strokeWidth={2.4}
              />
            </>
          )
        }
        name={officialName}
        meta={`${timeAgo(when)} · Official update`}
        onReply={onReply ? () => onReply(replyPrefix) : undefined}
      >
        {detail ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-neutral-900">{detail}</p>
        ) : null}
        {displayEvidence.length ? (
          <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
            {displayEvidence.slice(0, 3).map((item) => (
              <AuthenticatedMediaImage
                key={item.id}
                src={mediaDisplaySource(item)}
                alt="Proof of the completed work"
                className="h-24 w-32 shrink-0 rounded-xl object-cover"
              />
            ))}
          </div>
        ) : null}
      </CommentRow>
    </div>
  )
}

function RelatedReports({ post, onReply }: { post: Concern; onReply?: (prefix: string) => void }) {
  const [open, setOpen] = useState(true)
  const incident = post.community_incident
  const linked = incident?.reports?.filter((entry) => !entry.is_primary) ?? []
  if (linked.length === 0) return null

  const photosFor = (reportId: number) =>
    (incident?.photos ?? []).filter(
      (photo) => photo.report_id === reportId && photo.mime_type?.startsWith("image/"),
    )

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-600 transition-colors hover:text-neutral-900"
      >
        <UsersIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
        {linked.length === 1
          ? "1 neighbour also reported this"
          : `${linked.length} neighbours also reported this`}
        <span className="text-neutral-400">{open ? "· Hide" : "· Show"}</span>
      </button>

      {open ? (
        <div className="mt-2.5 space-y-3.5">
          {linked.map((entry) => {
            const photos = photosFor(entry.id)
            return (
              <CommentRow
                key={entry.id}
                avatar={
                  <span className="flex size-8 items-center justify-center rounded-full bg-slate-soft text-[13px] font-semibold text-navy-muted">
                    {entry.reporter_name.slice(0, 1).toUpperCase()}
                  </span>
                }
                name={entry.reporter_name}
                meta={`${timeAgo(entry.submitted_at)} · also reported this`}
                onReply={onReply ? () => onReply(firstNameOf(entry.reporter_name)) : undefined}
              >
                <p className="mt-0.5 text-[14px] leading-relaxed text-neutral-900">
                  {entry.description}
                </p>
                {photos.length ? (
                  <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                    {photos.slice(0, 3).map((photo) => (
                      <AuthenticatedMediaImage
                        key={photo.id}
                        src={mediaDisplaySource(photo)}
                        alt=""
                        className="h-24 w-32 shrink-0 rounded-xl object-cover"
                      />
                    ))}
                  </div>
                ) : null}
              </CommentRow>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export function FeedPostCard({
  post,
  sessionUser,
  commentsExpanded: commentsExpandedProp,
  onCommentsExpandedChange,
  focusCommentOnMount,
  onVote,
  onComment,
  onEditComment,
  onDeleteComment,
  className,
  hideMoreMenu = false,
}: FeedPostCardProps) {
  const [internalExpanded, setInternalExpanded] = useState(true)
  const isExpanded = commentsExpandedProp ?? internalExpanded
  const setExpanded = (open: boolean) => {
    onCommentsExpandedChange?.(open)
    if (commentsExpandedProp === undefined) setInternalExpanded(open)
  }

  const [commentInput, setCommentInput] = useState("")
  const [menuOpenPost, setMenuOpenPost] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const street = streetSegment(post.address) || streetSegment(post.reporter.street)
  const barangay = (post.barangay || "").trim()
  const pinnedLocation =
    [street, barangay].filter(Boolean).join(", ") || "Location pinned on the map"
  const commentFieldId = `feed-post-comment-${post.id}`
  // The comment icon counts every row shown in the thread: real comments plus
  // the resolution banner and the "neighbours also reported" entries.
  const resolutionRows = statusGroupOf(post.status) === "closed" ? 1 : 0
  const relatedRows = (post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []).length
  const totalCommentRows = post.comment_count + resolutionRows + relatedRows

  useEffect(() => {
    if (!focusCommentOnMount) return
    // Defer the expandState a microtask so parent state propagation doesn't
    // happen as a synchronous render-phase side effect; focus once it renders.
    queueMicrotask(() => setExpanded(true))
    window.requestAnimationFrame(() => {
      document.getElementById(commentFieldId)?.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCommentOnMount, post.id])

  async function submitTopLevel() {
    const body = commentInput.trim()
    if (!body) return
    await onComment(post.id, body, null)
    setCommentInput("")
  }

  async function submitReply(body: string, parentId: number) {
    if (!body.trim()) return
    await onComment(post.id, body, parentId)
  }

  return (
    <>
      <article
        className={cn(
          "relative rounded-lg border border-neutral-300 bg-white",
          className,
        )}
      >
        <div className="flex gap-2.5 p-3.5 pb-0">
          <UserAvatar user={post.reporter} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("truncate font-bold text-neutral-900", FS.author)}>
                  {post.reporter.full_name}
                </p>
                <div className="text-[13px] leading-snug text-neutral-500 sm:text-[14px]">
                  <p className="flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5">
                    <span className="shrink-0">{categoryLabel(post.category)}</span>
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
                      <span aria-hidden>·</span>
                      <MapPinIcon
                        className="size-3 shrink-0 text-neutral-400"
                        strokeWidth={2.3}
                        aria-hidden
                      />
                      <span className="min-w-0 break-words">{pinnedLocation}</span>
                    </span>
                  </p>
                  <p className="mt-0.5 flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="shrink-0">{timeAgo(post.created_at)}</span>
                    <GlobeIcon className={cn(IC.xxs, "shrink-0")} strokeWidth={STROKE} aria-hidden />
                    {statusGroupOf(post.status) === "closed" ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-status-closed">
                          <CircleCheck className="size-3.5 shrink-0" strokeWidth={2.4} />
                          {statusLabelOf(post.status, "resident", "concern")}
                        </span>
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              {!hideMoreMenu ? (
                <PostMoreMenu
                  open={menuOpenPost}
                  onOpenChange={setMenuOpenPost}
                  onReport={() => setReportOpen(true)}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 p-3.5 pt-2">
          <p className={cn("leading-relaxed text-neutral-900", FS.body)}>
            {concernBodyText(post)}
          </p>
        </div>

        {post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? (
          <div className="mt-2.5 border-y border-neutral-200">
            <img
              src={post.media[0].preview_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="max-h-80 w-full object-cover"
            />
          </div>
        ) : null}

        <div className="space-y-2.5 p-3.5 pt-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onVote(post)}
              aria-label={post.user_vote === 1 ? "Remove upvote" : "Upvote"}
              aria-pressed={post.user_vote === 1}
              className={cn(
                "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2.5 text-neutral-500 transition-colors",
                "hover:bg-neutral-200/80 hover:text-neutral-800",
                "active:text-neutral-800",
                post.user_vote === 1 && "bg-neutral-200/90 text-neutral-800",
              )}
            >
              <CircleArrowUp className="size-7 shrink-0" strokeWidth={STROKE} />
              {post.vote_count > 0 ? (
                <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                  {post.vote_count}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !isExpanded
                setExpanded(next)
                window.requestAnimationFrame(() => {
                  if (next) document.getElementById(commentFieldId)?.focus()
                })
              }}
              aria-label={isExpanded ? "Hide comments" : "Show comments"}
              aria-expanded={isExpanded}
              className={cn(
                "group inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2.5 text-neutral-700 transition-colors",
                "hover:bg-neutral-200/80",
                isExpanded ? "opacity-100" : "opacity-70 hover:opacity-100 active:opacity-100",
              )}
            >
              <MessageCircleIcon className="size-6 shrink-0" />
              {totalCommentRows > 0 ? (
                <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                  {totalCommentRows}
                </span>
              ) : null}
            </button>
          </div>

          <PostCommentsBlock
            post={post}
            isExpanded={isExpanded}
            commentInput={commentInput}
            onCommentInputChange={setCommentInput}
            onSubmitTopLevel={() => void submitTopLevel()}
            onSubmitReply={(body, parentId) => void submitReply(body, parentId)}
            sessionUser={sessionUser}
            onEdit={(commentId, body) => void onEditComment(post.id, commentId, body)}
            onDelete={(commentId) => void onDeleteComment(post.id, commentId)}
            commentFieldId={commentFieldId}
            onQuoteReply={(prefix) => {
              setCommentInput((current) => (current.trim() ? current : `${prefix} `))
              window.requestAnimationFrame(() => {
                document.getElementById(commentFieldId)?.focus()
              })
            }}
          />
        </div>
      </article>

      <ReportPostDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        concernId={post.id}
      />
    </>
  )
}
