import { useState } from "react"
import { toast } from "sonner"
import { CameraIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  updateConcernStatus,
  type Concern,
  type ConcernStatus,
} from "@/features/dashboard/api"

/** Extracted verbatim from `pages/reports.tsx`. */

const officialStatuses: ConcernStatus[] = ["under_review", "in_progress", "resolved", "rejected"]

/**
 * Wording an official (and the resident who sees the update) can act on.
 *
 * "Official review", "Responder routed" and "Action in progress" described the
 * system's internal state machine. These describe what is happening to the
 * resident's report.
 */
const STATUS_CHOICE_LABEL: Partial<Record<ConcernStatus, string>> = {
  under_review: "We're looking into it",
  in_progress: "Work has started",
  resolved: "Done — fixed",
  rejected: "Not accepted",
}

function statusLabel(status: ConcernStatus) {
  return (
    STATUS_CHOICE_LABEL[status] ??
    status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  )
}

/**
 * Local draft state resets by remounting, not by an effect.
 *
 * The previous version watched `[report.id, report.status, report.update_text]`
 * and re-seeded three pieces of state inside an effect. That renders the panel
 * once with the previous report's draft still in the fields, then again after
 * the reset lands — visible as a flicker of the old note when switching
 * concerns, and one wasted render every time an official posts an update
 * (because `report.status` changes, re-running the effect).
 *
 * The call site keys this component by report id, so React discards the whole
 * instance and the useState initialisers run fresh. One render, no effect.
 */
export function OfficialStatusPanel({
  report,
  onUpdated,
  onRefresh,
}: {
  report: Concern
  onUpdated: (report: Concern) => void
  onRefresh?: () => Promise<void>
}) {
  const [status, setStatus] = useState<ConcernStatus>(report.status === "submitted" ? "under_review" : report.status)
  const [note, setNote] = useState(report.update_text || "")
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const next = await updateConcernStatus(report.id, {
        status,
        note,
        status_version: report.status_version,
        resolution_evidence: status === "resolved" ? resolutionFiles : undefined,
      })
      onUpdated(next)
      toast.success("Report status updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update report.")
    } finally {
      setBusy(false)
    }
  }

  function chooseResolutionFiles(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files).slice(0, 5)
    const invalid = selected.find(
      (file) => !["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024,
    )
    if (invalid) {
      toast.error(`${invalid.name}: use JPG or PNG up to 2 MB.`)
      return
    }
    setResolutionFiles(selected)
  }

  const needsResolutionEvidence =
    status === "resolved" && !(report.resolution_evidence?.length || resolutionFiles.length)
  const needsFinalReason = ["resolved", "rejected"].includes(status) && note.trim().length < 10

  return (
    <div className="rounded-xl border border-card-line bg-card-raised p-4">
      <p className="text-sm font-semibold text-brand-navy">Post an update</p>
      <p className="mt-1 text-xs font-medium text-subtle-foreground">
        The resident sees this straight away, and it is added to the report&apos;s history.
      </p>

      <div className="mt-3 space-y-2.5">
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">Where is it now?</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ConcernStatus)}
            className="mt-1 h-10 w-full rounded-lg border border-card-line-strong bg-card px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"
          >
            {officialStatuses.map((option) => (
              <option key={option} value={option}>{statusLabel(option)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-muted-foreground">What should the resident know?</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="e.g. Tanod inspected the site this morning. Repair is scheduled Friday."
            className="mt-1 w-full resize-y rounded-lg border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
          />
        </label>
        <Button type="button" disabled={busy || !note.trim() || needsResolutionEvidence || needsFinalReason} onClick={submit} className="w-full bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong">
          {busy ? "Posting…" : "Post update"}
        </Button>
      </div>
      {status === "resolved" ? (
        <div className="mt-3 rounded-xl border border-card-line-strong bg-card p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-brand-navy">Photos of the finished work</p>
              <p className="mt-1 text-[11px] font-medium text-subtle-foreground">
                Up to 5 photos. Only the resident and barangay officials can see them.
              </p>
            </div>
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-card-line-strong px-3 text-xs font-bold text-brand-navy hover:bg-card-raised">
              <CameraIcon className="size-4" />
              Choose photos
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(event) => chooseResolutionFiles(event.target.files)}
              />
            </label>
          </div>
          {resolutionFiles.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {resolutionFiles.map((file) => (
                <span key={`${file.name}-${file.lastModified}`} className="rounded-md bg-card-raised px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground">
                  {file.name}
                </span>
              ))}
              <button type="button" onClick={() => setResolutionFiles([])} className="text-[11px] font-bold text-severity-critical underline">
                Clear
              </button>
            </div>
          ) : report.resolution_evidence?.length ? (
            <p className="mt-3 text-[11px] font-bold text-status-closed-ink">
              {report.resolution_evidence.length} photo{report.resolution_evidence.length === 1 ? "" : "s"} already attached.
            </p>
          ) : (
            <p className="mt-3 text-[11px] font-bold text-severity-critical">Add at least one photo before marking this done.</p>
          )}
        </div>
      ) : null}
      {needsFinalReason ? (
        <p className="mt-2 text-[11px] font-bold text-severity-critical">Tell the resident why — at least a short sentence.</p>
      ) : null}
    </div>
  )
}
