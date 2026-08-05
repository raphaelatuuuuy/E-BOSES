import { useMemo } from "react"
import { FileTextIcon, ImageIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { EmergencyChatPanel } from "@/features/dashboard/components/emergency-chat-panel"

/**
 * Communication panel. Chat-only surface — the old five-tab layout (photos,
 * activity, assigned concerns, nearby reports) has been retired. Reporter
 * evidence and the audit trail are rendered as a slim context header directly
 * above the chat instead of hiding behind a tab; cross-incident content
 * (concerns / nearby) is off this screen entirely.
 */

const dateFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const timeFormat = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })

function ChatContextHeader({ alert }: { alert: EmergencyAlert }) {
  const events = useMemo(() => {
    const out: Array<{ key: string; body: string; at: string }> = []
    for (const event of alert.status_events ?? []) {
      out.push({
        key: `status-${event.id}`,
        at: event.created_at,
        body:
          event.note ||
          `Status → ${event.status.replace(/_/g, " ")}${
            event.actor?.full_name ? ` (${event.actor.full_name})` : ""
          }`,
      })
    }
    for (const log of alert.assignment_logs ?? []) {
      out.push({
        key: `log-${log.id}`,
        at: log.created_at,
        body: log.note || `${log.action.replace(/_/g, " ")}`,
      })
    }
    return out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()).slice(-4)
  }, [alert.status_events, alert.assignment_logs])

  const media = alert.media ?? []
  if (media.length === 0 && events.length === 0) return null

  return (
    <div className="mb-3 shrink-0 space-y-2 rounded-2xl border border-card-line bg-card-raised/60 p-3">
      {media.length > 0 ? (
        <div>
          <p className="mb-1.5 text-micro uppercase tracking-wide text-subtle-foreground">
            Reporter attached
          </p>
          <div className="flex gap-2 overflow-x-auto">
            {media.map((item) => (
              <figure
                key={item.id}
                className="shrink-0 overflow-hidden rounded-xl border border-card-line bg-card"
              >
                {item.mime_type.startsWith("image/") ? (
                  <AuthenticatedMediaImage
                    src={item.preview_url}
                    alt={item.original_filename}
                    className="size-16 object-cover"
                  />
                ) : (
                  <span className="flex size-16 items-center justify-center text-subtle-foreground">
                    <ImageIcon className="size-5" />
                  </span>
                )}
              </figure>
            ))}
          </div>
        </div>
      ) : null}
      {events.length > 0 ? (
        <ul className="space-y-1">
          {events.map((row) => (
            <li
              key={row.key}
              className="flex items-start gap-2 text-body leading-5 text-muted-foreground"
            >
              <FileTextIcon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
              <span className="min-w-0 flex-1">{row.body}</span>
              <span className="shrink-0 text-micro tabular-nums text-subtle-foreground">
                {dateFormat.format(new Date(row.at))} · {timeFormat.format(new Date(row.at))}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function DispatchComms({
  alert,
  activeTeamSize,
  className,
}: {
  alert: EmergencyAlert
  activeTeamSize: number
  className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <ChatContextHeader alert={alert} />
      <EmergencyChatPanel
        alertId={alert.id}
        open
        theme="dark"
        disabled={["resolved", "cancelled"].includes(alert.status)}
        participantHint={
          activeTeamSize > 0
            ? `Resident and ${activeTeamSize} responder${activeTeamSize === 1 ? "" : "s"}`
            : "Group chat opens once an active responder is assigned"
        }
        className="min-h-0 flex-1"
      />
    </div>
  )
}
