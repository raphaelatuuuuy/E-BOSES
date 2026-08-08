import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"

import {
  createConcernAppeal,
  type Concern,
} from "@/features/dashboard/api"
import { formatEventTime } from "@/features/dashboard/components/concerns/concern-display"

/**
 * Resident-side follow-up/appeal panel (clarification replies + appeal
 * submission + appeal history). Extracted verbatim from `pages/reports.tsx`
 * where it lived inline; rendered via the `residentFollowUp` prop passed
 * into `ReportDetailsSidebar` — the prop wiring in reports.tsx is unchanged.
 */
export function ResidentFollowUpPanel({ report, onRefresh }: { report: Concern; onRefresh: () => Promise<void> }) {
const appealHistory = report.appeals ?? []
  const pendingAppeal = report.appeals?.find((item) => item.status === "submitted")
  const canAppeal = report.status === "rejected" && !pendingAppeal
  const [appealReason, setAppealReason] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  if (!canAppeal && appealHistory.length === 0 && !(report.official_remarks?.length)) return null

async function submitAppeal() {
    if (!appealReason.trim()) return
    setBusy("appeal")
    try {
      await createConcernAppeal(report.id, appealReason.trim())
      await onRefresh()
      toast.success("Appeal submitted")
      setAppealReason("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit appeal.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {report.official_remarks?.length ? (
          <div className="space-y-3">
            {report.official_remarks.map((remark) => (
              <p key={remark.id} className="rounded-lg bg-neutral-50 px-4 py-3 text-[14px] leading-6 text-neutral-700">
                {remark.body}
              </p>
            ))}
          </div>
        ) : null}
{appealHistory.length ? (
          <div className="space-y-3">
            <p className="text-[12px] font-semibold tracking-wide text-neutral-500 uppercase">Appeal history</p>
            {appealHistory.map((appeal) => (
              <div
                key={appeal.id}
                className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-[14px] leading-6 text-neutral-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-neutral-900">Appeal {appeal.status.replace("_", " ")}</span>
                  <span className="text-[13px] text-neutral-500">{formatEventTime(appeal.decided_at || appeal.created_at)}</span>
                </div>
                <p className="mt-2">{appeal.reason}</p>
                {appeal.decision_note ? <p className="mt-2 font-medium">Decision: {appeal.decision_note}</p> : null}
                {appeal.reviewed_by ? <p className="mt-1 text-[13px] text-neutral-500">Reviewed by {appeal.reviewed_by.full_name}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
{canAppeal ? (
          <div className="grid gap-3">
            <div>
              <h4 className="text-[15px] font-bold text-neutral-900">Request another review</h4>
              <p className="mt-1 text-[13px] leading-5 text-neutral-500">Explain what the barangay should reconsider. Your appeal will be added to the case timeline and reviewed by an authorized official.</p>
            </div>
            <textarea
              value={appealReason}
              onChange={(event) => setAppealReason(event.target.value)}
              placeholder="Explain why this report should be reviewed again"
              className="min-h-24 rounded-xl border border-neutral-200 px-3.5 py-3 text-[14px] text-neutral-900 outline-none focus:border-neutral-400"
            />
            <Button
              type="button"
              disabled={busy === "appeal" || !appealReason.trim()}
              onClick={() => void submitAppeal()}
              className="h-11 bg-brand-orange text-white hover:bg-brand-orange-strong"
            >
              {busy === "appeal" ? "Submitting" : "Submit appeal"}
            </Button>
          </div>
        ) : null}
    </div>
  )
}


