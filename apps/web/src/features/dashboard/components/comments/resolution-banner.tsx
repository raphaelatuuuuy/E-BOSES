import { useState, type ReactNode } from "react"
import { BadgeCheckIcon, CheckCircle2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import {
  firstNameOf,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import { mediaDisplaySource } from "@/features/dashboard/lib/authenticated-media"
import { timeAgo } from "@/features/dashboard/lib/format"
import { roleLabel } from "@/features/dashboard/lib/people"
import {
  statusGroupOf,
  statusLabelOf,
} from "@/features/dashboard/lib/status-vocabulary"
import type { Concern, PublicUser } from "@/features/dashboard/api"
import { CommentComposer, COMMENT_MIN_LENGTH } from "./comment-composer"
import { CommentAction, REPLY_INDENT } from "./comment-row"

const AVATAR_CLASS =
  "!size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"

function ResolutionCommentRow({
  avatar,
  name,
  meta,
  actions,
  trunk = false,
  children,
}: {
  avatar: ReactNode
  name: string
  meta: string
  actions?: ReactNode
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

export function ResolutionBanner({
  post,
  sessionUser = null,
  mentionUsers = [],
  replyPrefix = "",
  trunk = false,
  onSubmitReply,
  canReply = false,
}: {
  post: Concern
  sessionUser?: PublicUser | null
  mentionUsers?: MentionUser[]
  replyPrefix?: string
  trunk?: boolean
  onSubmitReply?: (
    body: string,
    media?: File | null
  ) => Promise<boolean | void> | boolean | void
  canReply?: boolean
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyDraft, setReplyDraft] = useState("")
  const [replyBusy, setReplyBusy] = useState(false)

  const group = statusGroupOf(post.status)
  if (group !== "closed") return null

  const evidence = (post.resolution_evidence ?? []).filter((item) =>
    item.mime_type?.startsWith("image/")
  )
  const publicReportEvidence = (post.media ?? []).filter(
    (item) => item.mime_type?.startsWith("image/") && item.public_visible
  )
  const displayEvidence = evidence.length ? evidence : publicReportEvidence
  const closingEvent = [...(post.status_events ?? [])]
    .reverse()
    .find((event) => event.status === post.status)
  const detail =
    (post.update_text || "").trim() ||
    closingEvent?.note ||
    "The barangay has completed the reported work."
  // Queue responses are intentionally slim and carry the resolver as
  // `resolution_actor`; full feed responses carry the same identity on the
  // resolved status event/evidence instead.
  const rawOfficial =
    post.resolution_actor ??
    evidence[0]?.uploaded_by ??
    closingEvent?.actor ??
    null
  // When the actor is a generic entity (e.g. "Barangay Hall"), fall back
  // to the first active assignee so the comment shows the actual person
  // who resolved the case.
  const isGenericEntity = (name: string | null | undefined) => {
    if (!name) return true
    const lower = name.toLowerCase()
    return (
      lower.includes("barangay hall") || lower.includes("barangay official")
    )
  }
  const official =
    rawOfficial && !isGenericEntity(rawOfficial.full_name) ? rawOfficial : null
  const activeAssignee =
    official ??
    (post.assignments ?? []).find((a) => a.status === "active" && a.assignee)
      ?.assignee ??
    null
  const when = closingEvent?.created_at ?? post.updated_at

  const officialName = activeAssignee?.full_name || "Barangay Hall"
  const officialPosition = activeAssignee
    ? roleLabel(activeAssignee)
    : "Barangay Official"
  const positive = post.status === "resolved"

  async function submitReply(media?: File | null): Promise<boolean> {
    const body = replyDraft.trim()
    if (
      !onSubmitReply ||
      (body.length < COMMENT_MIN_LENGTH && !media) ||
      replyBusy
    )
      return false
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
    <div>
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1 text-[11px] font-semibold",
          positive ? "text-status-closed" : "text-neutral-500"
        )}
      >
        <CheckCircle2Icon className="size-3 shrink-0" strokeWidth={2.4} />
        {positive
          ? "Issue was resolved"
          : statusLabelOf(post.status, "resident", "concern")}
      </p>

      <ResolutionCommentRow
        trunk={trunk}
        avatar={
          activeAssignee ? (
            <>
              <UserAvatar
                user={activeAssignee}
                size="sm"
                className={AVATAR_CLASS}
              />
              <BadgeCheckIcon
                aria-label="Verified barangay official"
                className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-white text-brand-navy"
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
                className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-white text-brand-navy"
                strokeWidth={2.4}
              />
            </>
          )
        }
        name={officialName}
        meta={`${timeAgo(when)} · ${officialPosition || "Official update"}`}
        actions={
          canReply ? (
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
          ) : undefined
        }
      >
        {detail ? (
          <p className="mt-0.5 text-[14px] leading-relaxed text-neutral-900">
            {detail}
          </p>
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
      </ResolutionCommentRow>

      {replyOpen ? (
        <div className={cn("mt-2.5", REPLY_INDENT)}>
          <CommentComposer
            compact
            autoFocus
            value={replyDraft}
            onChange={setReplyDraft}
            onSubmit={submitReply}
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
