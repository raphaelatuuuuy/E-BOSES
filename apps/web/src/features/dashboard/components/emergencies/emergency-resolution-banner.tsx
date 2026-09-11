import { BadgeCheckIcon, CheckCircle2Icon } from "lucide-react"

import type { EmergencyAlert } from "@/features/dashboard/emergency-api"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import { emergencyResponderAssignments } from "@/features/dashboard/components/emergencies/lib"
import { isEmergencyActive } from "@/features/dashboard/lib/status-vocabulary"
import { roleLabel } from "@/features/dashboard/lib/people"

const AVATAR_CLASS =
  "!size-8 !text-[13px] leading-none !bg-slate-soft !text-navy-muted"

function timeOnly(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function EmergencyResolutionBanner({
  alert,
  trunk = false,
}: {
  alert: EmergencyAlert
  trunk?: boolean
}) {
  if (isEmergencyActive(alert.status)) return null

  const closingEvent = [...(alert.status_events ?? [])]
    .filter((event) => !isEmergencyActive(event.status))
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  const assignments = emergencyResponderAssignments(alert)
  const responder =
    closingEvent?.actor ??
    [...assignments].reverse().find((item) => !isEmergencyActive(item.status))
      ?.responder ??
    [...assignments].reverse()[0]?.responder ??
    null
  const when = closingEvent?.created_at ?? alert.resolved_at
  const detail =
    closingEvent?.note?.trim() ||
    alert.resolution_report?.trim() ||
    "The incident was handled and closed."
  const name = responder?.full_name || "Barangay Hall"
  const position = responder ? roleLabel(responder) : "Barangay Official"
  const time = timeOnly(when)
  const meta = [time, position].filter(Boolean).join(" · ")

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-status-closed">
        <CheckCircle2Icon className="size-3 shrink-0" strokeWidth={2.4} />
        Resolved
      </p>

      <div className="flex items-stretch gap-2.5">
        <div className="flex w-8 shrink-0 flex-col items-center">
          <div className="relative shrink-0">
            {responder ? (
              <>
                <UserAvatar
                  user={responder}
                  size="sm"
                  className={AVATAR_CLASS}
                />
                <BadgeCheckIcon
                  aria-label="Verified responder"
                  className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-white text-brand-navy"
                  strokeWidth={2.4}
                />
              </>
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
                BH
              </span>
            )}
          </div>
          {trunk ? (
            <span aria-hidden className="mt-1.5 w-px flex-1 bg-neutral-200" />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug">
            <span className="font-semibold text-neutral-900">{name}</span>
            {meta ? <span className="text-neutral-500">· {meta}</span> : null}
          </p>
          <p className="mt-0.5 text-[14px] leading-relaxed text-neutral-900">
            {detail}
          </p>
        </div>
      </div>
    </div>
  )
}
