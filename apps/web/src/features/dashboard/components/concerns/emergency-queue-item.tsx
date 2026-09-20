import { useState } from "react"
import { toast } from "sonner"
import {
  CircleCheckIcon,
  ImageIcon,
  MapPinIcon,
  MessageCircleIcon,
  NavigationIcon,
  SignalIcon,
  TriangleAlert,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  addEmergencyCommunityComment,
  listEmergencyCommunityComments,
  type EmergencyAlert,
  type EmergencyCommunityComment,
} from "@/features/dashboard/emergency-api"
import {
  avatarTone,
  severityTintStyle,
  statusTintStyle,
} from "@/features/dashboard/components/concerns/concern-queue-item"
import {
  readableLocation,
  streetOnly,
} from "@/features/dashboard/lib/location-text"
import type { PublicUser } from "@/features/dashboard/api"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import { emergencyDescription } from "@/features/dashboard/lib/emergency-description"
import {
  emergencyResponderAssignments,
  emergencyRouteSummary,
  historicalRouteSummary,
  responderName,
  responderStatusLabel,
} from "@/features/dashboard/components/emergencies/lib"
import { EmergencyResolutionBanner } from "@/features/dashboard/components/emergencies/emergency-resolution-banner"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import {
  CommentAttachment,
  CommentComposer,
} from "@/features/dashboard/components/comments"

const TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
}

function typeLabelOf(type: string) {
  const label = TYPE_LABEL[type] ?? (type || "Emergency").replace(/_/g, " ")
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function alertTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const now = new Date()
  if (date.toDateString() === now.toDateString())
    return `Today at ${formatter.format(date)}`
  if (
    new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString()
  )
    return `Yesterday at ${formatter.format(date)}`
  return formatter.format(date)
}

/** Public emergency footer: responder avatars take the place of concern upvotes. */
export function EmergencyEngagementFooter({
  alert,
  commentCount = alert.comment_count ?? 0,
  commentsOpen = false,
  onCommentsClick,
}: {
  alert: EmergencyAlert
  commentCount?: number
  commentsOpen?: boolean
  onCommentsClick?: () => void
}) {
  if (!alert.is_public) return null

  const responders = Array.from(
    new Map(
      emergencyResponderAssignments(alert).map((assignment) => [
        assignment.responder.id,
        assignment.responder,
      ])
    ).values()
  )
  const settled = !isEmergencyActive(alert.status)
  const visibleResponders = responders.slice(0, 3)
  const extraResponders = Math.max(
    responders.length - visibleResponders.length,
    0
  )
  const safeCommentCount = Math.max(commentCount, 0)
  const commentContent = (
    <>
      <MessageCircleIcon className="size-3.5" strokeWidth={2} />
      <span>{safeCommentCount} comments</span>
    </>
  )

  return (
    <div className="mt-3 border-t border-neutral-100 pt-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex -space-x-1.5" aria-label="Responders responding">
            {visibleResponders.map((responder) => (
              <UserAvatar
                key={responder.id}
                user={responder}
                size="sm"
                className="!size-5 text-[8px] ring-1 ring-white"
                title={responder.full_name}
              />
            ))}
            {extraResponders > 0 ? (
              <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100 text-[8px] font-semibold text-neutral-500 ring-1 ring-white">
                +{extraResponders}
              </span>
            ) : null}
          </div>
          <span className="truncate text-[10px] font-medium text-neutral-500">
            {settled && responders.length
              ? "Responded"
              : responders.length
                ? `${responders.length} responder${responders.length === 1 ? "" : "s"} responding`
                : "No responder yet"}
          </span>
        </div>

        {onCommentsClick ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onCommentsClick()
            }}
            aria-label={commentsOpen ? "Hide comments" : "See comments"}
            className={cn(
              "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
              commentsOpen
                ? "text-neutral-800"
                : "text-neutral-500 hover:text-neutral-800"
            )}
          >
            {commentContent}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-neutral-500">
            {commentContent}
          </span>
        )}
      </div>
    </div>
  )
}

