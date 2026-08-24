import { Surface } from "@/features/dashboard/components/workspace/band"
import { RecordHeader } from "./record-header"
import { RecordSection } from "./record-section"
import { RecordWorkflow } from "./record-workflow"
import type { RecordView } from "./types"

/**
 * The three tiers, composed as one dossier.
 *
 * This used to be a stack of separate bordered cards — header, workflow, and one
 * card per collapsible section — so an incident read as a pile of boxes rather
 * than a single record. Now the tiers are bands inside one `Surface`, divided by
 * hairlines: summary at the top, the live workflow beneath it, then the
 * collapsible depth. One card, one incident.
 *
 * It still knows nothing about panels or sheets, so desktop and mobile render
 * identical children and cannot drift apart.
 */
export function RecordDetail({
  record,
  showAssignee = true,
  embedded = false,
}: {
  record: RecordView
  /** Forwarded to RecordWorkflow — see the note on its `showAssignee` prop. */
  showAssignee?: boolean
  /** Drops the surface border when the pane the dossier sits on already draws one. */
  embedded?: boolean
}) {
  return (
    <Surface className={embedded ? "rounded-none border-0 bg-transparent" : undefined}>
      <RecordHeader record={record} embedded />
      <RecordWorkflow record={record} showAssignee={showAssignee} embedded />
      {record.sections.map((section) => (
        <RecordSection key={section.key} section={section} embedded />
      ))}
    </Surface>
  )
}
