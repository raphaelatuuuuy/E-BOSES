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
import { formatDate } from "@/features/dashboard/components/concerns/concern-display"
import { mediaDisplaySource } from "@/features/dashboard/lib/authenticated-media"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { statusGroupOf, statusLabelOf } from "@/features/dashboard/lib/status-vocabulary"
import { FS, STROKE } from "@/features/dashboard/components/home/home-style"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import type { CommunityIncidentReport, Concern, PublicUser } from "@/features/dashboard/api"
import {
  collectThreadMentionUsers,
  firstNameOf,
  mentionToken,
  toMentionUser,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import {
  PostMoreMenu,
  ReportPostDialog,
  type ReportTarget,
} from "@/features/dashboard/components/report-post-dialog"
import {
  CommentThread,
  fromConcernComment,
  type CommentThreadAnchor,
  type UnifiedComment,
} from "@/features/dashboard/components/comments"
import {
  CommentComposer,
  COMMENT_MIN_LENGTH,
} from "@/features/dashboard/components/comments/comment-composer"
import {
  CommentAction,
  REPLY_INDENT,
} from "@/features/dashboard/components/comments/comment-row"

/**
 * Real comments are rendered by the shared `CommentThread`, so a concern, an
 * announcement and an emergency all use one row, one composer, one official
 * badge and one timestamp format.
 *
 * The resolution banner and the "neighbours also reported this" roll-up stay
 * local: they look like comments but are not, so they keep their own row and
 * are passed in as thread anchors that pin their replies beneath them.
 */
function resolutionOfficial(post: Concern) {
  const evidence = (post.resolution_evidence ?? []).filter((item) =>
    item.mime_type?.startsWith("image/"),
  )
  const closingEvent = [...(post.status_events ?? [])]
    .reverse()
    .find((event) => event.status === post.status)
  return evidence[0]?.uploaded_by ?? closingEvent?.actor ?? null
}

function relatedReports(post: Concern) {
  return post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []
}

function officialReplyPrefix(post: Concern) {
  const official = resolutionOfficial(post)
  return official?.id
    ? `${mentionToken(toMentionUser(official))} `
    : `${firstNameOf(official?.full_name || "Barangay Hall")} `
}

function reportReplyPrefix(entry: CommunityIncidentReport) {
  return entry.reporter_id
    ? `${mentionToken(toMentionUser({ id: entry.reporter_id, full_name: entry.reporter_name }))} `
    : `${firstNameOf(entry.reporter_name)} `
}

function PostCommentsBlock({
  post,
  isExpanded,
  commentInput,
  onCommentInputChange,
  onSubmitTopLevel,
  onSubmitReply,
  onSubmitInline,
  sessionUser,
  onEdit,
  onDelete,
  onReport,
  commentFieldId,
}: {
  post: Concern
  isExpanded: boolean
  commentInput: string
  onCommentInputChange: (value: string) => void
  onSubmitTopLevel: () => void
  onSubmitReply: (body: string, parentId: number) => void
  onSubmitInline: (body: string) => Promise<void> | void
  sessionUser: PublicUser | null
  onEdit: (commentId: number, body: string) => void
  onDelete: (commentId: number) => void
  onReport: (commentId: number) => void
  commentFieldId: string
}) {
  const [reportsOpen, setReportsOpen] = useState(true)

  if (!isExpanded) return null

  const mentionUsers = collectThreadMentionUsers(post, sessionUser)
  const seen = new Set(mentionUsers.map((u) => u.id))
  const addMention = (u: { id: number; full_name: string } | null | undefined) => {
    if (!u?.id || seen.has(u.id)) return
    seen.add(u.id)
    mentionUsers.push({ id: u.id, full_name: u.full_name })
  }
  addMention(resolutionOfficial(post))
  for (const entry of relatedReports(post)) {
    addMention(
      entry.reporter_id ? { id: entry.reporter_id, full_name: entry.reporter_name } : null,
    )
  }

  const linked = relatedReports(post)
  const bannerPrefix = officialReplyPrefix(post)
  const bannerReplies: UnifiedComment[] = []
  const reportReplies = new Map<number, UnifiedComment[]>()
  const rest: UnifiedComment[] = []
  for (const comment of post.comments.map((row) => fromConcernComment(row, sessionUser))) {
    const report = linked.find((entry) => comment.body.startsWith(reportReplyPrefix(entry)))
    if (report) {
      const list = reportReplies.get(report.id) ?? []
      list.push(comment)
      reportReplies.set(report.id, list)
    } else if (comment.body.startsWith(bannerPrefix)) {
      bannerReplies.push(comment)
    } else {
      rest.push(comment)
    }
  }

  const anchors: CommentThreadAnchor[] = []
  if (statusGroupOf(post.status) === "closed") {
    anchors.push({
      key: "resolution",
      node: (
        <ResolutionBanner
          post={post}
          sessionUser={sessionUser}
          mentionUsers={mentionUsers}
          replyPrefix={bannerPrefix}
          trunk={bannerReplies.length > 0}
          onSubmitReply={onSubmitInline}
        />
      ),
      comments: bannerReplies,
    })
  }
  if (linked.length > 0) {
    anchors.push({
      key: "neighbours",
      node: (
        <RelatedReportsToggle
          count={linked.length}
          open={reportsOpen}
          onToggle={() => setReportsOpen((value) => !value)}
        />
      ),
      comments: [],
    })
  }
  if (reportsOpen) {
    for (const entry of linked) {
      anchors.push({
        key: `report-${entry.id}`,
        node: (
          <NeighbourReportRow
            entry={entry}
            post={post}
            sessionUser={sessionUser}
            mentionUsers={mentionUsers}
            trunk={(reportReplies.get(entry.id)?.length ?? 0) > 0}
            onSubmitReply={onSubmitInline}
          />
        ),
        comments: reportReplies.get(entry.id) ?? [],
      })
    }
  }

  return (
    <CommentThread
      className="pt-1"
      comments={rest}
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
      onReport={onReport}
      anchors={anchors}
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
  actions,
  trunk = false,
  children,
}: {
  avatar: ReactNode
  name: string
  meta: string
  badge?: ReactNode
  actions?: ReactNode
  /** Runs the thread trunk down from this avatar — set when it has pinned replies. */
  trunk?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-stretch gap-2.5">
      <div className="flex w-8 shrink-0 flex-col items-center">
        <div className="relative shrink-0">{avatar}</div>
        {trunk ? <span aria-hidden className="mt-1.5 w-px flex-1 bg-neutral-200" /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
          <span className="font-semibold text-neutral-900">{name}</span>
          {badge}
          <span className="text-neutral-500">· {meta}</span>
        </p>
        {children}
        {actions ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 leading-none">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

function ResolutionBanner({
  post,
  sessionUser,
  mentionUsers,
  replyPrefix,
  trunk = false,
  onSubmitReply,
}: {
  post: Concern
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  replyPrefix: string
  trunk?: boolean
  onSubmitReply: (body: string) => Promise<void> | void
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [replyBusy, setReplyBusy] = useState(false)

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
  const positive = post.status === "resolved"

  async function submitReply() {
    const body = replyDraft.trim()
    if (body.length < COMMENT_MIN_LENGTH || replyBusy) return
    setReplyBusy(true)
    try {
      await onSubmitReply(body)
      setReplyDraft("")
      setReplyOpen(false)
    } finally {
      setReplyBusy(false)
    }
  }

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
        trunk={trunk}
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
        actions={
          <CommentAction
            onClick={() => {
              if (replyOpen) {
                setReplyOpen(false)
                return
              }
              setReplyDraft(replyPrefix)
              setReplyOpen(true)
            }}
          >
            {replyOpen ? "Cancel" : "Reply"}
          </CommentAction>
        }
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

      {replyOpen ? (
        <div className={cn("mt-2.5", REPLY_INDENT)}>
          <CommentComposer
            compact
            autoFocus
            value={replyDraft}
            onChange={setReplyDraft}
            onSubmit={() => void submitReply()}
            placeholder={`Reply to ${firstNameOf(officialName)}…`}
            sessionUser={sessionUser}
            mentionUsers={mentionUsers}
            disabled={replyBusy}
          />
        </div>
      ) : null}
    </div>
  )
}

function RelatedReportsToggle({
  count,
  open,
  onToggle,
}: {
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-600 transition-colors hover:text-neutral-900"
    >
      <UsersIcon className="size-3.5 shrink-0" strokeWidth={2.2} />
      {count === 1
        ? "1 neighbour also reported this"
        : `${count} neighbours also reported this`}
      <span className="text-neutral-400">{open ? "· Hide" : "· Show"}</span>
    </button>
  )
}

function NeighbourReportRow({
  entry,
  post,
  sessionUser,
  mentionUsers,
  trunk = false,
  onSubmitReply,
}: {
  entry: CommunityIncidentReport
  post: Concern
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  trunk?: boolean
  onSubmitReply: (body: string) => Promise<void> | void
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [replyBusy, setReplyBusy] = useState(false)

  const photos = (post.community_incident?.photos ?? []).filter(
    (photo) => photo.report_id === entry.id && photo.mime_type?.startsWith("image/"),
  )

  async function submitReply() {
    const body = replyDraft.trim()
    if (body.length < COMMENT_MIN_LENGTH || replyBusy) return
    setReplyBusy(true)
    try {
      await onSubmitReply(body)
      setReplyDraft("")
      setReplyOpen(false)
    } finally {
      setReplyBusy(false)
    }
  }

  return (
    <CommentRow
      trunk={trunk}
      avatar={
        <span className="flex size-8 items-center justify-center rounded-full bg-slate-soft text-[13px] font-semibold text-navy-muted">
          {entry.reporter_name.slice(0, 1).toUpperCase()}
        </span>
      }
      name={entry.reporter_name}
      meta={`${timeAgo(entry.submitted_at)} · also reported this`}
      actions={
        <CommentAction
          onClick={() => {
            if (replyOpen) {
              setReplyOpen(false)
              return
            }
            setReplyDraft(reportReplyPrefix(entry))
            setReplyOpen(true)
          }}
        >
          {replyOpen ? "Cancel" : "Reply"}
        </CommentAction>
      }
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
      {replyOpen ? (
        <div className={cn("mt-2.5", REPLY_INDENT)}>
          <CommentComposer
            compact
            autoFocus
            value={replyDraft}
            onChange={setReplyDraft}
            onSubmit={() => void submitReply()}
            placeholder={`Reply to ${firstNameOf(entry.reporter_name)}…`}
            sessionUser={sessionUser}
            mentionUsers={mentionUsers}
            disabled={replyBusy}
          />
        </div>
      ) : null}
    </CommentRow>
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
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)

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
                  <p className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="shrink-0">{categoryLabel(post.category)}</span>
                    <span className="min-w-0 break-words">{pinnedLocation}</span>
                    <span className="shrink-0">{formatDate(post.created_at)}</span>
                    {statusGroupOf(post.status) === "closed" ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
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
                  onReport={() => setReportTarget({ kind: "concern", concernId: post.id })}
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
            onSubmitInline={(body) => onComment(post.id, body, null)}
            sessionUser={sessionUser}
            onEdit={(commentId, body) => void onEditComment(post.id, commentId, body)}
            onDelete={(commentId) => void onDeleteComment(post.id, commentId)}
            onReport={(commentId) =>
              setReportTarget({ kind: "concern_comment", concernId: post.id, commentId })
            }
            commentFieldId={commentFieldId}
          />
        </div>
      </article>

      <ReportPostDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
      />
    </>
  )
}
