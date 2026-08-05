import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CameraIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import {
  listBarangayUnits,
  updateConcernStatus,
  type BarangayUnit,
  type Concern,
  type ConcernStatus,
} from "@/features/dashboard/api"
import { useConcernCategories } from "@/features/dashboard/lib/concern-categories"
import { AssistantRecommendation } from "@/features/dashboard/components/concerns/assistant-recommendation"

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

/** What the assistant's suggested next step implies for the status field. */
const ACTION_TO_STATUS: Record<string, ConcernStatus> = {
  accept: "under_review",
  accept_with_privacy_review: "under_review",
  manual_review: "under_review",
  request_more_information: "under_review",
  escalate_as_emergency: "in_progress",
  reject_as_irrelevant: "rejected",
}

/**
 * Everything an official decides about a report, in one place and one save.
 *
 * Category and unit used to be reachable only through separate endpoints and no
 * UI at all — routing happened once at submission and could never be corrected,
 * so a report filed under the wrong category stayed with the wrong unit. The
 * automatic review is now good at spotting exactly that, which is useless if
 * there is nowhere to act on it.
 *
 * Local draft state resets by remounting, not by an effect. The call site keys
 * this component by report id, so React discards the whole instance and the
 * useState initialisers run fresh: one render, no flicker of the previous
 * report's draft.
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
  const { categories, labelFor } = useConcernCategories()
  const [status, setStatus] = useState<ConcernStatus>(report.status === "submitted" ? "under_review" : report.status)
  const [category, setCategory] = useState(report.category_ref?.code || report.category || "")
  const [departmentId, setDepartmentId] = useState<number | "">(report.assigned_department?.id ?? "")
  const [note, setNote] = useState(report.update_text || "")
  const [internalNote, setInternalNote] = useState("")
  const [resolutionFiles, setResolutionFiles] = useState<File[]>([])
  const [appliedSuggestion, setAppliedSuggestion] = useState(false)
  const [units, setUnits] = useState<BarangayUnit[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listBarangayUnits()
      .then((next) => {
        if (!cancelled) setUnits(next.filter((unit) => unit.is_active))
      })
      // A failed unit fetch must not block posting an update — the select just
      // stays on whatever the report already has.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  function applySuggestion() {
    const ai = report.ai_assessment
    if (!ai) return
    if (ai.suggested_category) setCategory(ai.suggested_category)
    const suggestedStatus = ACTION_TO_STATUS[ai.recommended_action || ""]
    if (suggestedStatus) setStatus(suggestedStatus)
    setAppliedSuggestion(true)
    // Nothing is written here. The official reads what was filled in, edits it
    // if they disagree, and presses Save update — or navigates away and the
    // report is untouched.
    toast.info("Suggestion filled in. Review it, then press Save update.")
  }

  async function submit() {
    setBusy(true)
    try {
      const next = await updateConcernStatus(report.id, {
        status,
        note,
        status_version: report.status_version,
        resolution_evidence: status === "resolved" ? resolutionFiles : undefined,
        category: category && category !== report.category ? category : undefined,
        department_id:
          departmentId !== "" && departmentId !== report.assigned_department?.id ? departmentId : undefined,
        internal_note: internalNote.trim() || undefined,
        applied_ai_suggestion: appliedSuggestion || undefined,
      })
      onUpdated(next)
      setInternalNote("")
      await onRefresh?.()
      toast.success("Report updated")
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

  const categoryOptions = categories.length
    ? categories.map((item) => ({ value: item.code, label: item.name }))
    : [{ value: report.category, label: labelFor(report.category) }]

  return (
    <div className="space-y-3">
      <AssistantRecommendation
        report={report}
        categoryLabel={labelFor}
        onApply={applySuggestion}
        applied={appliedSuggestion}
      />

      <div className="rounded-xl border border-card-line bg-card-raised p-4">
        <p className="text-sm font-semibold text-brand-navy">Official action</p>
        <p className="mt-1 text-xs font-medium text-subtle-foreground">
          The resident sees the update you write, and it is added to the report&apos;s history.
        </p>

        <div className="mt-3 space-y-2.5">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Current status</span>
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
            <span className="text-xs font-semibold text-muted-foreground">Final category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-card-line-strong bg-card px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Assigned unit</span>
            <select
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value ? Number(event.target.value) : "")}
              className="mt-1 h-10 w-full rounded-lg border border-card-line-strong bg-card px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"
            >
              <option value="">
                {report.assigned_department ? report.assigned_department.name : "Leave to automatic routing"}
              </option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Resident update</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="e.g. Tanod inspected the site this morning. Repair is scheduled Friday."
              className="mt-1 w-full resize-y rounded-lg border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Internal note</span>
            <textarea
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
              rows={2}
              placeholder="Only officials see this."
              className="mt-1 w-full resize-y rounded-lg border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
            />
          </label>

          <Button
            type="button"
            disabled={busy || !note.trim() || needsResolutionEvidence || needsFinalReason}
            onClick={submit}
            className="w-full bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
          >
            {busy ? "Saving…" : "Save update"}
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
    </div>
  )
}
