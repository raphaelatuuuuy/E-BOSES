import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileImageIcon,
  GavelIcon,
  HelpCircleIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  UserRoundCheckIcon,
  UserRoundXIcon,
  VideoIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { ConcernConversationItem, ConcernStatus, PublicUser } from "@/features/dashboard/api"
import { AuthenticatedMediaImage, openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"

function formatConversationTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function roleLabel(user?: PublicUser | null) {
  if (!user) return "System"
  if (user.role === "resident") return "Resident"
  if (user.role === "barangay_official") return "Official"
  if (user.role === "first_responder") return "Responder"
  return user.role?.replace(/_/g, " ") || "User"
}

function metadataString(item: ConcernConversationItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === "string" ? value : ""
}

function statusText(value: string) {
  if (value === "under_review") return "Official review"
  if (value === "assigned") return "Responder routed"
  if (value === "in_progress") return "Action in progress"
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function itemPresentation(item: ConcernConversationItem) {
  const phase = metadataString(item, "phase")
  if (item.kind === "chat") return { label: "Message", Icon: MessageCircleIcon, tone: "bg-blue-50 text-blue-700" }
  if (item.kind === "assignment") {
    const closed = phase === "cancelled" || phase === "completed"
    return {
      label: phase === "completed" ? "Assignment completed" : phase === "cancelled" ? "Assignment ended" : "Responder assigned",
      Icon: closed ? UserRoundXIcon : UserRoundCheckIcon,
      tone: closed ? "bg-neutral-100 text-neutral-600" : "bg-cyan-50 text-cyan-700",
    }
  }
  if (item.kind === "clarification") {
    return {
      label: phase === "reply" ? "Clarification answered" : "Clarification requested",
      Icon: HelpCircleIcon,
      tone: "bg-amber-50 text-amber-700",
    }
  }
  if (item.kind === "official_remark") return { label: "Official update", Icon: ShieldCheckIcon, tone: "bg-indigo-50 text-indigo-700" }
  if (item.kind === "appeal") {
    return {
      label: phase === "decision" ? `Appeal ${item.status || "decided"}` : "Appeal submitted",
      Icon: GavelIcon,
      tone: "bg-violet-50 text-violet-700",
    }
  }
  const isResolved = item.status === "resolved"
  const isRejected = item.status === "rejected"
  return {
    label: item.status ? statusText(item.status) : "Status updated",
    Icon: isResolved ? CheckCircle2Icon : isRejected ? AlertCircleIcon : ShieldCheckIcon,
    tone: isResolved
      ? "bg-emerald-50 text-emerald-700"
      : isRejected
        ? "bg-red-50 text-red-700"
        : "bg-neutral-100 text-neutral-700",
  }
}

export function ConcernConversation({
  items,
  onStatusClick,
  className,
}: {
  items: ConcernConversationItem[]
  onStatusClick?: (status: ConcernStatus) => void
  className?: string
}) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-5 py-8 text-center", className)}>
        <MessageCircleIcon className="mx-auto size-6 text-neutral-400" />
        <p className="mt-2 text-sm font-semibold text-neutral-700">No case activity yet</p>
        <p className="mt-1 text-xs leading-5 text-neutral-500">Messages and official progress will appear here.</p>
      </div>
    )
  }

  return (
    <div className={cn("rounded-xl border border-neutral-200 bg-white px-4 py-5 sm:px-5", className)}>
      <ol className="space-y-0" aria-label="Case conversation, oldest to newest">
        {items.map((item, index) => {
          const { label, Icon, tone } = itemPresentation(item)
          const isLast = index === items.length - 1
          const actorName = item.actor?.full_name || "E-Boses"
          const clickableStatus = item.kind === "status" && Boolean(item.status) && Boolean(onStatusClick)
          return (
            <li key={item.id} className="relative flex gap-3 sm:gap-4">
              <div className="flex shrink-0 flex-col items-center">
                <span className={cn("flex size-9 items-center justify-center rounded-lg", tone)}>
                  <Icon className="size-4" strokeWidth={2.1} />
                </span>
                {!isLast ? <span className="my-1 min-h-6 w-px flex-1 bg-neutral-200" /> : null}
              </div>
              <div className={cn("min-w-0 flex-1", !isLast && "pb-5")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    disabled={!clickableStatus}
                    onClick={() => {
                      if (clickableStatus) onStatusClick?.(item.status as ConcernStatus)
                    }}
                    className={cn(
                      "text-left text-[14px] font-bold text-neutral-900",
                      clickableStatus && "underline-offset-2 hover:text-[#ff6a1a] hover:underline",
                    )}
                  >
                    {label}
                  </button>
                  {item.visibility === "official" ? <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600">Internal</span> : null}
                  {item.status && item.kind !== "status" ? (
                    <span className="rounded-md border border-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600">{statusText(item.status)}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] text-neutral-500">
                  <span className="font-semibold text-neutral-700">{actorName}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{roleLabel(item.actor)}</span>
                  <span aria-hidden="true"> · </span>
                  <time dateTime={item.created_at}>{formatConversationTime(item.created_at)}</time>
                </p>
                {item.body ? <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-neutral-700">{item.body}</p> : null}
                {item.attachments.length ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {item.attachments.map((attachment) => (
                      <div key={attachment.id} className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
                        {attachment.kind === "image" ? (
                          <button type="button" onClick={() => void openAuthenticatedMedia(attachment.raw_url, attachment.original_filename)} className="block w-full text-left">
                            <AuthenticatedMediaImage src={attachment.raw_url} alt={attachment.original_filename} className="max-h-48 w-full object-cover" />
                          </button>
                        ) : (
                          <button type="button" onClick={() => void openAuthenticatedMedia(attachment.raw_url, attachment.original_filename)} className="flex min-h-24 w-full items-center justify-center gap-2 px-3 text-xs font-bold text-neutral-700 hover:bg-white">
                            <VideoIcon className="size-5" /> Open video
                          </button>
                        )}
                        <div className="flex items-start gap-2 px-3 py-2">
                          {attachment.kind === "image" ? <FileImageIcon className="mt-0.5 size-3.5 shrink-0" /> : <VideoIcon className="mt-0.5 size-3.5 shrink-0" />}
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold text-neutral-700">{attachment.original_filename}</p>
                            <p className="mt-0.5 text-[10px] leading-4 text-neutral-500">
                              {attachment.authenticity_status === "clear"
                                ? "No obvious edit detected"
                                : attachment.authenticity_status === "flagged"
                                  ? "Potential editing signals · manual review needed"
                                  : "Authenticity review required"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
