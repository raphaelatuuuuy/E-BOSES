import { ArrowUpIcon, ImageIcon, MessageSquareIcon, UsersIcon } from "lucide-react"

import type { RankedConcern } from "@/features/dashboard/components/record/concern-adapter"
import { concernCategoryLabel } from "@/features/dashboard/components/concerns/concern-display"
import { readableLocation, streetOnly } from "@/features/dashboard/lib/location-text"
import { QueueRow, type QueueRowStat } from "@/features/dashboard/components/workspace/queue-row"

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
  const department = concern.assigned_department
  const linkedReports = concern.community_incident?.report_count ?? 1

  const stats: QueueRowStat[] = [
    {
      key: "photos",
      icon: <ImageIcon className="size-3.5" aria-hidden />,
      label: "Photos",
      value: concern.community_incident?.photo_count ?? concern.media.length,
    },
  ]

  if (linkedReports > 1) {
    stats.push({
      key: "reports",
      icon: <UsersIcon className="size-3.5" aria-hidden />,
      label: "Reports",
      value: linkedReports,
    })
  }
  if (concern.visibility === "community") {
    stats.push({
      key: "support",
      icon: <ArrowUpIcon className="size-3.5" aria-hidden />,
      label: "Support",
      value: concern.vote_count,
    })
    if (concern.comment_count > 0) {
      stats.push({
        key: "comments",
        icon: <MessageSquareIcon className="size-3.5" aria-hidden />,
        label: "Comments",
        value: concern.comment_count,
      })
    }
  }

  return (
    <QueueRow
      typeLabel={concernCategoryLabel(concern)}
      title={concern.official_title || concern.title}
      location={streetOnly(readableLocation(concern.address, concern.barangay)) || "Location pinned on the map"}
      createdAt={concern.created_at}
      summary={concern.summary?.trim() || concern.description?.trim() || ""}
      assignedUnit={
        department
          ? { name: department.name }
          : null
      }
      stats={stats}
      active={active}
      onSelect={onSelect}
    />
  )
}
