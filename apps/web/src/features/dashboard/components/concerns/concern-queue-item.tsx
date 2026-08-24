import { CircleCheck, CircleX, ClockIcon, ScaleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { categoryLabels } from "@/features/dashboard/components/concerns/concern-display"
import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"

export const avatarTone = "bg-[#c5d0e6] text-[#4a5578]"

export function initialsOf(name: string) {
  return name.charAt(0)?.toUpperCase() || "R"
}

export function concernReporterName(concern: RankedConcern["concern"]) {
  const primary = concern.community_incident?.reports?.find((report) => report.is_primary)
  const fromReporter =
    concern.reporter?.full_name?.trim() ||
    (concern.reporter_full_name ?? "").trim()
  if (fromReporter && fromReporter.toLowerCase() !== "resident") return fromReporter
  const mediaNameRaw = concern.media?.find((media) => "reporter_name" in media)?.reporter_name
  const mediaName = typeof mediaNameRaw === "string" ? mediaNameRaw.trim() : ""
  return (
    primary?.reporter_name?.trim() ||
    concern.community_incident?.reports?.[0]?.reporter_name?.trim() ||
    mediaName ||
    fromReporter ||
    "Resident"
  )
}

function queueTime(iso: string) {
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

export function ConcernQueueItem({
  entry,
  active,
  onSelect,
}: {
  entry: RankedConcern
  active: boolean
  onSelect: () => void
}) {
  const { concern } = entry
  const full = concernReporterName(concern)
  const initials = concern.reporter?.initials || initialsOf(full)
  const statusGlyph =
    concern.status === "resolved"
      ? { Icon: CircleCheck, cls: "text-status-closed/90" }
      : concern.status === "rejected"
        ? { Icon: CircleX, cls: "text-status-open/80" }
        : concern.status === "appealed"
          ? { Icon: ScaleIcon, cls: "text-severity-high/80" }
          : { Icon: ClockIcon, cls: "text-navy-muted/90" }
  const StatusGlyph = statusGlyph.Icon
  const statusCls = statusGlyph.cls

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full rounded-[24px] bg-white p-4 text-left transition duration-150",
        !active && "hover:ring-1 hover:ring-card-line-strong",
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold", avatarTone)}>
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-normal leading-tight text-subtle-foreground">
            {full}
          </span>
          <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-faint-foreground">
            {concern.category_ref?.name || categoryLabels[concern.category]}
          </span>
        </span>
        <StatusGlyph className={cn("mr-1.5 size-5 shrink-0", statusCls)} />
      </div>

      <p className="mt-2.5 truncate text-[16px] font-medium leading-snug text-foreground">
        {concern.official_title || concern.title}
      </p>
      <p className="mt-1 text-[11.5px] text-faint-foreground">{queueTime(concern.created_at)}</p>
      <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-subtle-foreground">
        {concern.summary?.trim() || concern.description?.trim() || "No description provided."}
      </p>

      {concern.first_photo ? (
        <div className="mt-2.5 overflow-hidden rounded-[16px] bg-card-raised">
          <AuthenticatedMediaImage
            src={concern.first_photo}
            alt={concern.title}
            className="h-36 w-full object-cover"
          />
        </div>
      ) : null}
    </button>
  )
}
