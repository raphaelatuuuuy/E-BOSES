import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  AlertTriangleIcon,
  ArrowBigUpIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  GlobeIcon,
  CheckIcon,
  ImageIcon,
  PencilIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react"

import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  geocodeMarikinaStreet,
  MARIKINA_HEIGHTS_CENTER,
} from "@/features/auth/lib/forward-geocode"
import {
  commentOnConcern,
  deleteConcernComment,
  getResidentDashboardSummary,
  listAnnouncements,
  listFeedConcerns,
  listTodayBarangayEvents,
  updateConcernComment,
  voteConcern,
  type Announcement,
  type BarangayEvent,
  type Concern,
  type ConcernComment,
  type PublicUser,
} from "@/features/dashboard/api"
import {
  collectThreadMentionUsers,
  firstNameOf,
  MentionTextField,
  mentionToken,
  renderCommentBody,
  toMentionUser,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"
import { concernBodyText } from "@/features/dashboard/components/feed-post-card"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import {
  CommentMoreMenu,
  PostMoreMenu,
  ReportPostDialog,
} from "@/features/dashboard/components/report-post-dialog"
import { NotificationPopover } from "@/features/dashboard/components/notification-popover"
import { ProfileAccountMenu } from "@/features/dashboard/components/profile-account-menu"
import { useResidentSearch } from "@/features/dashboard/components/resident-search-context"
import {
  ResidentContentGrid,
  RESIDENT_DESKTOP_MIN_PX,
  RESIDENT_FEED_MAX,
  RESIDENT_RAIL_W,
} from "@/features/dashboard/components/resident-top-bar"
import { RotatingSearchField } from "@/features/dashboard/components/rotating-search-field"
import { usePageTitle } from "@/hooks/use-page-title"

/** Type scale — bumped larger for readability (shared with sidebar nav sizing) */
const FS = {
  logo: "text-[20px]",
  place: "text-[19px]",
  search: "text-[16px]",
  composer: "text-[16px]",
  chip: "text-[15px]",
  author: "text-[16px]",
  meta: "text-[14px]",
  body: "text-[16px]",
  railTitle: "text-[16px]",
  railBody: "text-[15px]",
  railLink: "text-[13px]",
  engage: "text-[15px]",
  label: "text-[12px]",
  footer: "text-[15px]",
  /** Sidebar / primary nav + Report CTA */
  sidebar: "text-[16px]",
  section: "text-[17px]",
} as const

const IC = {
  /** 28px — primary interactive glyphs on Home */
  md: "size-7",
  /** 28px — engagement, search, chrome */
  sm: "size-7",
  /** 28px — secondary actions */
  xs: "size-7",
  /** 16px — tiny meta (globe) */
  xxs: "size-4",
} as const

const STROKE = 1.5

const FEED_TABS = [
  { id: "for_you", label: "For you" },
  { id: "recent", label: "Recent" },
  { id: "nearby", label: "Nearby" },
  { id: "trending", label: "Trending" },
] as const

type FeedTab = (typeof FEED_TABS)[number]["id"]

function timeAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function categoryLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: PublicUser | null
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  // Letter-only avatars (no image)
  const sizeClass =
    size === "sm"
      ? "size-9 text-[16px]"
      : size === "lg"
        ? "size-11 text-[18px]"
        : "size-10 text-[17px]"

  const letter = (
    user?.full_name?.[0] ||
    user?.initials?.[0] ||
    "?"
  ).toUpperCase()

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        // sizeClass first so callers can override size; never strip the bg unless explicit
        sizeClass,
        className,
      )}
    >
      {letter}
    </span>
  )
}

const GET_STARTED_KEY = "eboses-home-get-started-dismissed"
const BARANGAY = "Marikina Heights"

/** Match Nextdoor column proportions (shared with top bar search) */
const FEED_MAX = RESIDENT_FEED_MAX
const RAIL_W = RESIDENT_RAIL_W

/** Extra-large chevrons on rail action rows (Nextdoor-style) */
const RAIL_CHEVRON = "size-7 shrink-0"

/** Web Mercator tile helpers for Carto light basemap (same as report location picker). */
function lon2tile(lon: number, zoom: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** zoom)
}
function lat2tile(lat: number, zoom: number) {
  const rad = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom,
  )
}

/** Carto light tile — same basemap as create-report / location picker (no pin). */
function railLiveMapSrc(lat: number, lng: number, zoom = 16) {
  const x = lon2tile(lng, zoom)
  const y = lat2tile(lat, zoom)
  return `https://a.basemaps.cartocdn.com/light_all/${zoom}/${x}/${y}@2x.png`
}

/**
 * Prefer the street line under Marikina Heights.
 * Address is typically: "123 Champaca Street, Marikina Heights, Marikina City"
 */
function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}

function commentPlaceLabel(author: PublicUser) {
  const street =
    streetLabelFromAddress(author.street) ||
    (author.street && author.street.toLowerCase() !== "pending" ? author.street : null)
  if (street && street.toLowerCase() !== "marikina heights") return street
  if (author.barangay && author.barangay.toLowerCase() !== "pending") return author.barangay
  return BARANGAY
}

/**
 * Nextdoor-style comment + one-level replies only (no reply-to-reply stack).
 * Own comments: ⋯ menu → Edit / Delete.
 */
