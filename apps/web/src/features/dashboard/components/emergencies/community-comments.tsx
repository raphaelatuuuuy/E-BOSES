import { useEffect, useState } from "react"
import { toast } from "sonner"

import {
  addEmergencyCommunityComment,
  listEmergencyCommunityComments,
  removeEmergencyCommunityComment,
  type EmergencyCommunityComment,
} from "@/features/dashboard/emergency-api"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  CommentThread,
  fromEmergencyComment,
  mentionUsersOf,
} from "@/features/dashboard/components/comments"

export function EmergencyCommunityComments({
  alertId,
  canModerate = false,
  acceptsComments = true,
  autoFocusComposer = false,
}: {
  alertId: number
  canModerate?: boolean
  acceptsComments?: boolean
  autoFocusComposer?: boolean
}) {
  const { user } = useAuthSession()
  const [comments, setComments] = useState<EmergencyCommunityComment[]>([])

  useEffect(() => {
    let cancelled = false
    listEmergencyCommunityComments(alertId)
      .then((rows) => {
        if (!cancelled) setComments(rows)
      })
      .catch(() => {
        if (!cancelled) setComments([])
      })
    return () => {
      cancelled = true
    }
  }, [alertId])

  async function reload() {
    try {
      setComments(await listEmergencyCommunityComments(alertId))
    } catch {
      /* keep what is on screen */
    }
  }

  async function submit(body: string, parentId: number | null) {
    try {
      await addEmergencyCommunityComment(alertId, body, parentId)
      // Replies arrive nested under their root, so refetch rather than append.
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That update could not be posted.")
    }
  }

  async function remove(commentId: number) {
    try {
      await removeEmergencyCommunityComment(alertId, commentId)
      await reload()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That comment could not be removed.")
    }
  }

  const visible = comments.filter((comment) => comment.status === "visible")
  const unified = visible.map(fromEmergencyComment)

  return (
    <CommentThread
      comments={unified}
      sessionUser={user}
      mentionUsers={mentionUsersOf(unified)}
      allowReplies={acceptsComments}
      autoFocusComposer={autoFocusComposer}
      placeholder="Share what you can see"
      onSubmit={submit}
      onDelete={remove}
      onRemove={canModerate ? remove : undefined}
      emptyState="No community updates yet. Share what you can see if it would help responders."
      closedNotice={
        acceptsComments ? undefined : "This emergency is closed, so new comments are not accepted."
      }
    />
  )
}
