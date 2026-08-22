import { useEffect, useState } from "react"
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
import { ReportPostDialog, type ReportTarget } from "@/features/dashboard/components/report-post-dialog"

export function AnnouncementComments({
  announcementId,
  canModerate = false,
  autoFocusComposer = false,
}: {
  announcementId: number
  canModerate?: boolean
  /** Opened straight from "Write about this alert" — start expanded and focused. */
  autoFocusComposer?: boolean
}) {
  const { user } = useAuthSession()
  const [comments, setComments] = useState<AnnouncementComment[]>([])
  const [open, setOpen] = useState(autoFocusComposer)
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

  async function submit(body: string, parentId: number | null) {
    try {
      await addAnnouncementComment(announcementId, body, parentId)
      // Replies arrive nested under their root, so refetch rather than append.
      await reload()
      setOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That comment could not be posted.")
    }
  }

  async function remove(commentId: number) {
    try {
      await removeAnnouncementComment(announcementId, commentId)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That comment could not be removed.")
    }
  }

  const visible = comments.filter((comment) => comment.status === "visible")
  const unified = visible.map(fromAnnouncementComment)
  const commentCount = unified.reduce((total, item) => total + 1 + item.replies.length, 0)

  return (
    <div className="border-t border-neutral-200 pt-2.5">
      <CommentToggleButton
        count={commentCount}
        active={open}
        onClick={() => setOpen((value) => !value)}
        label={open ? "Hide comments" : "Show comments"}
      />

      {open ? (
        <CommentThread
          className="mt-2.5"
          comments={unified}
          sessionUser={user}
          mentionUsers={mentionUsersOf(unified)}
          allowReplies
          autoFocusComposer={autoFocusComposer}
          onSubmit={submit}
          onDelete={remove}
          onRemove={canModerate ? remove : undefined}
          onReport={(commentId) => setReportTarget({ kind: "announcement_comment", commentId })}
          emptyState="No comments yet. Be the first to reply."
        />
      ) : null}

      <ReportPostDialog
        open={reportTarget != null}
        onClose={() => setReportTarget(null)}
        target={reportTarget}
      />
    </div>
  )
}
