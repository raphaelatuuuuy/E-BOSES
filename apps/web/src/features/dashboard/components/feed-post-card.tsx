/**
 * Shared feed post card — same markup as Home feed (avatar, body, media, votes, comments).
 * Used by Home and Resident Alerts Map expanded panel.
 */
import { useEffect, useState, type ReactNode } from "react"
import {
  CircleArrowUp,
  CircleCheck,
  MessageCircleIcon,
  UsersIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { concernBodyText } from "@/features/dashboard/components/feed-post-text"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { timeAgo } from "@/features/dashboard/lib/format"
import { formatDate } from "@/features/dashboard/components/concerns/concern-display"
import {
  mediaDisplaySource,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  statusGroupOf,
  statusLabelOf,
} from "@/features/dashboard/lib/status-vocabulary"
import { FS, STROKE } from "@/features/dashboard/components/home/home-style"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import type {
  CommunityIncidentReport,
  Concern,
  PublicUser,
} from "@/features/dashboard/api"
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
  ResolutionBanner,
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
    item.mime_type?.startsWith("image/")
  )
  const closingEvent = [...(post.status_events ?? [])]
    .reverse()
    .find((event) => event.status === post.status)
  return evidence[0]?.uploaded_by ?? closingEvent?.actor ?? null
}

