import { useState, type ReactNode } from "react"

import { ShieldUserIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { renderCommentBody } from "@/features/dashboard/components/comment-mentions"
import type { UnifiedComment } from "./comment-types"
import {
  AuthenticatedMediaImage,
  AuthenticatedMediaVideo,
} from "@/features/dashboard/components/authenticated-media"

const AVATAR =
  "!size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"

/**
 * The reply connector runs *avatar to avatar*: a trunk descending from the
 * parent's avatar, curving right into the reply's avatar. It is drawn in two
 * pieces because only the reply knows where it sits — `CommentRow trunk`
 * carries the vertical run through the parent's body, and the pieces below
 * carry the curve and the run between siblings.
 *
 * Geometry: the avatar column is 32px wide, so the trunk sits at x=16.
 * Replies indent by 36px (`REPLY_INDENT`), leaving a 20px curve.
 */
export const REPLY_INDENT = "pl-9"

/** Curve from the trunk into this reply's avatar. Every reply gets one. */
export const REPLY_CURVE =
  "pointer-events-none absolute -left-5 -top-3 h-7 w-5 rounded-bl-[12px] border-b border-l border-neutral-200"

/** Trunk continuing past this reply to the next one. Not on the last reply. */
export const REPLY_TRUNK =
  "pointer-events-none absolute -left-5 top-4 -bottom-3 w-px bg-neutral-200"

export function CommentAvatar({
  comment,
  className,
}: {
  comment: UnifiedComment
  className?: string
}) {
  const role = comment.author.user?.role ?? ""
  const badge =
    role === "barangay_official"
      ? "bg-brand-orange"
      : role === "first_responder"
        ? "bg-brand-blue"
        : ""
  return (
    <span className="relative inline-flex shrink-0">
      {comment.author.user ? (
        <UserAvatar
          user={comment.author.user}
          size="sm"
          className={cn(AVATAR, className)}
        />
      ) : (
        <span
          className={cn(
            "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[13px] font-semibold text-navy-muted",
            className
          )}
        >
          {(comment.author.label[0] || "U").toUpperCase()}
        </span>
      )}
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

export function OfficialBadge() {
  return (
    <span className="rounded-full bg-brand-navy/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-navy">
      Official
    </span>
  )
}

export function CommentMeta({
  comment,
  extra,
}: {
  comment: UnifiedComment
  extra?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-x-2 text-[13px] leading-snug text-neutral-400">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
        <span className="font-semibold text-neutral-900">
          {comment.isMine ? "You" : comment.author.label}
        </span>
        {comment.author.isOfficial ? <OfficialBadge /> : null}
        <span>· {timeAgo(comment.createdAt)}</span>
      </div>
      {extra ? <div className="ml-auto shrink-0">{extra}</div> : null}
    </div>
  )
}

export function CommentBody({ comment }: { comment: UnifiedComment }) {
  const [showOriginal, setShowOriginal] = useState(false)
  const key = `${comment.id}|${comment.body}|${comment.isEdited}`
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    setShowOriginal(false)
  }
  const canShowOriginal = comment.isEdited && Boolean(comment.originalBody)

  return (
    <>
      <p className="m-0 text-[15px] leading-[1.35] break-words whitespace-pre-wrap text-neutral-800">
        {renderCommentBody(comment.body)}
      </p>
      <CommentAttachment attachment={comment.attachment} />
      {canShowOriginal ? (
        <button
          type="button"
          onClick={() => setShowOriginal((value) => !value)}
          className="mt-1 text-[12px] font-medium text-neutral-400 transition-colors hover:text-neutral-700"
        >
          {showOriginal ? "Hide original" : "View original"}
        </button>
      ) : null}
      {canShowOriginal && showOriginal ? (
        <div className="mt-1.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 ring-1 ring-neutral-100">
          <p className="m-0 text-[14px] leading-snug break-words whitespace-pre-wrap text-neutral-600">
            {renderCommentBody(comment.originalBody)}
          </p>
        </div>
      ) : null}
    </>
  )
}

export function CommentAttachment({
  attachment,
}: {
  attachment: UnifiedComment["attachment"]
}) {
  return attachment ? (
    <div className="mt-2 max-w-sm overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
      {attachment.kind === "video" ? (
        <AuthenticatedMediaVideo
          src={attachment.raw_url}
          className="max-h-72 w-full"
        />
      ) : (
        <AuthenticatedMediaImage
          src={attachment.preview_url}
          alt={attachment.original_filename || "Comment attachment"}
          className="max-h-72 w-full object-cover"
        />
      )}
      <div className="flex flex-wrap gap-x-2 px-2.5 py-1.5 text-[11px] text-neutral-500">
        <span>
          {attachment.analysis_status === "complete"
            ? "Media checked"
            : "Media needs review"}
        </span>
        {attachment.street_imagery_status === "checked" ? (
          <span>Location compared with street imagery</span>
        ) : null}
      </div>
    </div>
  ) : null
}

export function CommentRow({
  comment,
  meta,
  actions,
  trailing,
  trunk = false,
  children,
  className,
}: {
  comment: UnifiedComment
  meta?: ReactNode
  actions?: ReactNode
  trailing?: ReactNode
  /** Runs the thread trunk down from this avatar — set when it has replies. */
  trunk?: boolean
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex items-stretch gap-2.5", className)}>
      <div className="flex w-8 shrink-0 flex-col items-center">
        <CommentAvatar comment={comment} />
        {trunk ? (
          <span aria-hidden className="mt-1.5 w-px flex-1 bg-neutral-200" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <CommentMeta comment={comment} extra={meta} />
        {children ?? <CommentBody comment={comment} />}
        {actions ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 leading-none">
            {actions}
          </div>
        ) : null}
      </div>
      {trailing ? <div className="-mt-0.5 shrink-0">{trailing}</div> : null}
    </div>
  )
}

export function CommentAction({
  onClick,
  children,
}: {
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
    >
      {children}
    </button>
  )
}