function FeedCommentItem({
  postId,
  comment,
  isReply = false,
  rootCommentId,
  replyOpenId,
  replyDraft,
  onToggleReply,
  onReplyDraftChange,
  onSubmitReply,
  sessionUser,
  mentionUsers,
  menuOpenId,
  onMenuOpenChange,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  postId: number
  comment: ConcernComment
  isReply?: boolean
  /** Top-level comment id (for attaching replies only once) */
  rootCommentId: number
  replyOpenId: number | null
  replyDraft: string
  onToggleReply: (comment: ConcernComment) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (rootParentId: number) => void
  sessionUser: PublicUser | null
  mentionUsers: MentionUser[]
  menuOpenId: number | null
  onMenuOpenChange: (id: number | null) => void
  editingId: number | null
  editDraft: string
  onStartEdit: (comment: ConcernComment) => void
  onEditDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: (commentId: number) => void
  onDelete: (commentId: number) => void
}) {
  const isOwn = sessionUser != null && comment.author.id === sessionUser.id
  // Reply allowed on top-level and nested; still stores under rootCommentId
  const isReplying = replyOpenId === comment.id
  const isEditing = editingId === comment.id
  const menuOpen = menuOpenId === comment.id
  const place = commentPlaceLabel(comment.author)
  const [showOriginal, setShowOriginal] = useState(false)
  const isEdited = Boolean(comment.is_edited)
  const originalText = (comment.original_body || "").trim()

  // Reset original preview when comment body changes after reload
  useEffect(() => {
    setShowOriginal(false)
  }, [comment.id, comment.body, comment.is_edited])

  const hasReplies = !isReply && comment.replies.length > 0
  const threadRootRef = useRef<HTMLDivElement>(null)
  const lastReplyAvatarRef = useRef<HTMLDivElement>(null)
  const [threadBox, setThreadBox] = useState({
    top: 32,
    height: 80,
    left: 15,
    width: 29,
  })

  // Always pin the L-curve to the last reply avatar center (from top),
  // so opening the reply composer below does not slide the elbow away.
  useLayoutEffect(() => {
    if (!hasReplies) return
    function measure() {
      const rootEl = threadRootRef.current
      const avEl = lastReplyAvatarRef.current
      if (!rootEl || !avEl) return
      const rootRect = rootEl.getBoundingClientRect()
      const avRect = avEl.getBoundingClientRect()
      const avCenterY = avRect.top + avRect.height / 2
      const top = 32
      const height = Math.max(24, avCenterY - rootRect.top - top)
      const left = 15
      const avLeft = avRect.left - rootRect.left
      const width = Math.max(20, avLeft - left)
      setThreadBox({ top, height, left, width })
    }
    measure()
    const raf = window.requestAnimationFrame(measure)
    const rootEl = threadRootRef.current
    const ro =
      typeof ResizeObserver !== "undefined" && rootEl
        ? new ResizeObserver(() => measure())
        : null
    if (rootEl && ro) ro.observe(rootEl)
    window.addEventListener("resize", measure)
    return () => {
      window.cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [hasReplies, comment.replies.length, comment.replies.map((r) => r.id).join(",")])

  /** Shared header + body + actions (used for root and nested) */
  const commentMain = (
    <>
      <div className="flex items-start gap-0.5">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px] font-normal leading-[1.3] text-neutral-400">
            <span className="font-bold text-neutral-900">{comment.author.full_name}</span>
            <span className="mx-1">·</span>
            <span>{timeAgo(comment.created_at)}</span>
            {place ? (
              <>
                <span className="mx-1">·</span>
                <span>{place}</span>
              </>
            ) : null}
            {isEdited ? (
              <>
                <span className="mx-1">·</span>
                <button
                  type="button"
                  onClick={() => originalText && setShowOriginal((v) => !v)}
                  className={cn(
                    "inline p-0 font-medium text-neutral-400 align-baseline",
                    originalText && "hover:text-neutral-700 hover:underline",
                  )}
                  title={originalText ? "View original comment" : undefined}
                >
                  (edited)
                </button>
              </>
            ) : null}
          </p>

          {isEditing ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={editDraft}
                onChange={(e) => onEditDraftChange(e.target.value.slice(0, 1000))}
                rows={2}
                autoFocus
                className={cn(
                  "w-full resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[15px] text-neutral-900 outline-none",
                  "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
                )}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!editDraft.trim()}
                  onClick={() => onSaveEdit(comment.id)}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-[13px] font-semibold",
                    editDraft.trim()
                      ? "bg-neutral-900 text-white hover:bg-neutral-800"
                      : "cursor-not-allowed bg-neutral-200 text-neutral-400",
                  )}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="m-0 whitespace-pre-wrap break-words text-[15px] font-normal leading-[1.35] text-neutral-800">
                {renderCommentBody(comment.body)}
              </p>
              {isEdited && showOriginal && originalText ? (
                <div className="mt-1.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 ring-1 ring-neutral-100">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                    Original comment
                  </p>
                  <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-[14px] leading-snug text-neutral-600">
                    {renderCommentBody(originalText)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowOriginal(false)}
                    className="mt-0.5 text-[12px] font-semibold text-neutral-500 hover:text-neutral-800"
                  >
                    Hide original
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {isOwn ? (
          <div className="-mt-0.5 shrink-0">
            <CommentMoreMenu
              open={menuOpen}
              onOpenChange={(open) => onMenuOpenChange(open ? comment.id : null)}
              onEdit={() => onStartEdit(comment)}
              onDelete={() => onDelete(comment.id)}
            />
          </div>
        ) : null}
      </div>

      {!isEditing ? (
        <div className="mt-2 flex flex-wrap items-center gap-3 leading-none">
          <button
            type="button"
            onClick={() => onToggleReply(comment)}
            className="text-[13px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
          >
            {isReplying ? "Cancel" : "Reply"}
          </button>
          {!isReply && comment.replies.length > 0 ? (
            <span className="text-[12px] font-medium text-neutral-400">
              {comment.replies.length}{" "}
              {comment.replies.length === 1 ? "reply" : "replies"}
            </span>
          ) : null}
        </div>
      ) : null}

      {isReplying ? (
        <div className="mt-2 flex items-center gap-2">
          <UserAvatar user={sessionUser} size="sm" className="!size-7 !text-[12px]" />
          <div className="relative min-w-0 flex-1">
            <MentionTextField
              autoFocus
              compact
              value={replyDraft}
              onChange={onReplyDraftChange}
              onSubmit={() => onSubmitReply(rootCommentId)}
              placeholder={`Reply to ${firstNameOf(comment.author.full_name)}…`}
              localUsers={mentionUsers}
            />
            <button
              type="button"
              disabled={!replyDraft.trim()}
              onClick={() => onSubmitReply(rootCommentId)}
              aria-label="Send reply"
              className={cn(
                "absolute right-1 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
                replyDraft.trim()
                  ? "text-neutral-700 hover:bg-neutral-100"
                  : "cursor-not-allowed text-neutral-300",
              )}
            >
              <span
                className="inline-block size-4 bg-current"
                style={{
                  WebkitMaskImage: "url(/contents/send-message.png)",
                  maskImage: "url(/contents/send-message.png)",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                }}
                aria-hidden
              />
            </button>
          </div>
        </div>
      ) : null}
    </>
  )

  // Nested reply content only (parent draws avatar + thread path)
  if (isReply) {
    return <div className="min-w-0 flex-1">{commentMain}</div>
  }

  /**
   * Thread style (matches Nextdoor screenshot):
   *   [Main avatar]
   *        |
   *        └──── [Latest reply avatar]
   * Curve is measured to the last reply avatar so opening the reply
   * composer does not move the line until a new reply is submitted.
   */
  return (
    <div ref={threadRootRef} className="relative">
      <div className="flex items-start gap-2.5">
        <UserAvatar
          user={comment.author}
          size="sm"
          className="relative z-10 !size-8 !text-[13px] leading-none !bg-[#c5d0e6] !text-[#2c3a5a]"
        />
        <div className="min-w-0 flex-1">{commentMain}</div>
      </div>

      {hasReplies ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute z-0 rounded-bl-[14px] border-b-[1.5px] border-l-[1.5px] border-neutral-300"
            style={{
              left: threadBox.left,
              top: threadBox.top,
              width: threadBox.width,
              height: threadBox.height,
            }}
          />

          <div className="relative z-[1] space-y-3 pl-10 pt-3">
            {comment.replies.map((reply, index) => {
              const isLast = index === comment.replies.length - 1
              return (
                <div key={reply.id} className="flex items-start gap-2.5">
                  <div
                    ref={isLast ? lastReplyAvatarRef : undefined}
                    className="shrink-0"
                  >
                    <UserAvatar
                      user={reply.author}
                      size="sm"
                      className="!size-8 !text-[13px] leading-none !bg-[#c5d0e6] !text-[#2c3a5a]"
                    />
                  </div>
                  <FeedCommentItem
                    postId={postId}
                    comment={reply}
                    isReply
                    rootCommentId={rootCommentId}
                    replyOpenId={replyOpenId}
                    replyDraft={replyDraft}
                    onToggleReply={onToggleReply}
                    onReplyDraftChange={onReplyDraftChange}
                    onSubmitReply={onSubmitReply}
                    sessionUser={sessionUser}
                    mentionUsers={mentionUsers}
                    menuOpenId={menuOpenId}
                    onMenuOpenChange={onMenuOpenChange}
                    editingId={editingId}
                    editDraft={editDraft}
                    onStartEdit={onStartEdit}
                    onEditDraftChange={onEditDraftChange}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveEdit}
                    onDelete={onDelete}
                  />
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PostCommentsBlock({
  post,
  isExpanded,
  showAllComments,
  onToggleShowAll,
  commentInput,
  onCommentInputChange,
  onSubmitTopLevel,
  replyOpenId,
  replyDraft,
  onToggleReply,
  onReplyDraftChange,
  onSubmitReply,
  sessionUser,
  menuOpenId,
  onMenuOpenChange,
  editingId,
  editDraft,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  post: Concern
  isExpanded: boolean
  showAllComments: boolean
  onToggleShowAll: () => void
  commentInput: string
  onCommentInputChange: (value: string) => void
  onSubmitTopLevel: () => void
  replyOpenId: number | null
  replyDraft: string
  onToggleReply: (comment: ConcernComment) => void
  onReplyDraftChange: (value: string) => void
  onSubmitReply: (parentId: number) => void
  sessionUser: PublicUser | null
  menuOpenId: number | null
  onMenuOpenChange: (id: number | null) => void
  editingId: number | null
  editDraft: string
  onStartEdit: (comment: ConcernComment) => void
  onEditDraftChange: (value: string) => void
  onCancelEdit: () => void
  onSaveEdit: (commentId: number) => void
  onDelete: (commentId: number) => void
}) {
  if (!isExpanded) return null

  const roots = post.comments
  const hiddenCount = Math.max(0, roots.length - 1)
  const visibleRoots =
    showAllComments || roots.length <= 1 ? roots : roots.slice(-1)
  const mentionUsers = collectThreadMentionUsers(post, sessionUser)

  return (
    <div className="space-y-3 pt-1">
      {roots.length > 0 ? (
        <div className="space-y-3.5">
          {hiddenCount > 0 && !showAllComments ? (
            <button
              type="button"
              onClick={onToggleShowAll}
              className="text-[13px] font-semibold text-neutral-600 transition-colors hover:text-neutral-900"
            >
              See previous comments ({hiddenCount})
            </button>
          ) : null}
          {showAllComments && roots.length > 1 ? (
            <button
              type="button"
              onClick={onToggleShowAll}
              className="text-[13px] font-semibold text-neutral-500 transition-colors hover:text-neutral-800"
            >
              Show less
            </button>
          ) : null}

          {visibleRoots.map((c) => (
            <FeedCommentItem
              key={c.id}
              postId={post.id}
              comment={c}
              rootCommentId={c.id}
              replyOpenId={replyOpenId}
              replyDraft={replyDraft}
              onToggleReply={onToggleReply}
              onReplyDraftChange={onReplyDraftChange}
              onSubmitReply={onSubmitReply}
              sessionUser={sessionUser}
              mentionUsers={mentionUsers}
              menuOpenId={menuOpenId}
              onMenuOpenChange={onMenuOpenChange}
              editingId={editingId}
              editDraft={editDraft}
              onStartEdit={onStartEdit}
              onEditDraftChange={onEditDraftChange}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-0.5">
        <UserAvatar user={sessionUser} size="sm" className="size-8 text-[14px]" />
        <div className="relative min-w-0 flex-1">
          <MentionTextField
            id={`home-comment-${post.id}`}
            value={commentInput}
            onChange={onCommentInputChange}
            onSubmit={onSubmitTopLevel}
            placeholder="Add a comment"
            localUsers={mentionUsers}
          />
          <button
            type="button"
            disabled={!commentInput.trim()}
            onClick={onSubmitTopLevel}
            aria-label="Send comment"
            className={cn(
              "absolute right-1.5 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors",
              commentInput.trim()
                ? "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900"
                : "cursor-not-allowed text-neutral-300",
            )}
          >
            <span
              className="inline-block size-7 bg-current"
              style={{
                WebkitMaskImage: "url(/contents/send-message.png)",
                maskImage: "url(/contents/send-message.png)",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
              aria-hidden
            />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  usePageTitle("Home")
  const { user, loading: authLoading } = useAuthSession()
  const { search, setSearch } = useResidentSearch()
  const [createOpen, setCreateOpen] = useState(false)
  const [feedTab, setFeedTab] = useState<FeedTab>("for_you")
  const [feedFilterOpen, setFeedFilterOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [concerns, setConcerns] = useState<Concern[]>([])
  const [getStartedOpen, setGetStartedOpen] = useState(() => {
    try {
      return localStorage.getItem(GET_STARTED_KEY) !== "1"
    } catch {
      return true
    }
  })
  const [expandedComments, setExpandedComments] = useState<Set<number>>(new Set())
  const [showAllComments, setShowAllComments] = useState<Set<number>>(new Set())
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({})
  /** Which comment is open for reply (global — one at a time) */
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [commentMenuOpenId, setCommentMenuOpenId] = useState<number | null>(null)
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState("")
  const [menuOpenPostId, setMenuOpenPostId] = useState<number | null>(null)
  const [reportDialogPostId, setReportDialogPostId] = useState<number | null>(null)
  const [barangayActiveEmergencies, setBarangayActiveEmergencies] = useState(0)

  const displayName = user
    ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Resident"
    : "Resident"

  const hasOngoingAlerts = barangayActiveEmergencies > 0

  const streetLabel = streetLabelFromAddress(user?.address)

  /** Live rail map — real OSM (same embed style as report maps), street when known */
  const [railMap, setRailMap] = useState<{ lat: number; lng: number }>({
    lat: MARIKINA_HEIGHTS_CENTER.lat,
    lng: MARIKINA_HEIGHTS_CENTER.lng,
  })
  const railMapSrc = useMemo(
    () => railLiveMapSrc(railMap.lat, railMap.lng),
    [railMap.lat, railMap.lng],
  )

  useEffect(() => {
    let cancelled = false
    async function resolveRailMap() {
      if (!streetLabel) {
        setRailMap({
          lat: MARIKINA_HEIGHTS_CENTER.lat,
          lng: MARIKINA_HEIGHTS_CENTER.lng,
        })
        return
      }
      // streetLabel may be "123 Champaca Street" — geocode as full street line
      const hit = await geocodeMarikinaStreet(streetLabel)
      if (cancelled) return
      if (hit) {
        setRailMap({ lat: hit.lat, lng: hit.lng })
      } else {
        setRailMap({
          lat: MARIKINA_HEIGHTS_CENTER.lat,
          lng: MARIKINA_HEIGHTS_CENTER.lng,
        })
      }
    }
    void resolveRailMap()
    return () => {
      cancelled = true
    }
  }, [streetLabel])

  const sessionUserAsPublic: PublicUser | null = user
    ? {
        id: user.id,
        full_name: displayName,
        role: user.role,
        initials:
          `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() || "?",
        last_seen_at: null,
        street: streetLabel ?? undefined,
        barangay: user.barangay || BARANGAY,
      }
    : null

  async function loadHome() {
    setError("")
    try {
      const [nextAnnouncements, nextConcerns, nextEvents, summary] = await Promise.all([
        listAnnouncements(),
        listFeedConcerns("all", undefined, undefined, search || undefined),
        listTodayBarangayEvents(),
        getResidentDashboardSummary().catch(() => null),
      ])
      setAnnouncements(nextAnnouncements)
      setConcerns(nextConcerns)
      setEvents(nextEvents)
      const count =
        summary?.barangay_active_emergencies ??
        (summary?.has_ongoing_emergencies ? 1 : 0)
      setBarangayActiveEmergencies(typeof count === "number" ? count : 0)
    } catch {
      setError("Could not load home feed.")
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    if (authLoading) return
    void loadHome()
    function refresh() {
      void loadHome()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener("eboses:report-created", refresh)
    window.addEventListener("eboses:concern-updated", refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("eboses:report-created", refresh)
      window.removeEventListener("eboses:concern-updated", refresh)
    }
  }, [authLoading, search])

  function dismissGetStarted() {
    setGetStartedOpen(false)
    try {
      localStorage.setItem(GET_STARTED_KEY, "1")
    } catch {
      /* ignore */
    }
  }

  async function handleVote(post: Concern) {
    const nextVote = post.user_vote === 1 ? 0 : 1
    const result = await voteConcern(post.id, nextVote)
    setConcerns((items) =>
      items.map((item) =>
        item.id === post.id
          ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count }
          : item,
      ),
    )
  }

  async function submitComment(postId: number, parentId?: number | null) {
    const isReply = parentId != null
    const body = (isReply ? replyDraft : commentInputs[postId] ?? "").trim()
    if (!body) return
    try {
      await commentOnConcern(postId, {
        body,
        parent: parentId ?? null,
      })
      if (isReply) {
        setReplyDraft("")
        setReplyOpenId(null)
      } else {
        setCommentInputs((current) => ({ ...current, [postId]: "" }))
      }
      await loadHome()
      setExpandedComments((current) => new Set(current).add(postId))
      if (isReply) {
        setShowAllComments((current) => new Set(current).add(postId))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post comment.")
    }
  }

  async function saveCommentEdit(postId: number, commentId: number) {
    const body = editDraft.trim()
    if (!body) {
      toast.error("Comment cannot be empty.")
      return
    }
    try {
      await updateConcernComment(postId, commentId, { body })
      setEditingCommentId(null)
      setEditDraft("")
      await loadHome()
      toast.success("Comment updated")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update comment.")
    }
  }

  async function removeComment(postId: number, commentId: number) {
    if (!window.confirm("Delete this comment?")) return
    try {
      await deleteConcernComment(postId, commentId)
      if (editingCommentId === commentId) {
        setEditingCommentId(null)
        setEditDraft("")
      }
      if (replyOpenId === commentId) {
        setReplyOpenId(null)
        setReplyDraft("")
      }
      await loadHome()
      toast.success("Comment deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete comment.")
    }
  }

  const sortedConcerns = useMemo(() => {
    const list = [...concerns]
    if (feedTab === "trending") {
      return list.sort(
        (a, b) => b.vote_count + b.comment_count - (a.vote_count + a.comment_count),
      )
    }
    return list.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [concerns, feedTab])

  if (!loaded) {
    return (
      <div className="min-h-0 flex-1 bg-white">
        <div className="px-4 py-3">
          <Skeleton className="mx-auto h-10 w-full max-w-md rounded-full" />
        </div>
        <div
          className="mx-auto grid w-full gap-4 p-4 md:px-5"
          style={{
            maxWidth: FEED_MAX + RAIL_W + 16,
            gridTemplateColumns: `minmax(0, ${FEED_MAX}px) ${RAIL_W}px`,
          }}
        >
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
          <div className="hidden min-w-0 space-y-3 md:block">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* Mobile top — also used at ~200% zoom (CSS width < 1024) */}
      <style>{`
        .resident-mobile-top { display: none; }
        .resident-mobile-only { display: none; }
        .resident-home-rail { min-width: 0; }
        @media (max-width: ${RESIDENT_DESKTOP_MIN_PX - 1}px) {
          .resident-mobile-top { display: block; }
          .resident-mobile-only { display: block; }
          .resident-home-desktop-grid { display: block !important; }
          .resident-home-rail { display: none !important; }
        }
        /* Live Carto-light map badge; scan rings only on the green status dot */
        .rail-live-dot {
          position: relative;
          display: inline-flex;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
        }
        .rail-live-dot__map {
          position: relative;
          z-index: 1;
          width: 40px;
          height: 40px;
          overflow: hidden;
          border-radius: 9999px;
          background: #e8eef5;
        }
        .rail-live-dot__map img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        /* Green live dot — centered on the map; rings attach only to this dot */
        .rail-live-dot__status-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 2;
          width: 12px;
          height: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
        }
        .rail-live-dot__status {
          position: relative;
          z-index: 2;
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          background: #22c55e;
          border: 1.5px solid #fff;
          box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.25);
        }
        .rail-live-dot__status--alert {
          background: #ef4444;
          box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);
        }
        .rail-live-dot__ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 10px;
          margin-left: -5px;
          margin-top: -5px;
          border-radius: 9999px;
          border: 1.5px solid rgba(34, 197, 94, 0.55);
          animation: rail-live-scan 3.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
          pointer-events: none;
        }
        .rail-live-dot__ring--alert {
          border-color: rgba(239, 68, 68, 0.6);
        }
        .rail-live-dot__ring--delay {
          animation-delay: 1.9s;
        }
        @keyframes rail-live-scan {
          0% {
            transform: scale(1);
            opacity: 0.65;
          }
          70% {
            transform: scale(2.6);
            opacity: 0;
          }
          100% {
            transform: scale(2.6);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rail-live-dot__ring { animation: none; opacity: 0.3; transform: scale(1.4); }
        }
      `}</style>
      {/* Mobile top: map+status dot · Marikina Heights · search icon · notif · avatar */}
      <header className="resident-mobile-top sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="flex h-12 items-center gap-2 px-4">
          <Link
            to="/dashboard/alerts-map"
            className="rail-live-dot shrink-0 no-underline"
            aria-label={
              hasOngoingAlerts
                ? `Live map — ${barangayActiveEmergencies} ongoing alert${barangayActiveEmergencies === 1 ? "" : "s"}`
                : "Live map — Marikina Heights"
            }
            title="Open alerts map"
          >
            <span className="rail-live-dot__map">
              <img src={railMapSrc} alt="" loading="lazy" decoding="async" />
            </span>
            <span className="rail-live-dot__status-wrap">
              <span
                className={cn(
                  "rail-live-dot__ring",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "rail-live-dot__ring rail-live-dot__ring--delay",
                  hasOngoingAlerts && "rail-live-dot__ring--alert",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "rail-live-dot__status",
                  hasOngoingAlerts && "rail-live-dot__status--alert",
                )}
                aria-hidden
              />
            </span>
          </Link>
          <p className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-tight text-neutral-900">
            {BARANGAY}
          </p>
          <button
            type="button"
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="group flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 hover:bg-neutral-50"
            aria-label="Search"
            aria-expanded={mobileSearchOpen}
          >
            <SearchIcon
              className={cn(
                "size-7 shrink-0 transition-opacity duration-150",
                mobileSearchOpen
                  ? "opacity-100"
                  : "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
              )}
              strokeWidth={2}
            />
          </button>
          <NotificationPopover />
          <ProfileAccountMenu placeLabel={BARANGAY} />
        </div>
        {mobileSearchOpen ? (
          <div className="border-t border-neutral-200 bg-white px-4 py-2.5">
            <RotatingSearchField
              value={search}
              onChange={setSearch}
              maxWidth="100%"
              inputClassName="h-10 border border-neutral-200 bg-white"
            />
          </div>
        ) : null}
      </header>

      {/*
        Mobile: padded feed · Desktop: same grid as top bar
      */}
      <ResidentContentGrid className="resident-home-desktop-grid min-w-0 flex-1 pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-3 max-lg:pt-3.5 md:pb-8 md:pt-3">
        {/* CENTER feed column */}
        <div className="min-w-0 w-full max-lg:px-3.5">
          {/* Composer — mobile: rounded pill (avatar→Report); filter sits beside outside */}
          <section className="mb-3 w-full bg-white md:mb-2 md:rounded-lg md:border-[1.5px] md:border-neutral-300 md:px-3.5 md:py-3.5">
            <div className="flex min-h-11 items-center gap-2.5">
              <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50/80 py-1 pl-1.5 pr-1.5 md:contents">
                <UserAvatar user={sessionUserAsPublic} size="md" className="size-9 text-[15px] sm:size-10 sm:text-[17px]" />
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="min-h-9 min-w-0 flex-1 rounded-full bg-transparent px-2 py-2 text-left text-[11px] font-normal leading-snug text-neutral-600 transition-colors hover:text-neutral-800 sm:px-3 sm:text-[13px] md:min-h-10 md:bg-neutral-100 md:px-4 md:hover:bg-neutral-200/70"
                >
                  What&apos;s happening in your barangay?
                </button>
                {/* Gallery / photo — desktop only; hidden on mobile */}
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="hidden size-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 md:flex"
                  aria-label="Add photo"
                >
                  <ImageIcon className="size-6" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="h-9 shrink-0 rounded-full bg-[#ff6a1a] px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#e85f12] active:scale-[0.98] sm:h-10 sm:px-5 sm:text-[14px]"
                >
                  Report
                </button>
              </div>
              {/* Filter — mobile only; outside the report pill, still beside it */}
              <button
                type="button"
                onClick={() => setFeedFilterOpen(true)}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100/70 md:hidden"
                aria-label="Filter feed"
              >
                <SlidersHorizontalIcon className="size-5" strokeWidth={2} />
              </button>
            </div>
          </section>

          {/* Desktop: inline chips only */}
          <div className="mb-3 hidden flex-wrap items-center gap-1.5 md:flex">
            {FEED_TABS.map((tab) => {
              const active = feedTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFeedTab(tab.id)}
                  className={cn(
                    "h-8 rounded-sm border-2 px-3.5 text-[13px] font-semibold transition-colors outline-none",
                    "focus-visible:border-[#07145f] focus-visible:text-[#07145f]",
                    active
                      ? "border-[#07145f] bg-white text-[#07145f]"
                      : "border-[#d0d0d0] bg-white text-neutral-600 hover:border-[#07145f] hover:bg-neutral-50 hover:text-[#07145f]",
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {getStartedOpen ? (
            <section className="mb-3 max-lg:pt-1">
              <div className="mb-1.5 flex items-center justify-between">
                <h2 className={cn("font-bold text-neutral-900", FS.section)}>Get started on E-Boses</h2>
                <button
                  type="button"
                  onClick={dismissGetStarted}
                  className="flex size-7 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
                  aria-label="Dismiss"
                >
                  <XIcon className={IC.xs} strokeWidth={STROKE} />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2.5 min-[520px]:grid-cols-3">
                <GetStartedCard
                  icon={<PencilIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Report a concern"
                  body="Tell the barangay about issues near you."
                  cta="Report"
                  onClick={() => setCreateOpen(true)}
                />
                <GetStartedCard
                  icon={<FileTextIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Track your reports"
                  body="Follow status updates on what you submitted."
                  cta="View reports"
                  to="/dashboard/reports"
                />
                <GetStartedCard
                  icon={<AlertTriangleIcon className={IC.md} strokeWidth={STROKE} />}
                  title="Emergency SOS"
                  body="Get urgent help from barangay responders."
                  cta="How it works"
                  onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
                />
              </div>
            </section>
          ) : null}

          {events.length > 0 ? (
            <section className="resident-mobile-only mb-3 rounded-2xl border border-neutral-200 bg-white p-3.5 md:mb-3 md:rounded-lg">
              <div className="flex items-center gap-2 text-[#07145f]">
                <CalendarDaysIcon className="size-7" strokeWidth={STROKE} />
                <h2 className="text-[16px] font-bold">Today in your barangay</h2>
              </div>
              <div className="mt-3 divide-y divide-neutral-200">
                {events.map((event) => (
                  <div key={event.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-[15px] font-bold text-neutral-900">{event.title}</p>
                    <p className="mt-1 text-[14px] leading-5 text-neutral-600">{event.detail}</p>
                    <p className="mt-1 text-[13px] font-medium text-[#07145f]">
                      {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {error ? <p className="mb-3 text-[15px] text-destructive">{error}</p> : null}

          {hasOngoingAlerts ? (
            <Link
              to="/dashboard/alerts-map"
              className="mb-3 flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 no-underline transition-colors hover:bg-red-100/80 md:mb-2.5 md:rounded-lg md:border"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <AlertTriangleIcon className="size-5" strokeWidth={2.25} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-red-800">
                  {barangayActiveEmergencies} ongoing alert
                  {barangayActiveEmergencies === 1 ? "" : "s"} in {BARANGAY}
                </span>
                <span className="mt-0.5 block text-[13px] font-medium text-red-700/90">
                  See locations, reports, and services on the map
                </span>
              </span>
              <ChevronRightIcon className="size-5 shrink-0 text-red-600" strokeWidth={2} />
            </Link>
          ) : null}

          <div className="flex flex-col gap-3 max-lg:gap-3 md:gap-2.5">
            {announcements.map((announcement) => (
              <article
                key={`a-${announcement.id}`}
                className="rounded-2xl border border-neutral-200 bg-white p-3.5 md:rounded-lg"
              >
                <div className="flex gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff1ea]">
                    <img src="/contents/announcements.png" alt="" className="size-7 object-contain" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={cn("truncate font-bold text-neutral-900", FS.author)}>
                          Barangay Hall
                        </p>
                        <p
                          className={cn(
                            "flex flex-wrap items-center gap-1 text-neutral-500",
                            FS.meta,
                          )}
                        >
                          <span>{BARANGAY}</span>
                          <span>·</span>
                          <span>{announcement.date_label}</span>
                          <GlobeIcon className={IC.xxs} strokeWidth={STROKE} />
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-md bg-[#fff1ea] px-1.5 py-0.5 font-bold uppercase text-[#ff6a1a]",
                          FS.label,
                        )}
                      >
                        {announcement.tag || "Announcement"}
                      </span>
                    </div>
                    <h3 className={cn("mt-2 font-bold leading-snug text-neutral-900", FS.body)}>
                      {announcement.title}
                    </h3>
                    <p className={cn("mt-1 leading-relaxed text-neutral-800", FS.body)}>
                      {announcement.body}
                    </p>
                  </div>
                </div>
              </article>
            ))}

            {sortedConcerns.map((post) => {
              const isExpanded = expandedComments.has(post.id)
              const reporterStreet = streetLabelFromAddress(post.reporter.street)
              return (
                <article
                  key={post.id}
                  className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white md:rounded-lg"
                >
                  {/* Header + body (padded) */}
                  <div className="flex gap-2.5 p-3.5 pb-0">
                    <UserAvatar user={post.reporter} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn("truncate font-bold text-neutral-900", FS.author)}>
                            {post.reporter.full_name}
                          </p>
                          <p
                            className={cn(
                              "inline-flex max-w-full items-center gap-1 overflow-hidden text-neutral-500",
                              FS.meta,
                            )}
                          >
                            {reporterStreet ? (
                              <>
                                <span className="min-w-0 truncate">{reporterStreet}</span>
                                <span className="shrink-0" aria-hidden>
                                  ·
                                </span>
                              </>
                            ) : null}
                            <span className="shrink-0">{categoryLabel(post.category)}</span>
                            <span className="shrink-0" aria-hidden>
                              ·
                            </span>
                            <span className="shrink-0">{timeAgo(post.created_at)}</span>
                            <GlobeIcon className={cn(IC.xxs, "shrink-0")} strokeWidth={STROKE} />
                          </p>
                        </div>
                        <PostMoreMenu
                          open={menuOpenPostId === post.id}
                          onOpenChange={(open) =>
                            setMenuOpenPostId(open ? post.id : null)
                          }
                          onReport={() => setReportDialogPostId(post.id)}
                        />
                      </div>

                      <p className={cn("mt-2 leading-relaxed text-neutral-900", FS.body)}>
                        {concernBodyText(post)}
                      </p>
                    </div>
                  </div>

                  {/* Media — edge-to-edge; slight line above the image */}
                  {post.media.length > 0 && post.media[0].mime_type?.startsWith("image/") ? (
                    <div className="mt-2.5 border-y border-neutral-200">
                      <img
                        src={post.media[0].preview_url}
                        alt=""
                        className="max-h-80 w-full object-cover"
                      />
                    </div>
                  ) : null}

                  {/* Engagement + collapsible comments */}
                  <div className="space-y-2.5 p-3.5 pt-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleVote(post)}
                        aria-label={post.user_vote === 1 ? "Remove upvote" : "Upvote"}
                        aria-pressed={post.user_vote === 1}
                        className={cn(
                          "inline-flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-neutral-100 px-2.5 text-neutral-500 transition-colors",
                          "hover:bg-neutral-200/80 hover:text-neutral-800",
                          "active:text-neutral-800",
                          post.user_vote === 1 && "bg-neutral-200/90 text-neutral-800",
                        )}
                      >
                        <ArrowBigUpIcon
                          className="size-7 shrink-0 fill-current"
                          strokeWidth={STROKE}
                        />
                        {post.vote_count > 0 ? (
                          <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                            {post.vote_count}
                          </span>
                        ) : null}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setExpandedComments((prev) => {
                            const next = new Set(prev)
                            if (next.has(post.id)) next.delete(post.id)
                            else next.add(post.id)
                            return next
                          })
                          window.requestAnimationFrame(() => {
                            if (!isExpanded) {
                              document.getElementById(`home-comment-${post.id}`)?.focus()
                            }
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
                        {/* Flaticon chat 3416046 — comment beside upvote */}
                        <span
                          className="inline-block size-6 shrink-0 bg-current"
                          style={{
                            WebkitMaskImage: "url(/contents/chat-comment.png)",
                            maskImage: "url(/contents/chat-comment.png)",
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                          }}
                          aria-hidden
                        />
                        {post.comment_count > 0 ? (
                          <span className="pr-0.5 text-[13px] font-semibold tabular-nums">
                            {post.comment_count}
                          </span>
                        ) : null}
                      </button>
                    </div>

                    <PostCommentsBlock
                      post={post}
                      isExpanded={isExpanded}
                      showAllComments={showAllComments.has(post.id)}
                      onToggleShowAll={() => {
                        setShowAllComments((prev) => {
                          const next = new Set(prev)
                          if (next.has(post.id)) next.delete(post.id)
                          else next.add(post.id)
                          return next
                        })
                      }}
                      commentInput={commentInputs[post.id] ?? ""}
                      onCommentInputChange={(value) =>
                        setCommentInputs((prev) => ({ ...prev, [post.id]: value }))
                      }
                      onSubmitTopLevel={() => void submitComment(post.id)}
                      replyOpenId={replyOpenId}
                      replyDraft={replyDraft}
                      onToggleReply={(c) => {
                        setReplyOpenId((cur) => {
                          if (cur === c.id) {
                            setReplyDraft("")
                            return null
                          }
                          // Prefill @FirstName mention (bold+underline when rendered)
                          setReplyDraft(
                            `${mentionToken(toMentionUser(c.author))} `,
                          )
                          return c.id
                        })
                      }}
                      onReplyDraftChange={setReplyDraft}
                      onSubmitReply={(parentId) => void submitComment(post.id, parentId)}
                      sessionUser={sessionUserAsPublic}
                      menuOpenId={commentMenuOpenId}
                      onMenuOpenChange={setCommentMenuOpenId}
                      editingId={editingCommentId}
                      editDraft={editDraft}
                      onStartEdit={(c) => {
                        setEditingCommentId(c.id)
                        setEditDraft(c.body)
                        setReplyOpenId(null)
                      }}
                      onEditDraftChange={setEditDraft}
                      onCancelEdit={() => {
                        setEditingCommentId(null)
                        setEditDraft("")
                      }}
                      onSaveEdit={(commentId) => void saveCommentEdit(post.id, commentId)}
                      onDelete={(commentId) => void removeComment(post.id, commentId)}
                    />
                  </div>
                </article>
              )
            })}

            {announcements.length === 0 && sortedConcerns.length === 0 && !error ? (
              <div className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white px-6 py-10 text-center">
                <img
                  src="/contents/feed-header.png"
                  alt=""
                  className="mb-4 h-44 w-auto max-w-[90%] object-contain opacity-95 sm:h-52"
                />
                <p className="text-[15px] font-semibold text-neutral-700">Nothing in the feed yet.</p>
                <p className="mt-1 text-[14px] text-neutral-500">
                  Be the first to post in {BARANGAY}.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT RAIL — sticky while feed scrolls */}
        <aside className="resident-home-rail sticky top-3 flex w-full min-w-0 flex-col gap-2.5 self-start">
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <Link
              to="/dashboard/alerts-map"
              className="flex min-w-0 items-center gap-3 px-3.5 py-3 no-underline transition-colors hover:bg-neutral-50"
            >
              <span
                className="rail-live-dot"
                title={hasOngoingAlerts ? "Ongoing alerts in your barangay" : "Live in your barangay"}
                aria-hidden
              >
                <span className="rail-live-dot__map">
                  <img src={railMapSrc} alt="" loading="lazy" decoding="async" />
                </span>
                <span className="rail-live-dot__status-wrap">
                  <span
                    className={cn(
                      "rail-live-dot__ring",
                      hasOngoingAlerts && "rail-live-dot__ring--alert",
                    )}
                  />
                  <span
                    className={cn(
                      "rail-live-dot__ring rail-live-dot__ring--delay",
                      hasOngoingAlerts && "rail-live-dot__ring--alert",
                    )}
                  />
                  <span
                    className={cn(
                      "rail-live-dot__status",
                      hasOngoingAlerts && "rail-live-dot__status--alert",
                    )}
                  />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("truncate font-semibold leading-snug text-neutral-900", FS.railTitle)}>
                  {BARANGAY}
                </p>
                {hasOngoingAlerts ? (
                  <p className={cn("mt-0.5 truncate font-semibold leading-snug text-red-600", FS.meta)}>
                    {barangayActiveEmergencies} ongoing alert
                    {barangayActiveEmergencies === 1 ? "" : "s"}
                  </p>
                ) : streetLabel ? (
                  <p className={cn("mt-0.5 truncate font-normal leading-snug text-neutral-500", FS.meta)}>
                    {streetLabel}
                  </p>
                ) : null}
              </div>
            </Link>
            <Link
              to="/dashboard/alerts-map"
              className={cn(
                "flex items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 font-semibold no-underline transition-colors",
                hasOngoingAlerts
                  ? "text-red-600 hover:bg-red-50 hover:text-red-700"
                  : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700",
                FS.railLink,
              )}
            >
              <span>{hasOngoingAlerts ? "See all ongoing alerts" : "See all alerts"}</span>
              <ChevronRightIcon
                className={cn(RAIL_CHEVRON, hasOngoingAlerts ? "text-red-600" : "text-neutral-500")}
                strokeWidth={2}
              />
            </Link>
          </div>

          {events.length > 0 ? (
            <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-3.5">
              <div className="flex items-center gap-2 text-[#07145f]">
                <CalendarDaysIcon className="size-7" strokeWidth={STROKE} />
                <h2 className={cn("font-bold", FS.railTitle)}>Today</h2>
              </div>
              <div className="mt-2 divide-y divide-neutral-200">
                {events.slice(0, 3).map((event) => (
                  <div key={event.id} className="py-2.5 first:pt-1 last:pb-0">
                    <p className={cn("font-bold text-neutral-900", FS.railBody)}>{event.title}</p>
                    <p className={cn("mt-0.5 text-neutral-500", FS.meta)}>
                      {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(event.starts_at))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 p-3">
              <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-[#e8f0fa]">
                <img
                  src="/contents/marikina-area-2.png"
                  alt="Marikina City landmark"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="px-3.5 py-3">
              <p className={cn("font-bold text-neutral-900", FS.railTitle)}>
                Report a local concern
              </p>
              <p className={cn("mt-1 leading-relaxed text-neutral-600", FS.railBody)}>
                Share issues with neighbors and barangay officials so they can take action.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className={cn(
                "flex w-full items-center justify-between border-t border-neutral-200 px-3.5 py-2.5 text-left font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700",
                FS.railLink,
              )}
            >
              <span>Create a report</span>
              <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-neutral-500")} strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("eboses:open-sos"))}
            className="flex w-full items-center justify-between rounded-lg border border-red-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-red-300 hover:bg-red-50/40"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Same Flaticon alert glyph as sidebar Alerts — red, no circle fill */}
              <span
                className="inline-block size-7 shrink-0 bg-red-600"
                style={{
                  WebkitMaskImage: "url(/contents/nav-alert.png)",
                  maskImage: "url(/contents/nav-alert.png)",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                }}
                aria-hidden
              />
              <div className="min-w-0">
                <p className={cn("font-bold text-red-700", FS.railTitle)}>Emergency SOS</p>
                <p className={cn("text-red-600/75", FS.meta)}>Get help from responders</p>
              </div>
            </div>
            <ChevronRightIcon className={cn(RAIL_CHEVRON, "text-red-400/70")} strokeWidth={2} />
          </button>
        </aside>
      </ResidentContentGrid>

      {/* Mobile feed filter sheet — Nextdoor “Filter by” layout, E-Boses white */}
      {feedFilterOpen ? (
        <div
          className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/30 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filter by"
        >
          <button
            type="button"
            className="min-h-0 flex-1 cursor-default"
            aria-label="Dismiss filters"
            onClick={() => setFeedFilterOpen(false)}
          />
          <div className="rounded-t-3xl border border-neutral-200 border-b-0 bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(15,23,42,0.14)]">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-300" />
            <h2 className="mb-2 px-1 text-[20px] font-bold tracking-tight text-neutral-900">
              Filter by
            </h2>
            <ul className="pb-2">
              {FEED_TABS.map((tab) => {
                const active = feedTab === tab.id
                return (
                  <li key={tab.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedTab(tab.id)
                        setFeedFilterOpen(false)
                      }}
                      className="flex min-h-12 w-full items-center justify-between px-1 py-3 text-left text-[16px] text-neutral-800 transition-colors hover:bg-neutral-50"
                    >
                      <span className={cn(active && "font-semibold text-neutral-900")}>
                        {tab.label}
                      </span>
                      {active ? (
                        <CheckIcon
                          className="size-5 shrink-0 text-neutral-900"
                          strokeWidth={2.25}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ReportPostDialog
        open={reportDialogPostId != null}
        concernId={reportDialogPostId}
        onClose={() => setReportDialogPostId(null)}
      />
    </div>
  )
}

function GetStartedCard({
  icon,
  title,
  body,
  cta,
  to,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  to?: string
  onClick?: () => void
}) {
  const inner = (
    <>
      <span className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-700">
        {icon}
      </span>
      <p className="mt-2.5 text-[15px] font-bold leading-snug text-neutral-900">{title}</p>
      <p className="mt-1 flex-1 text-[14px] leading-relaxed text-neutral-500">{body}</p>
      <span className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-neutral-900 px-4 text-[14px] font-bold text-white">
        {cta}
      </span>
    </>
  )

  const className =
    "flex min-w-0 flex-col rounded-lg border border-neutral-200 bg-white p-3.5 no-underline transition-colors hover:bg-neutral-50/80"

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={cn(className, "text-left")}>
      {inner}
    </button>
  )
}
