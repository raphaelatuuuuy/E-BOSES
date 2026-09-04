import type {
  AnnouncementComment,
  ConcernComment,
  PublicUser,
} from "@/features/dashboard/api"
import type { EmergencyCommunityComment } from "@/features/dashboard/emergency-api"
import type { MentionUser } from "@/features/dashboard/components/comment-mentions"

export interface CommentAuthor {
  label: string
  user?: PublicUser | null
  isOfficial: boolean
}

export interface UnifiedComment {
  id: number
  author: CommentAuthor
  body: string
  createdAt: string
  isMine: boolean
  isEdited: boolean
  originalBody: string
  attachment: import("@/features/dashboard/api").PublicCommentAttachment | null
  replies: UnifiedComment[]
}

export function fromConcernComment(
  comment: ConcernComment,
  sessionUser: PublicUser | null
): UnifiedComment {
  return {
    id: comment.id,
    author: {
      label: comment.author.full_name,
      user: comment.author,
      isOfficial: false,
    },
    body: comment.body,
    createdAt: comment.created_at,
    isMine: sessionUser != null && comment.author.id === sessionUser.id,
    isEdited: Boolean(comment.is_edited),
    originalBody: (comment.original_body || "").trim(),
    attachment: comment.attachment ?? null,
    replies: (comment.replies ?? []).map((reply) =>
      fromConcernComment(reply, sessionUser)
    ),
  }
}

/**
 * Announcement and emergency comments carry a masked identity, not a full
 * profile. Widening it to a PublicUser is what lets those threads use the same
 * avatar and the same @-mention list as concern threads.
 */
function maskedAuthor(
  author: { id: number; full_name: string } | undefined,
  label: string
) {
  if (!author?.id) return null
  const name = author.full_name || label
  const parts = name.split(/\s+/).filter(Boolean)
  return {
    id: author.id,
    full_name: name,
    role: "resident",
    initials:
      `${parts[0]?.[0] ?? ""}${parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : ""}`.toUpperCase() ||
      "U",
    last_seen_at: null,
  } as PublicUser
}

export function fromAnnouncementComment(
  comment: AnnouncementComment
): UnifiedComment {
  return {
    id: comment.id,
    author: {
      label: comment.author_label,
      user: maskedAuthor(comment.author, comment.author_label),
      isOfficial: comment.is_official_reply,
    },
    body: comment.body,
    createdAt: comment.created_at,
    isMine: comment.is_mine,
    isEdited: false,
    originalBody: "",
    attachment: comment.attachment ?? null,
    replies: (comment.replies ?? [])
      .filter((reply) => reply.status === "visible")
      .map(fromAnnouncementComment),
  }
}

export function fromEmergencyComment(
  comment: EmergencyCommunityComment
): UnifiedComment {
  return {
    id: comment.id,
    author: {
      label: comment.author_label,
      user: maskedAuthor(comment.author, comment.author_label),
      isOfficial: comment.is_official_update,
    },
    body: comment.body,
    createdAt: comment.created_at,
    isMine: comment.is_mine,
    isEdited: false,
    originalBody: "",
    attachment: comment.attachment ?? null,
    replies: (comment.replies ?? [])
      .filter((reply) => reply.status === "visible")
      .map(fromEmergencyComment),
  }
}

export function mentionUsersOf(comments: UnifiedComment[]): MentionUser[] {
  const map = new Map<number, MentionUser>()
  const walk = (list: UnifiedComment[]) => {
    for (const comment of list) {
      const user = comment.author.user
      if (user?.id && user.full_name)
        map.set(user.id, { id: user.id, full_name: user.full_name })
      walk(comment.replies)
    }
  }
  walk(comments)
  return [...map.values()]
}
