import { RecordHeader } from "./record-header"
import { RecordSection } from "./record-section"
import { RecordWorkflow } from "./record-workflow"
import type { RecordView } from "./types"

/**
 * The three tiers, composed.
 *
 * This component knows nothing about panels or sheets — `record-panel` and
 * `record-sheet` are pure containers around identical children. That is the
 * structural reason mobile cannot lose information: there is no second, thinner
 * mobile rendering that can drift out of sync with the desktop one.
 */
export function RecordDetail({
  record,
  showAssignee = true,
}: {
  record: RecordView
  /** Forwarded to RecordWorkflow — see the note on its `showAssignee` prop. */
  showAssignee?: boolean
}) {
  return (
    <div className="space-y-3">
      <RecordHeader record={record} />
      <RecordWorkflow record={record} showAssignee={showAssignee} />
      {record.sections.map((section) => (
        <RecordSection key={section.key} section={section} />
      ))}
    </div>
  )
}