export function EmergencyQueueItem({
  alert,
  active,
  onSelect,
  sessionUser,
}: {
  alert: EmergencyAlert
  active: boolean
  onSelect: () => void
  sessionUser?: PublicUser | null
}) {
  const live = isEmergencyActive(alert.status)
  const resolved = !isEmergencyActive(alert.status)
  // A settled emergency gets the same green wash as resolved concerns so
  // closed cases read at a glance — critical red while live, neutral red when
  // cancelled or invalid.
  const rowTint = live
    ? severityTintStyle("critical", true)
    : resolved
      ? statusTintStyle("resolved")
      : statusTintStyle("rejected")
  const reporterName =
    alert.reporter_display?.trim() ||
    alert.reporter?.full_name?.trim() ||
    "Unknown reporter"
  const responderAssignments = emergencyResponderAssignments(alert)
  const routeResponders = Array.from(
    new Map(
      responderAssignments.map((assignment) => [
        assignment.responder.id,
        assignment.responder,
      ])
    ).values()
  )
  // Routes are attached to the active assignment once dispatch starts, and
  // fall back to the alert-level route before an assignment is created.
  const route = alert.current_assignment?.route ?? alert.route
  const routeResponder =
    alert.current_assignment?.responder ?? routeResponders[0]
  const historicalRoutes = resolved
    ? responderAssignments.filter(
        (assignment) =>
          assignment.route || (assignment.location_history?.length ?? 0) > 1
      )
    : []
  const location = readableLocation(
    alert.display_location,
    alert.resolved_location,
    alert.address,
    alert.reported_area,
    alert.barangay
  )

  const street = streetOnly(location)

  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<EmergencyCommunityComment[] | null>(
    null
  )
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)

  const commentCount = comments ? comments.length : (alert.comment_count ?? 0)

  async function loadComments() {
    setCommentsLoading(true)
    try {
      setComments(await listEmergencyCommunityComments(alert.id))
    } catch {
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }

  async function toggleComments() {
    const next = !showComments
    setShowComments(next)
    if (next && comments == null) await loadComments()
  }

  async function submitComment(media?: File | null): Promise<boolean> {
    const body = draft.trim()
    if ((!body && !media) || posting) return false
    setPosting(true)
    try {
      await addEmergencyCommunityComment(alert.id, body, null, media)
      setDraft("")
      await loadComments()
      return true
    } catch {
      toast.error("Could not post the comment.")
      return false
    } finally {
      setPosting(false)
    }
  }

  return (
    <article
      aria-label={typeLabelOf(alert.type)}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer flex-col rounded-[24px] bg-white p-4 text-left ring-1 transition duration-150",
        active ? "ring-neutral-300" : "ring-neutral-200 hover:ring-neutral-300"
      )}
      style={rowTint}
    >
      <div className="flex items-center gap-2.5">
        <UserAvatar
          user={alert.reporter ?? { full_name: reporterName }}
          size="sm"
          className={cn("!size-9 text-[14px]", avatarTone)}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight font-normal text-subtle-foreground">
            {reporterName}
          </span>
          <span className="mt-0.5 block truncate text-[11px] leading-tight font-normal text-faint-foreground">
            {typeLabelOf(alert.type)}
          </span>
        </span>
        {resolved ? (
          <span
            className="mr-1.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700"
            title="Resolved"
          >
            Resolved
            <CircleCheckIcon className="size-5 shrink-0" strokeWidth={1.9} />
          </span>
        ) : (
          <span
            className="mr-1.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-sos"
            title="Critical priority"
          >
            <SignalIcon className="size-3.5 shrink-0" strokeWidth={2} />
            Critical
            <TriangleAlert
              className={cn(
                "size-5 shrink-0",
                live ? "text-sos" : "text-navy-muted/90"
              )}
              strokeWidth={live ? 2 : 1.8}
            />
          </span>
        )}
      </div>

      <p className="mt-2.5 text-[16px] leading-snug font-medium text-foreground">
        {street
          ? `${typeLabelOf(alert.type)} emergency around ${street}`
          : `${typeLabelOf(alert.type)} emergency`}
      </p>

      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint-foreground">
        <span className="shrink-0">{alertTime(alert.created_at)}</span>
      </div>

      <div className="mt-1.5 border-t border-neutral-100" />
      <div className="mt-1.5">
        <p className="line-clamp-3 text-[12px] leading-relaxed text-subtle-foreground">
          {emergencyDescription(alert)}
        </p>
      </div>
      {alert.media && alert.media.length > 0 ? (
        <div className="mt-2 flex gap-1.5">
          {alert.media.slice(0, 3).map((item) =>
            item.mime_type.startsWith("image/") ? (
              <div
                key={item.id}
                className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-neutral-100"
              >
                <AuthenticatedMediaImage
                  src={item.preview_url}
                  alt={item.original_filename}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div
                key={item.id}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-neutral-100 bg-neutral-50 text-neutral-400"
              >
                <ImageIcon className="size-4" />
              </div>
            )
          )}
          {alert.media.length > 3 ? (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-neutral-100 bg-neutral-50 text-[11px] font-medium text-neutral-500">
              +{alert.media.length - 3}
            </div>
          ) : null}
        </div>
      ) : null}
      {location ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-faint-foreground">
          <MapPinIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">{location}</span>
        </span>
      ) : null}

      {resolved ? (
        historicalRoutes.length ? (
          <div className="mt-1.5 space-y-1 text-[11px] text-faint-foreground">
            {historicalRoutes.map((assignment) => (
              <span
                key={`past-route-${assignment.id}`}
                className="flex min-w-0 items-start gap-1"
              >
                <NavigationIcon
                  className="mt-0.5 size-3.5 shrink-0 text-neutral-400"
                  strokeWidth={1.8}
                />
                <span className="min-w-0 truncate">
                  {responderName(assignment.responder)} responded. Route taken:{" "}
                  {historicalRouteSummary(assignment.route)}.
                </span>
              </span>
            ))}
          </div>
        ) : null
      ) : routeResponder ||
        route?.distance_meters != null ||
        route?.eta_seconds != null ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-faint-foreground">
          {routeResponders.length ? (
            <span
              className="flex shrink-0 -space-x-1"
              aria-label="Responders on this route"
            >
              {routeResponders.slice(0, 3).map((responder) => (
                <UserAvatar
                  key={responder.id}
                  user={responder}
                  size="sm"
                  className="!size-5 text-[8px] ring-1 ring-white"
                  title={responder.full_name}
                />
              ))}
            </span>
          ) : null}
          <NavigationIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">
            {routeResponder
              ? `${responderStatusLabel(routeResponder, sessionUser?.id)}. `
              : ""}
            Route: {emergencyRouteSummary(alert)}.
          </span>
        </span>
      ) : null}

      <EmergencyEngagementFooter
        alert={alert}
        commentCount={commentCount}
        commentsOpen={showComments}
        onCommentsClick={() => void toggleComments()}
      />
      {showComments ? (
        <div
          className="mt-3 space-y-2.5 border-t border-neutral-100 pt-3"
          onClick={(event) => event.stopPropagation()}
        >
          {resolved ? <EmergencyResolutionBanner alert={alert} /> : null}
          {commentsLoading ? (
            <p className="text-[11px] text-faint-foreground">
              Loading comments…
            </p>
          ) : (comments?.length ?? 0) === 0 ? (
            <p className="text-[11px] text-faint-foreground">
              No comments yet.
            </p>
          ) : (
            comments?.map((comment) => (
              <div key={comment.id} className="flex items-start gap-2">
                <UserAvatar
                  user={comment.author ?? { full_name: comment.author_label || "Resident" }}
                  size="sm"
                  className="!size-7 text-[10px]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-neutral-800">
                    {comment.author_label ||
                      comment.author?.full_name ||
                      "Resident"}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">
                    {comment.body}
                  </p>
                  <CommentAttachment attachment={comment.attachment ?? null} />
                </div>
              </div>
            ))
          )}

          <CommentComposer
            compact
            value={draft}
            onChange={setDraft}
            onSubmit={submitComment}
            sessionUser={sessionUser}
            disabled={posting}
          />
        </div>
      ) : null}
    </article>
  )
}