function relatedReports(post: Concern) {
  return (
    post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []
  )
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

function normaliseFeedCopy(value: string) {
  return value
    .replace(/[“”‘’"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
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
  canInteract,
}: {
  post: Concern
  isExpanded: boolean
  commentInput: string
  onCommentInputChange: (value: string) => void
  onSubmitTopLevel: (
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  onSubmitReply: (
    body: string,
    parentId: number,
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  onSubmitInline: (
    body: string,
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  sessionUser: PublicUser | null
  onEdit: (commentId: number, body: string) => void
  onDelete: (commentId: number) => void
  onReport: (commentId: number) => void
  commentFieldId: string
  canInteract: boolean
}) {
  const [reportsOpen, setReportsOpen] = useState(true)

  if (!isExpanded) return null

  const mentionUsers = collectThreadMentionUsers(post, sessionUser)
  const seen = new Set(mentionUsers.map((u) => u.id))
  const addMention = (
    u: { id: number; full_name: string } | null | undefined
  ) => {
    if (!u?.id || seen.has(u.id)) return
    seen.add(u.id)
    mentionUsers.push({ id: u.id, full_name: u.full_name })
  }
  addMention(resolutionOfficial(post))
  for (const entry of relatedReports(post)) {
    addMention(
      entry.reporter_id
        ? { id: entry.reporter_id, full_name: entry.reporter_name }
        : null
    )
  }

  const linked = relatedReports(post)
  const bannerPrefix = officialReplyPrefix(post)
  const bannerReplies: UnifiedComment[] = []
  const reportReplies = new Map<number, UnifiedComment[]>()
  const rest: UnifiedComment[] = []
  for (const comment of post.comments.map((row) =>
    fromConcernComment(row, sessionUser)
  )) {
    const report = linked.find((entry) =>
      comment.body.startsWith(reportReplyPrefix(entry))
    )
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
          canReply={canInteract}
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
            canReply={canInteract}
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
      allowReplies={canInteract}
      showComposer={canInteract}
      value={commentInput}
      onValueChange={onCommentInputChange}
      onSubmit={(
        body: string,
        parentId: number | null,
        media?: File | null
      ) => {
        if (parentId == null) return onSubmitTopLevel(media)
        return onSubmitReply(body, parentId, media)
      }}
      onEdit={canInteract ? onEdit : undefined}
      onDelete={canInteract ? onDelete : undefined}
      onReport={canInteract ? onReport : undefined}
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
  onComment: (
    postId: number,
    body: string,
    parent?: number | null,
    media?: File | null
  ) => Promise<boolean | void>
  onEditComment: (
    postId: number,
    commentId: number,
    body: string
  ) => Promise<void>
  onDeleteComment: (postId: number, commentId: number) => Promise<void>
  /** Optional outer class (e.g. strip border when nested in panel) */
  className?: string
  /** Hide report menu (default false) */
  hideMoreMenu?: boolean
}

/**
 * Exact Home-feed post layout: header, body, media, vote/comment, threaded comments.
 */
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
        {trunk ? (
          <span aria-hidden className="mt-1.5 w-px flex-1 bg-neutral-200" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
          <span className="font-semibold text-neutral-900">{name}</span>
          {badge}
          <span className="text-neutral-500">· {meta}</span>
        </p>
        {children}
        {actions ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 leading-none">
            {actions}
          </div>
        ) : null}
      </div>
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
  canReply,
}: {
  entry: CommunityIncidentReport
  post: Concern
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  trunk?: boolean
  onSubmitReply: (
    body: string,
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  canReply: boolean
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [replyBusy, setReplyBusy] = useState(false)

  const photos = (post.community_incident?.photos ?? []).filter(
    (photo) =>
      photo.report_id === entry.id && photo.mime_type?.startsWith("image/")
  )

  async function submitReply(media?: File | null): Promise<boolean> {
    const body = replyDraft.trim()
    if ((body.length < COMMENT_MIN_LENGTH && !media) || replyBusy) return false
    setReplyBusy(true)
    try {
      const result = await onSubmitReply(body, media)
      if (result === false) return false
      setReplyDraft("")
      setReplyOpen(false)
      return true
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
        canReply ? (
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
        ) : undefined
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
            onSubmit={submitReply}
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
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem | null>(
    null
  )

  const street =
    streetSegment(post.address) || streetSegment(post.reporter.street)
  const barangay = (post.barangay || "").trim()
  const reporterCommunityName =
    post.reporter_community?.name?.trim() || post.community?.name?.trim() || ""
  // When geocoding failed, the server's public address is just the barangay
  // name. Echoing it twice ("Concepcion Dos, Concepcion Dos") reads as a bug,
  // so the duplicated street half is dropped.
  const locationParts =
    street && barangay && street.toLowerCase() === barangay.toLowerCase()
      ? [barangay]
      : [street, barangay]
  const pinnedLocation =
    locationParts.filter(Boolean).join(", ") || "Location pinned on the map"
  const commentFieldId = `feed-post-comment-${post.id}`
  // The comment icon counts every row shown in the thread: real comments plus
  // the resolution banner and the "neighbours also reported" entries.
  const resolutionRows = statusGroupOf(post.status) === "closed" ? 1 : 0
  const relatedRows = (
    post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []
  ).length
  const totalCommentRows = post.comment_count + resolutionRows + relatedRows
  const generatedSummary = (post.summary || "").replace(/\s+/g, " ").trim()
  const submittedDescription = concernBodyText(post).replace(/\s+/g, " ").trim()
  const summaryDiffers =
    Boolean(generatedSummary) &&
    Boolean(submittedDescription) &&
    normaliseFeedCopy(generatedSummary) !==
      normaliseFeedCopy(submittedDescription)

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

  async function submitTopLevel(media?: File | null): Promise<boolean> {
    const body = commentInput.trim()
    if (!body && !media) return false
    const result = await onComment(post.id, body, null, media)
    if (result === false) return false
    setCommentInput("")
    return true
  }

  async function submitReply(
    body: string,
    parentId: number,
    media?: File | null
  ): Promise<boolean> {
    if (!body.trim() && !media) return false
    const result = await onComment(post.id, body, parentId, media)
    return result !== false
  }

  return (
    <>
      <article
        className={cn(
          "relative rounded-lg border border-neutral-300 bg-white",
          className
        )}
      >
        <div className="flex gap-2.5 p-3.5 pb-0">
          <UserAvatar user={post.reporter} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p
                    className={cn(
                      "min-w-0 truncate font-bold text-neutral-900",
                      FS.author
                    )}
                  >
                    {post.reporter.full_name}
                  </p>
                  {reporterCommunityName ? (
                    <p className="min-w-0 truncate text-[12px] font-medium text-neutral-500">
                      {reporterCommunityName}
                    </p>
                  ) : null}
                </div>
                <div className="text-[13px] leading-snug text-neutral-500 sm:text-[14px]">
                  <p className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span className="min-w-0 break-words">
                      {pinnedLocation}
                    </span>
                    <span className="shrink-0">
                      {formatDate(post.created_at)}
                    </span>
                    {statusGroupOf(post.status) === "closed" ? (
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <span className="inline-flex items-center gap-1 font-medium text-status-closed">
                          <CircleCheck
                            className="size-3.5 shrink-0"
                            strokeWidth={2.4}
                          />
                          {statusLabelOf(post.status, "resident", "concern")}
                        </span>
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              {!hideMoreMenu && post.can_interact !== false ? (
                <PostMoreMenu
                  open={menuOpenPost}
                  onOpenChange={setMenuOpenPost}
                  onReport={() =>
                    setReportTarget({ kind: "concern", concernId: post.id })
                  }
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-2.5 p-3.5 pt-2">
          {generatedSummary ? (
            <div>
              <p className={cn("leading-relaxed text-neutral-900", FS.body)}>
                {generatedSummary}
              </p>
            </div>
          ) : (
            <p className={cn("leading-relaxed text-neutral-900", FS.body)}>
              {submittedDescription}
            </p>
          )}
          {summaryDiffers ? (
            <div className="border-t border-neutral-100 pt-2">
              <p className="mb-1 text-[10px] font-bold tracking-[0.06em] text-neutral-400 uppercase">
                Submitted description
              </p>
              <p className="text-[13px] leading-relaxed text-neutral-600">
                {submittedDescription}
              </p>
            </div>
          ) : null}
        </div>

        {post.media.length > 0 &&
        post.media[0].mime_type?.startsWith("image/") ? (
          <div className="mt-2.5 border-y border-neutral-200">
            {/* Full photo at its natural aspect ratio — no fixed height, no
              cropping. Click opens the full image in the lightbox. */}
            <button
              type="button"
              onClick={() =>
                setPreviewMedia({
                  src: mediaDisplaySource(post.media[0]),
                  filename: post.media[0].original_filename || "Photo",
                  kind: "image",
                  media: post.media[0],
                })
              }
              aria-label="Preview photo"
              className="block w-full"
            >
              <AuthenticatedMediaImage
                src={mediaDisplaySource(post.media[0])}
                alt="Report photo"
                className="h-auto w-full object-contain"
              />
            </button>
          </div>
        ) : null}

        <div className="space-y-2.5 p-3.5 pt-3">
          {post.can_interact === false ? (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => setExpanded(!isExpanded)}
                aria-label={isExpanded ? "Hide comments" : "Show comments"}
                aria-expanded={isExpanded}
                className={cn(
                  "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
                  isExpanded
                    ? "text-neutral-800"
                    : "text-neutral-500 hover:text-neutral-800"
                )}
              >
                <MessageCircleIcon
                  className="size-3.5 shrink-0"
                  strokeWidth={2}
                />
                <span>
                  {totalCommentRows > 0
                    ? `${totalCommentRows} comments`
                    : "No comments"}
                </span>
              </button>
            </div>
          ) : (
            <>
              {/* With upvotes: avatar stack + count on the left, comment on the
              right (the shared concern-queue footer pattern). With none: the
              comment part still sits on the right — matching the feed footer —
              while the "Upvote" affordance stays pinned to the left edge. */}
              {post.vote_count > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onVote(post)}
                    aria-label={
                      post.user_vote === 1 ? "Remove upvote" : "Upvote"
                    }
                    aria-pressed={post.user_vote === 1}
                    className={cn(
                      "flex min-w-0 items-center gap-1.5 text-[11px] font-medium transition-colors",
                      post.user_vote === 1
                        ? "text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    <>
                      <span className="flex -space-x-1.5" aria-hidden="true">
                        {(post.upvoters ?? []).slice(0, 3).map((name, i) => (
                          <span
                            key={`${name}-${i}`}
                            className="flex size-5 items-center justify-center rounded-full bg-slate-soft text-[8px] font-semibold text-navy-muted ring-1 ring-white"
                          >
                            {name.trim().charAt(0).toUpperCase()}
                          </span>
                        ))}
                        {post.vote_count -
                          (post.upvoters ?? []).slice(0, 3).length >
                        0 ? (
                          <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100 text-[8px] font-semibold text-neutral-500 ring-1 ring-white">
                            +
                            {post.vote_count -
                              (post.upvoters ?? []).slice(0, 3).length}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0">
                        {post.vote_count}{" "}
                        {post.vote_count === 1 ? "upvote" : "upvotes"}
                      </span>
                    </>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !isExpanded
                      setExpanded(next)
                      window.requestAnimationFrame(() => {
                        if (next)
                          document.getElementById(commentFieldId)?.focus()
                      })
                    }}
                    aria-label={isExpanded ? "Hide comments" : "Show comments"}
                    aria-expanded={isExpanded}
                    className={cn(
                      "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
                      isExpanded
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    <MessageCircleIcon
                      className="size-3.5 shrink-0"
                      strokeWidth={2}
                    />
                    <span>
                      {totalCommentRows > 0
                        ? `${totalCommentRows} comments`
                        : "Add a Comment"}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="relative flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => onVote(post)}
                    aria-label={
                      post.user_vote === 1 ? "Remove upvote" : "Upvote"
                    }
                    aria-pressed={post.user_vote === 1}
                    className={cn(
                      "absolute left-0 flex items-center gap-1.5 text-[11px] font-medium transition-colors",
                      post.user_vote === 1
                        ? "text-neutral-900"
                        : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    <CircleArrowUp
                      className="size-4 shrink-0"
                      strokeWidth={STROKE}
                    />
                    <span className="shrink-0">Upvote</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = !isExpanded
                      setExpanded(next)
                      window.requestAnimationFrame(() => {
                        if (next)
                          document.getElementById(commentFieldId)?.focus()
                      })
                    }}
                    aria-label={isExpanded ? "Hide comments" : "Show comments"}
                    aria-expanded={isExpanded}
                    className={cn(
                      "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
                      isExpanded
                        ? "text-neutral-800"
                        : "text-neutral-500 hover:text-neutral-800"
                    )}
                  >
                    <MessageCircleIcon
                      className="size-3.5 shrink-0"
                      strokeWidth={2}
                    />
                    <span>
                      {totalCommentRows > 0
                        ? `${totalCommentRows} comments`
                        : "Add a Comment"}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}

          <PostCommentsBlock
            post={post}
            isExpanded={isExpanded}
            commentInput={commentInput}
            onCommentInputChange={setCommentInput}
            onSubmitTopLevel={(media) => void submitTopLevel(media)}
            onSubmitReply={(body, parentId, media) =>
              void submitReply(body, parentId, media)
            }
            onSubmitInline={(body, media) =>
              onComment(post.id, body, null, media)
            }
            sessionUser={sessionUser}
            onEdit={(commentId, body) =>
              void onEditComment(post.id, commentId, body)
            }
            onDelete={(commentId) => void onDeleteComment(post.id, commentId)}
            onReport={(commentId) =>
              setReportTarget({
                kind: "concern_comment",
                concernId: post.id,
                commentId,
              })
            }
            commentFieldId={commentFieldId}
            canInteract={post.can_interact !== false}
          />
        </div>
      </article>

      <ReportPostDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
      />

      {previewMedia ? (
        <MediaLightbox
          items={[previewMedia]}
          index={0}
          onClose={() => setPreviewMedia(null)}
        />
      ) : null}
    </>
  )
}
