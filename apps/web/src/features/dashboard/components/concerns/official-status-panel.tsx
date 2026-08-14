import { useState } from "react"
import { toast } from "sonner"
import { CameraIcon, SendIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { updateConcernStatus, type Concern } from "@/features/dashboard/api"
import { Band, Surface } from "@/features/dashboard/components/workspace/band"
import {
  slugifyStatus,
  statusLabel,
  statusOptionsFor,
  useDecisionDraft,
  type DecisionDraft,
} from "@/features/dashboard/components/concerns/use-decision-draft"

/** The sentinel value the dropdown uses for the "Custom status…" entry. */
const CUSTOM_STATUS_OPTION = "__custom__"

/**
 * Everything an official decides about a report, in one place and one save.
 *
 * The draft lives in `useDecisionDraft`, one level up, so the update form and
 * any other pane editing the same report stay in step.
 *
 * Status is a dropdown of the full lifecycle plus a "Custom status…" entry:
 * officials can type their own progress label (e.g. "Schedule") when none of
 * the fixed statuses say what is actually happening. The typed value is
 * stored as a lowercase underscore slug, like the enum values.
 */
export function OfficialStatusPanel({
  report,
  draft,
  onUpdated,
  onRefresh,
}: {
  report: Concern
  draft: DecisionDraft
  onUpdated: (report: Concern) => void
  onRefresh?: () => Promise<void>
}) {
  const {
    status, setStatus,
    note, setNote,
    internalNote, setInternalNote,
    resolutionFiles, setResolutionFiles,
  } = draft
  const [busy, setBusy] = useState("")

  const statusOptions = statusOptionsFor()
  const statusIsCustom = !statusOptions.includes(status)
  const selectValue = statusIsCustom ? CUSTOM_STATUS_OPTION : status

  const statusChanged = status !== report.status
  // "Save update" moves the report or resolves it. "Post update" only tells
  // the resident something, leaving the status where it is — the thing an
  // official could not do before without faking a status change.
  const isStatusSave = statusChanged || status === "resolved"

  const needsResolutionEvidence =
    status === "resolved" && !(report.resolution_evidence?.length || resolutionFiles.length)
  const needsFinalReason = ["resolved", "rejected"].includes(status) && note.trim().length < 10

  async function saveUpdate() {
    setBusy("update")
    try {
      const next = await updateConcernStatus(report.id, {
        status,
        note,
        status_version: report.status_version,
        resolution_evidence: status === "resolved" ? resolutionFiles : undefined,
        internal_note: internalNote.trim() || undefined,
      })
      onUpdated(next)
      setInternalNote("")
      await onRefresh?.()
      toast.success(statusChanged ? "Status updated" : "Report updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update report.")
    } finally {
      setBusy("")
    }
  }

  async function postUpdate() {
    setBusy("post")
    try {
      await updateConcernStatus(report.id, {
        status: report.status,
        note,
        status_version: report.status_version,
        internal_note: internalNote.trim() || undefined,
      })
      setNote("")
      setInternalNote("")
      await onRefresh?.()
      toast.success("Update posted to the resident")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post the update.")
    } finally {
      setBusy("")
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

  return (
    <Surface>
      {/* ── Update the resident ─────────────────────────────────────────
          One textarea, one adaptive button. Leave the status where it is and
          the button posts a progress update; change the status (or resolve)
          and it saves the change. Either way the resident sees the message in
          the timeline — an official no longer has to fake a status move just
          to say something. */}
      <Band label="Update the resident">
        <div className="space-y-2.5">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Status</span>
            <select
              value={selectValue}
              onChange={(event) => {
                const next = event.target.value
                if (next === CUSTOM_STATUS_OPTION) {
                  // Enter custom mode with an empty box — the label is typed
                  // next, not guessed from the current value.
                  setStatus("")
                } else {
                  setStatus(next)
                }
              }}
              className="mt-1 h-10 w-full rounded-lg border border-card-line-strong bg-card px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
              <option value={CUSTOM_STATUS_OPTION}>Custom status…</option>
            </select>
          </label>

          {statusIsCustom ? (
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">Custom status</span>
              <input
                type="text"
                value={status}
                autoFocus
                onChange={(event) => setStatus(slugifyStatus(event.target.value))}
                placeholder="e.g. schedule, awaiting parts"
                className="mt-1 h-10 w-full rounded-lg border border-card-line-strong bg-card px-3 text-sm font-semibold text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
              />
              <p className="mt-1.5 text-[11px] leading-4 text-subtle-foreground">
                Saved as "{statusLabel(status) || "your custom status"}" and shown to the resident.
              </p>
            </label>
          ) : null}

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Message to the resident</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="e.g. Tanod inspected the site this morning. Repair is scheduled Friday."
              className="mt-1 w-full resize-y rounded-lg border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">Internal note (officials only)</span>
            <textarea
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
              rows={2}
              placeholder="The resident never sees this."
              className="mt-1 w-full resize-y rounded-lg border border-card-line-strong bg-card px-3 py-2 text-sm font-medium text-brand-navy outline-none placeholder:text-subtle-foreground focus:border-brand-orange"
            />
          </label>

          {status === "resolved" ? (
            <div className="rounded-lg border border-card-line-strong bg-card-raised p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-brand-navy">Photos of the finished work</p>
                  <p className="mt-1 text-[11px] font-medium text-subtle-foreground">
                    Up to 5 photos. Only the resident and barangay officials can see them.
                  </p>
                </div>
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-card-line-strong px-3 text-xs font-bold text-brand-navy hover:bg-card">
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
                    <span key={`${file.name}-${file.lastModified}`} className="rounded-md bg-card px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground">
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
            <p className="text-[11px] font-bold text-severity-critical">Tell the resident why — at least a short sentence.</p>
          ) : null}

          <Button
            type="button"
            disabled={Boolean(busy) || !note.trim() || needsResolutionEvidence || needsFinalReason}
            onClick={() => void (isStatusSave ? saveUpdate() : postUpdate())}
            className="w-full bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
          >
            {busy === "update" || busy === "post" ? (
              "Saving…"
            ) : isStatusSave ? (
              "Save update"
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <SendIcon className="size-4" /> Post update
              </span>
            )}
          </Button>
          <p className="text-[11px] leading-4 text-subtle-foreground">
            {isStatusSave
              ? "This changes the report and tells the resident."
              : "Leaves the status unchanged — just posts your message to the resident."}
          </p>
        </div>
      </Band>
    </Surface>
  )
}

/**
 * The form with a draft of its own.
 *
 * For call sites that show one report and have no separate assistant panel to
 * share the draft with — the resident-side details sidebar. The Concerns
 * console does not use this: there the draft is lifted so both panes edit the
 * same values.
 */
export function OfficialStatusPanelWithDraft({
  report,
  onUpdated,
  onRefresh,
}: {
  report: Concern
  onUpdated: (report: Concern) => void
  onRefresh?: () => Promise<void>
}) {
  const draft = useDecisionDraft(report)
  return (
    <OfficialStatusPanel report={report} draft={draft} onUpdated={onUpdated} onRefresh={onRefresh} />
  )
}
