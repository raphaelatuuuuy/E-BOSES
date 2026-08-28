import { useState } from "react"
import { toast } from "sonner"
import { ArrowUpIcon, MapPinIcon, MessageCircleIcon, SignalIcon, TriangleAlert } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  addEmergencyCommunityComment,
  listEmergencyCommunityComments,
  type EmergencyAlert,
  type EmergencyCommunityComment,
} from "@/features/dashboard/emergency-api"
import { avatarTone } from "@/features/dashboard/components/concerns/concern-queue-item"
import { readableLocation, streetOnly } from "@/features/dashboard/lib/location-text"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"

const TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
}

function typeLabelOf(type: string) {
  return TYPE_LABEL[type] ?? (type || "Emergency").replace(/_/g, " ")
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
  if (date.toDateString() === now.toDateString()) return `Today at ${formatter.format(date)}`
  if (new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString())
    return `Yesterday at ${formatter.format(date)}`
  return formatter.format(date)
}

export function EmergencyQueueItem({
  alert,
  active,
  onSelect,
}: {
  alert: EmergencyAlert
  active: boolean
  onSelect: () => void
}) {
  const live = isEmergencyActive(alert.status)
  const assignments = alert.assignments ?? []
  const unit =
    alert.responding_unit ??
    alert.current_assignment?.assigned_unit ??
    assignments.find((assignment) => assignment.assigned_unit)?.assigned_unit ??
    null
  const reporterName =
    alert.reporter_display?.trim() || alert.reporter?.full_name?.trim() || "Unknown reporter"
  const onScene = Array.from(
    new Map(
      assignments
        .filter((assignment) =>
          ["acknowledged", "en_route", "arrived", "assisting"].includes(assignment.status),
        )
        .map((assignment) => [assignment.responder.id, assignment.responder]),
    ).values(),
  )
  const location = readableLocation(
    alert.display_location,
    alert.resolved_location,
    alert.address,
    alert.reported_area,
    alert.barangay,
  )

  const street = streetOnly(location)

  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState<EmergencyCommunityComment[] | null>(null)
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

  async function submitComment() {
    const body = draft.trim()
    if (!body || posting) return
    setPosting(true)
    try {
      await addEmergencyCommunityComment(alert.id, body)
      setDraft("")
      await loadComments()
    } catch {
      toast.error("Could not post the comment.")
    } finally {
      setPosting(false)
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={typeLabelOf(alert.type)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "flex w-full cursor-pointer flex-col rounded-[24px] bg-white p-4 text-left ring-1 transition duration-150",
        active ? "ring-neutral-300" : "ring-neutral-200 hover:ring-neutral-300",

      )}
      style={
        live
          ? {
              backgroundImage:
                "radial-gradient(115% 130% at 100% 0%, var(--color-severity-critical-surface), #ffffff 68%)",
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold", avatarTone)}>
          {reporterName.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-normal leading-tight text-subtle-foreground">
            {reporterName}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-faint-foreground">
            {typeLabelOf(alert.type)}
          </span>
        </span>
        <span
          className="mr-1.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-[#d62018]"
          title="Critical priority"
        >
          <SignalIcon className="size-3.5 shrink-0" strokeWidth={2} />
          Critical
          <TriangleAlert
            className={cn("size-5 shrink-0", live ? "text-sos" : "text-navy-muted/90")}
            strokeWidth={live ? 2 : 1.8}
          />
        </span>
      </div>

      <p className="mt-2.5 text-[16px] font-medium leading-snug text-foreground">
        {street
          ? `${typeLabelOf(alert.type)} emergency around ${street}`
          : `${typeLabelOf(alert.type)} emergency`}
      </p>

      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-faint-foreground">
        <span className="shrink-0">{alertTime(alert.created_at)}</span>
        <span aria-hidden className="text-neutral-300">·</span>
        <span className="min-w-0 truncate">
          {unit ? `Assigned to ${unit.short_name || unit.name}` : "Awaiting dispatch"}
        </span>
      </div>

      <div className="mt-1.5 border-t border-neutral-100" />
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-subtle-foreground">
        {alert.note?.trim() ||
          (live
            ? `${typeLabelOf(alert.type)} reported at ${location || alert.barangay}, routed to ${unit ? unit.short_name || unit.name : "dispatch"}.`
            : `${typeLabelOf(alert.type)} reported at ${location || alert.barangay}, no longer active.`)}
      </p>
      {location ? (
        <span className="mt-1.5 flex min-w-0 items-center gap-1 text-[11px] text-faint-foreground">
          <MapPinIcon className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">{location}</span>
        </span>
      ) : null}

      <div className="mt-3 border-t border-neutral-100 pt-2.5">
        <div className="flex items-center justify-between gap-3">
          {onScene.length ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="flex -space-x-1.5">
                {onScene.slice(0, 3).map((responder) => (
                  <span
                    key={responder.id}
                    title={responder.full_name}
                    className="flex size-5 items-center justify-center rounded-full bg-slate-soft text-[8px] font-semibold text-navy-muted ring-1 ring-white"
                  >
                    {(responder.initials || responder.full_name || "R").charAt(0).toUpperCase()}
                  </span>
                ))}
                {onScene.length > 3 ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100 text-[8px] font-semibold text-neutral-500 ring-1 ring-white">
                    +{onScene.length - 3}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[10px] font-normal text-faint-foreground">
                Responder on scene
              </span>
            </span>
          ) : (
            <span className="text-[10px] font-normal text-faint-foreground">No responder yet</span>
          )}
          {alert.is_public ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                void toggleComments()
              }}
              aria-label={showComments ? "Hide comments" : "See comments"}
              className={cn(
                "flex shrink-0 items-center gap-1 text-[11px] font-medium transition-colors",
                showComments ? "text-neutral-800" : "text-neutral-500 hover:text-neutral-800",
              )}
            >
              <MessageCircleIcon className="size-3.5" strokeWidth={2} />
              <span>{commentCount}</span>
            </button>
          ) : null}
        </div>

        {showComments ? (
          <div className="mt-3 space-y-2.5" onClick={(event) => event.stopPropagation()}>
            {commentsLoading ? (
              <p className="text-[11px] text-faint-foreground">Loading comments…</p>
            ) : (comments?.length ?? 0) === 0 ? (
              <p className="text-[11px] text-faint-foreground">No comments yet.</p>
            ) : (
              comments?.map((comment) => (
                <div key={comment.id} className="flex items-start gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[10px] font-bold text-navy-muted">
                    {(comment.author_label || comment.author?.full_name || "R").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-neutral-800">
                      {comment.author_label || comment.author?.full_name || "Resident"}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-700">{comment.body}</p>
                  </div>
                </div>
              ))
            )}

            <div className="flex items-center gap-2 rounded-full bg-neutral-100 py-1 pl-3 pr-1">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submitComment()
                  }
                }}
                placeholder="Add a comment"
                className="h-8 min-w-0 flex-1 bg-transparent text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400"
              />
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={posting || !draft.trim()}
                aria-label="Post comment"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                  draft.trim() ? "bg-neutral-900 text-white" : "bg-neutral-200 text-neutral-400",
                )}
              >
                <ArrowUpIcon className="size-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
