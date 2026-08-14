import { ImageIcon } from "lucide-react"

import { type TriagedAlert } from "@/features/dashboard/components/record/emergency-adapter"
import { readableLocation, unitLabel } from "@/features/dashboard/components/emergencies/lib"
import { streetOnly } from "@/features/dashboard/lib/location-text"
import { QueueRow } from "@/features/dashboard/components/workspace/queue-row"

const TYPE_LABEL: Record<string, string> = {
  medical: "Medical",
  fire: "Fire",
  crime: "Crime",
  disaster: "Disaster",
  child_protection: "Child Protection",
  domestic_violence: "Domestic Violence",
  drug_related: "Drug-Related Incident",
}

export function QueueItem({
  entry,
  active,
  onSelect,
}: {
  entry: TriagedAlert
  active: boolean

  now?: number
  onSelect: () => void
}) {
  const { alert } = entry

  const assignment =
    alert.current_assignment ?? alert.assignments[alert.assignments.length - 1] ?? null
  const typeLabel = TYPE_LABEL[alert.type] ?? alert.type.replace(/_/g, " ")

  return (
    <QueueRow
      typeLabel={typeLabel}
      title={`${typeLabel} emergency`}

      location={
        streetOnly(readableLocation(alert.display_location, alert.address, alert.barangay)) ||
        "Location pinned on the map"
      }
      createdAt={alert.created_at}

      assignedUnit={
        assignment
          ? { name: assignment.assigned_unit?.name || unitLabel(assignment.responder.responder_unit) }
          : alert.responding_unit
            ? { name: alert.responding_unit.short_name || alert.responding_unit.name }
            : null
      }
      stats={[
        {
          key: "photos",
          icon: <ImageIcon className="size-3.5" aria-hidden />,
          label: "Photos",
          value: alert.media.length,
        },
      ]}
      active={active}
      onSelect={onSelect}
    />
  )
}
