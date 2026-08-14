import type { ReactNode } from "react"
import { ClockIcon, MapPinIcon, UsersIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export interface QueueRowStat {
  key: string
  icon: ReactNode
  label: string
  value: ReactNode
}

export interface QueueRowProps {

  typeLabel?: string

  title: string
  location: string

  createdAt: string

  assignedUnit: { name: string } | null

  summary?: string

  stats?: QueueRowStat[]
  active: boolean
  onSelect: () => void
}

export interface QueueTableHeaderLabels {
  title: string

  unitAndTime: string
}

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_10.5rem] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-3.5"

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function fullStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function QueueTableHeader({ labels }: { labels: QueueTableHeaderLabels }) {
  return (
    <div aria-hidden className={cn(ROW_GRID, "border-b border-card-line bg-canvas py-1.5")}>
      <span className="truncate text-micro font-bold text-subtle-foreground">
        {labels.title}
      </span>
      <span className="truncate text-micro font-bold text-subtle-foreground">
        {labels.unitAndTime}
      </span>
    </div>
  )
}

export function QueueRow({
  typeLabel,
  title,
  location,
  createdAt,
  assignedUnit,
  summary,
  stats = [],
  active,
  onSelect,
}: QueueRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn(
        ROW_GRID,
        "relative w-full border-b border-card-line text-left transition-colors duration-[--duration-micro] last:border-b-0",
        active
          ? "bg-tint before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand-orange before:content-['']"
          : "bg-card even:bg-card-raised/45 hover:bg-card-raised",
      )}
    >
      <div className="min-w-0">
        <div className="min-w-0">
          {typeLabel ? (
            <p className="truncate text-micro font-bold text-muted-foreground">{typeLabel}</p>
          ) : null}
          <p className="truncate text-sm font-bold leading-tight text-foreground">{title}</p>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPinIcon className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
            <span className="truncate font-medium text-foreground">{location}</span>
          </span>
        </div>

        {summary ? (
          <div className="mt-2">
            <p className="text-micro font-bold text-subtle-foreground">Summary</p>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground">{summary}</p>
          </div>
        ) : null}

        {stats.length ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {stats
              .filter((stat) => stat.value !== 0)
              .map((stat) => (
                <span key={stat.key} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <span className="text-subtle-foreground">{stat.icon}</span>
                  <span className="font-medium">{stat.label}</span>
                  <span className="font-bold tabular-nums text-foreground">{stat.value}</span>
                </span>
              ))}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <UsersIcon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
          <span
            className={cn(
              "min-w-0 break-words leading-snug",
              assignedUnit ? "text-foreground" : "text-severity-critical",
            )}
          >
            {assignedUnit ? assignedUnit.name : "Unassigned"}
          </span>
        </div>
        <span className="mt-1 inline-flex items-center gap-1.5 tabular-nums text-[12px] text-muted-foreground">
          <ClockIcon className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
          <span className="block truncate">
            {relativeTime(createdAt)}
            <span className="block truncate text-subtle-foreground">{fullStamp(createdAt)}</span>
          </span>
        </span>
      </div>
    </button>
  )
}
