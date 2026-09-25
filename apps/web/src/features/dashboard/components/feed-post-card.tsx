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
import { ConcernDescriptionBlock } from "@/features/dashboard/components/concerns/concern-description-block"
import { concernTitleText } from "@/features/dashboard/components/feed-post-text"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { timeAgo } from "@/features/dashboard/lib/format"
import {
  formatDate,
  formatTime,
} from "@/features/dashboard/components/concerns/concern-display"
import {
  mediaDisplaySource,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import {
  AuthenticatedMediaImage,
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import { ResolvedPhoto } from "@/features/dashboard/components/concerns/resolved-photo"
import { statusGroupOf } from "@/features/dashboard/lib/status-vocabulary"
import { FS } from "@/features/dashboard/components/home/home-style"
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
 * The "neighbours also reported this" roll-up stays local and is passed in as
 * a thread anchor. Resolution is presented on the report photo, never as a
 * synthetic comment.
 */
function relatedReports(post: Concern) {
  return (
    post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []
  )
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
  for (const entry of relatedReports(post)) {
    addMention(
      entry.reporter_id
        ? { id: entry.reporter_id, full_name: entry.reporter_name }
        : null
    )
  }

  const linked = relatedReports(post)
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
    } else {
      rest.push(comment)
    }
  }

  const anchors: CommentThreadAnchor[] = []
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
  /** Drop the card chrome so content merges into the parent surface */
  bare?: boolean
  /** Hide the generated summary box (e.g. already shown upstream) */
  hideSummary?: boolean
  /** Inset the photo with rounded corners instead of full-bleed */
  insetMedia?: boolean
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
        <UserAvatar
          user={{ full_name: entry.reporter_name }}
          size="sm"
          className="!size-8 text-[13px]"
        />
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
  bare = false,
  insetMedia = false,
  hideSummary = false,
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
  const [previewMedia, setPreviewMedia] = useState<MediaPreviewItem[] | null>(
    null
  )

  const street =
    streetSegment(post.address) ||
    streetSegment(post.reporter.street) ||
    streetSegment(post.barangay)
  const pinnedLocation = street || "Location pinned on the map"
  const commentFieldId = `feed-post-comment-${post.id}`
  // The comment icon counts actual comments and linked neighbour reports.
  const relatedRows = (
    post.community_incident?.reports?.filter((entry) => !entry.is_primary) ?? []
  ).length
  const totalCommentRows = post.comment_count + relatedRows
  const footerText = "text-[14px]"
  const footerMsgIcon = "size-[22px] shrink-0"
  const footerVoteIcon = "size-[22px] shrink-0"
  const upvoted = post.user_vote === 1
  const commentLabel =
    totalCommentRows > 0
      ? `${totalCommentRows} ${totalCommentRows === 1 ? "comment" : "comments"}`
      : "Comment"
  const voteLabel =
    post.vote_count > 0
      ? `${post.vote_count} ${post.vote_count === 1 ? "upvote" : "upvotes"}`
      : "Upvote"
  function toggleComments() {
    const next = !isExpanded
    setExpanded(next)
    window.requestAnimationFrame(() => {
      if (next) document.getElementById(commentFieldId)?.focus()
    })
  }
  const resolved = statusGroupOf(post.status) === "closed"
  const critical = (post.severity ?? "").toLowerCase() === "critical"
  const bodyText = (post.description || "").trim()
  const rawTitle = concernTitleText(post)
  const resolvedAt =
    [...(post.status_events ?? [])]
      .filter((event) => statusGroupOf(event.status) === "closed")
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]?.created_at ?? post.updated_at
  const resolutionImages = (post.resolution_evidence ?? []).filter((item) =>
    item.mime_type?.startsWith("image/")
  )
  const originalPhoto =
    post.media.find((item) => item.mime_type?.startsWith("image/")) ?? null
  const originalPhotoSrc = originalPhoto
    ? mediaDisplaySource(originalPhoto)
    : ""
  const resolutionPreviewItems = (resolved ? resolutionImages : [])
    .map((item) => ({
      src: item.preview_url || item.raw_url,
      filename: item.original_filename || "Resolution photo",
      kind: "image" as const,
      eyebrow: street || undefined,
      postedLabel: `${formatDate(post.created_at)} at ${formatTime(post.created_at)}`,
      heading: rawTitle || undefined,
      badge: "Resolved case",
      blurb: bodyText || undefined,
    }))
    .filter((item) => item.src)
  const resolutionPhotoSrc = resolutionPreviewItems[0]?.src || ""
  const reportPhotoItems = post.media
    .filter((item) => item.mime_type?.startsWith("image/"))
    .map((item) => {
      const src = mediaDisplaySource(item)
      return src
        ? {
            src,
            filename: item.original_filename || "Report photo",
            kind: "image" as const,
            media: item,
            eyebrow: street || undefined,
            postedLabel: `${formatDate(post.created_at)} at ${formatTime(post.created_at)}`,
            heading: rawTitle || undefined,
            badge: "Reported issue",
            blurb: bodyText || undefined,
          }
        : null
    })
    .filter((item) => item !== null)
  const openReportMedia = () => {
    const items = [...reportPhotoItems, ...resolutionPreviewItems]
    if (!items.length) return
    setPreviewMedia(items)
  }
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
        className={
          bare
            ? className
            : cn(
                "relative rounded-lg border border-neutral-300 bg-white",
                className
              )
        }
      >
        <div className="flex items-center gap-2.5 p-3.5 pb-0">
          <UserAvatar user={post.reporter} showStatus={false} size="lg" />
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
                </div>
                <div className="text-[13px] leading-snug text-neutral-500 sm:text-[14px]">
                  <p className="min-w-0 break-words">{pinnedLocation}</p>
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

        <div className="space-y-2.5 px-3.5 pt-2 pb-1.5">
          <div className="space-y-1">
            <p className="text-meta text-neutral-500">
              Posted on {formatDate(post.created_at)} at{" "}
              {formatTime(post.created_at)}
            </p>
            <ConcernDescriptionBlock
              title={rawTitle}
              description={bodyText}
              summary={hideSummary || resolved ? null : post.summary}
              descriptionClassName={FS.body}
              summaryTone={critical ? "critical" : "default"}
            />
            {resolved ? (
              <div className="flex w-full items-start gap-2 rounded-lg bg-status-closed-surface px-3 py-2.5 text-[16px] leading-relaxed text-status-closed-ink">
                <CircleCheck
                  className="mt-[2px] size-5 shrink-0"
                  strokeWidth={1.9}
                  aria-hidden
                />
                <p className="min-w-0 flex-1 break-words">
                  This issue was resolved on {formatDate(resolvedAt)} at{" "}
                  {formatTime(resolvedAt)}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {(
          resolved
            ? Boolean(resolutionPhotoSrc || originalPhoto)
            : Boolean(originalPhoto)
        ) ? (
          <div
            className={
              insetMedia
                ? "mt-2.5 px-3.5"
                : "mt-2.5 border-y border-neutral-200"
            }
          >
            <div
              className={
                insetMedia
                  ? "overflow-hidden rounded-2xl border border-neutral-200"
                  : undefined
              }
            >
            {/* Full photo at its natural aspect ratio — no fixed height, no
              cropping. Click opens the full image in the lightbox. */}
            {resolved ? (
              <ResolvedPhoto
                originalSrc={originalPhotoSrc || null}
                resolutionSrc={resolutionPhotoSrc || null}
                resolutionCount={resolutionPreviewItems.length}
                alt="Report photo"
                imageClassName="h-auto w-full object-contain"
                onOpen={openReportMedia}
              />
            ) : (
              <button
                type="button"
                onClick={openReportMedia}
                aria-label="Preview photo"
                className="block w-full"
              >
                <AuthenticatedMediaImage
                  src={mediaDisplaySource(originalPhoto ?? {})}
                  alt="Report photo"
                  className="h-auto w-full object-contain"
                />
              </button>
            )}
            </div>
          </div>
        ) : null}

        <div className="px-3.5">
          {post.can_interact === false ? (
            <div className={cn("-mx-3.5 grid grid-cols-1 px-1.5", !isExpanded && "rounded-b-lg")}>
              <button
                type="button"
                onClick={toggleComments}
                aria-label={isExpanded ? "Hide comments" : "Show comments"}
                aria-expanded={isExpanded}
                className={cn(
                  `flex min-h-12 items-center justify-center gap-2 ${footerText} font-semibold transition-colors`,
                  isExpanded
                    ? "text-neutral-800"
                    : "text-neutral-500 hover:text-neutral-800"
                )}
              >
                <MessageCircleIcon
                  className={footerMsgIcon}
                  strokeWidth={2}
                />
                <span className="leading-none">
                  {totalCommentRows > 0 ? commentLabel : "No comments"}
                </span>
              </button>
            </div>
          ) : (
            <div className="-mx-3.5 grid grid-cols-2 rounded-b-lg px-1.5">
              <button
                type="button"
                onClick={() => onVote(post)}
                aria-label={upvoted ? "Remove upvote" : "Upvote"}
                aria-pressed={upvoted}
                className={cn(
                  `flex min-h-12 items-center justify-center gap-2 ${footerText} font-semibold transition-colors`,
                  upvoted
                    ? "text-brand-orange"
                    : "text-neutral-500 hover:text-neutral-800"
                )}
              >
                <CircleArrowUp
                  className={footerVoteIcon}
                  strokeWidth={2}
                />
                <span className="leading-none">{voteLabel}</span>
              </button>
              <button
                type="button"
                onClick={toggleComments}
                aria-label={isExpanded ? "Hide comments" : "Show comments"}
                aria-expanded={isExpanded}
                className={cn(
                  `flex min-h-12 items-center justify-center gap-2 ${footerText} font-semibold transition-colors`,
                  isExpanded
                    ? "text-neutral-800"
                    : "text-neutral-500 hover:text-neutral-800"
                )}
              >
                <MessageCircleIcon
                  className={footerMsgIcon}
                  strokeWidth={2}
                />
                <span className="leading-none">{commentLabel}</span>
              </button>
            </div>
          )}

          <div className={cn(isExpanded && "pt-2.5 pb-3.5")}>
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
        </div>
      </article>

      <ReportPostDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
      />

      {previewMedia ? (
        <MediaLightbox
          items={previewMedia}
          index={
            resolved &&
            resolutionPreviewItems.length > 0 &&
            reportPhotoItems.length > 0
              ? reportPhotoItems.length
              : 0
          }
          simpleCounter
          onClose={() => setPreviewMedia(null)}
        />
      ) : null}
    </>
  )
}
