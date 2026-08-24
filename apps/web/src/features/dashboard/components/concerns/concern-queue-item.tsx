import { cn } from "@workspace/ui/lib/utils"

import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"
import { statusGroupOf, statusLabelOf } from "@/lib/status-vocabulary"

export function concernStatusAccent(status: string): { dot: string; chip: string } {
  const group = statusGroupOf(status)
  if (group === "active")
    return { dot: "bg-brand-orange", chip: "bg-severity-high-surface text-severity-high-ink" }
  if (group === "closed")
    return { dot: "bg-faint-foreground", chip: "bg-card-raised text-subtle-foreground" }
  return { dot: "bg-status-open", chip: "bg-status-open-surface text-status-open-ink" }
}

function queueTime(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return `${time} · Today`
  if (new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString())
    return `${time} · Yesterday`
  return `${time} · ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`
}

function nameParts(concern: RankedConcern["concern"]) {
  const full =
    concern.reporter_full_name?.trim() ||
    `${concern.reporter?.first_name ?? ""} ${concern.reporter?.last_name ?? ""}`.trim() ||
    "Resident"
  const words = full.split(/\s+/)
  return { first: words[0] ?? full, last: words.slice(1).join(" "), full }
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
  const { first, last, full } = nameParts(concern)
  const initials = (full.match(/\b\w/g) ?? ["R"])
    .slice(0, 2)
    .map((part) => part.toUpperCase())
    .join("")
  const accent = concernStatusAccent(concern.status)
  const photoCount = concern.community_incident?.photo_count ?? concern.media?.length ?? 0

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "block w-full border-b border-card-line px-4 py-3.5 text-left transition-colors hover:bg-card-raised",
        active && "bg-card-raised",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[11px] font-bold text-navy-muted">
          {initials}
        </span>
        <span className="min-w-0 flex-1 text-[11.5px] font-semibold leading-tight text-subtle-foreground">
          <span className="block truncate">{first}</span>
          {last ? <span className="block truncate">{last}</span> : null}
        </span>
        <svg
          viewBox="0 0 24 24"
          className="mt-1 size-3.5 shrink-0 text-faint-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M10 6 h-4 v12 h12 v-4" />
          <path d="M14 4 h6 v6 M20 4 l-9 9" />
        </svg>
      </div>

      <p className="mt-2 truncate text-[15px] font-bold leading-snug text-foreground">
        {concern.official_title || concern.title}
      </p>
      <p className="mt-0.5 text-[11px] text-subtle-foreground">{queueTime(concern.created_at)}</p>
      <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-subtle-foreground">
        {concern.summary?.trim() || concern.description?.trim() || "No description provided."}
      </p>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", accent.dot)} />
        <span className="text-[10.5px] font-bold text-foreground">
          {statusLabelOf(concern.status)}
        </span>
        <span className="text-[10.5px] text-faint-foreground">
          · {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"}` : "No photos"}
        </span>
      </div>
    </button>
  )
}
