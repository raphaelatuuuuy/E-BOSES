import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import {
  addAnnouncementComment,
  listAnnouncementComments,
  removeAnnouncementComment,
  type AnnouncementComment,
} from "@/features/dashboard/api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  CommentThread,
  CommentToggleButton,
  fromAnnouncementComment,
  mentionUsersOf,
} from "@/features/dashboard/components/comments"
import {
  ReportPostDialog,
  type ReportTarget,
} from "@/features/dashboard/components/report-post-dialog"

export function AnnouncementComments({
  announcementId,
  canModerate = false,
  autoFocusComposer = false,
  defaultOpen = false,
  onOpenChange,
}: {
  announcementId: number
  canModerate?: boolean
  autoFocusComposer?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { user } = useAuthSession()
  const [comments, setComments] = useState<AnnouncementComment[]>([])
  const [open, setOpen] = useState(defaultOpen)
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    listAnnouncementComments(announcementId)
      .then((rows) => {
        if (!cancelled) setComments(rows)
      })
      .catch(() => {
        if (!cancelled) setComments([])
      })
    return () => {
      cancelled = true
    }
  }, [announcementId])

  async function reload() {
    try {
      setComments(await listAnnouncementComments(announcementId))
    } catch {
      /* keep what is on screen */
    }
  }

  async function submit(
    body: string,
    parentId: number | null,
    media?: File | null
  ): Promise<boolean> {
    try {
      await addAnnouncementComment(announcementId, body, parentId, media)
      // Replies arrive nested under their root, so refetch rather than append.
      await reload()
      setOpen(true)
      return true
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "That comment could not be posted."
      )
      return false
    }
  }

  async function remove(commentId: number) {
    try {
      await removeAnnouncementComment(announcementId, commentId)
      await reload()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "That comment could not be removed."
      )
    }
  }

  const visible = comments.filter((comment) => comment.status === "visible")
  const unified = visible.map(fromAnnouncementComment)
  const commentCount = unified.reduce(
    (total, item) => total + 1 + item.replies.length,
    0
  )

  function signInToComment() {
    const returnTo = `${window.location.pathname}${window.location.search}`
    navigate(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`)
  }

  return (
    <div>
      <CommentToggleButton
        count={commentCount}
        active={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          onOpenChange?.(next)
        }}
        label={open ? "Hide comments" : "Show comments"}
      />

      {open ? (
        <CommentThread
          className="pt-1.5 pb-1"
          comments={unified}
          sessionUser={user}
          mentionUsers={mentionUsersOf(unified)}
          allowReplies={user != null}
          showComposer={user != null}
          autoFocusComposer={autoFocusComposer}
          onSubmit={submit}
          onDelete={remove}
          onRemove={canModerate ? remove : undefined}
          onReport={
            user
              ? (commentId) =>
                  setReportTarget({ kind: "announcement_comment", commentId })
              : undefined
          }
          emptyState={user ? "No comments yet. Be the first to reply." : null}
        />
      ) : null}

      {!user ? (
        <div className="border-t border-neutral-100 px-3 pt-4 text-center">
          <button
            type="button"
            onClick={signInToComment}
            className="text-[13px] font-semibold text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-neutral-900"
          >
            Sign in to comment
          </button>
          <p className="mt-1.5 text-[12px] leading-5 text-neutral-500">
            Join the conversation and keep track of your reports.
          </p>
        </div>
      ) : null}

      <ReportPostDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
      />
    </div>
  )
}
