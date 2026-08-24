import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { CameraIcon, ChevronDownIcon, ChevronUpIcon, CircleCheck, ClockIcon, CircleXIcon, HardHatIcon, ScaleIcon, SendIcon, MessageSquareIcon, UsersIcon, XIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { updateConcernStatus, type Concern } from "@/features/dashboard/api"
import { Band, Surface } from "@/features/dashboard/components/workspace/band"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import type { MediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"
import {
  slugifyStatus,
  statusLabel,
  statusOptionsFor,
  useDecisionDraft,
  type DecisionDraft,
} from "@/features/dashboard/components/concerns/use-decision-draft"

/** The sentinel value the dropdown uses for the "Custom status…" entry. */
const CUSTOM_STATUS_OPTION = "__custom__"

const statusMeta: Record<string, { icon: typeof ClockIcon; bg: string; subtext: string }> = {
  under_review: { icon: ClockIcon, bg: "bg-brand-navy", subtext: "Assigned for checking" },
  assigned: { icon: UsersIcon, bg: "bg-blue-500", subtext: "Forwarded to a unit" },
  in_progress: { icon: HardHatIcon, bg: "bg-amber-500", subtext: "Work is ongoing" },
  resolved: { icon: CircleCheck, bg: "bg-emerald-600", subtext: "Case is closed" },
  rejected: { icon: CircleXIcon, bg: "bg-red-500", subtext: "Denied by the barangay" },
  appealed: { icon: ScaleIcon, bg: "bg-purple-500", subtext: "Resident filed an appeal" },
}

function StatusDropdown({
  options,
  customOption,
  value,
  onChange,
}: {
  options: readonly string[]
  customOption: string
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const isCustom = !options.includes(value)
  const displayLabel = isCustom ? statusLabel(value) || "Custom status" : statusLabel(value)

  function select(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">            <span className="text-[11px] text-neutral-400">Status</span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="mt-1.5 flex h-11 w-full items-center gap-3 rounded-full bg-neutral-100 px-4 text-left text-[14px] text-neutral-900 outline-none"
      >
        <span className="flex-1 truncate text-[14px] text-neutral-700">{displayLabel}</span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white p-1 shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '280px', overflowY: 'auto' }}>
          {options.map((option) => {
            const meta = statusMeta[option]
            const Icon = meta?.icon
            const isSelected = value === option
            return (
              <button
                key={option}
                type="button"
                onClick={() => select(option)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] transition hover:bg-neutral-50"
              >
                {meta ? (
                  <span className={`flex size-7 shrink-0 items-center justify-center rounded-md text-white ${meta.bg}`}>
                    <Icon className="size-3.5" strokeWidth={1.7} />
                  </span>
                ) : null}
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] text-neutral-900">{statusLabel(option)}</span>
                  {meta ? <span className="block text-[11px] text-neutral-400">{meta.subtext}</span> : null}
                </span>
                {isSelected && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => select(customOption)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] transition hover:bg-neutral-50"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-neutral-700 text-white">
              <MessageSquareIcon className="size-3.5" strokeWidth={1.7} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] text-neutral-900">Custom status…</span>
              <span className="block text-[11px] text-neutral-400">Type your own label</span>
            </span>
            {isCustom && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
          </button>
        </div>
      )}
    </div>
  )
}

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
  const [previewFiles, setPreviewFiles] = useState<{ items: MediaPreviewItem[]; index: number } | null>(null)

  const statusOptions = statusOptionsFor().filter((s) => s !== "submitted")
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
      <Band label="Update the status" icon={MessageSquareIcon} collapsible>
        <div className="space-y-3">
          <StatusDropdown
            options={statusOptions}
            customOption={CUSTOM_STATUS_OPTION}
            value={selectValue}
            onChange={(next) => {
              if (next === CUSTOM_STATUS_OPTION) {
                setStatus("")
              } else {
                setStatus(next)
              }
            }}
          />

          {statusIsCustom ? (
            <label className="block">
              <span className="text-[11px] text-neutral-400">Custom status</span>
              <input
                type="text"
                value={status}
                autoFocus
                onChange={(event) => setStatus(slugifyStatus(event.target.value))}
                placeholder="e.g. schedule, awaiting parts"
                className="mt-1.5 h-11 w-full rounded-full bg-neutral-100 px-4 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
              />
              <p className="mt-1.5 text-[10px] leading-4 text-neutral-400">
                Saved as "{statusLabel(status) || "your custom status"}" and shown to the resident.
              </p>
            </label>
          ) : null}

          <label className="block">
            <span className="text-[11px] text-neutral-400">Message to the resident</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="e.g. Tanod inspected the site this morning. Repair is scheduled Friday."
              className="mt-1.5 w-full resize-none rounded-[20px] bg-neutral-100 px-4 py-3 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-neutral-400">Internal note (officials only)</span>
            <textarea
              value={internalNote}
              onChange={(event) => setInternalNote(event.target.value)}
              rows={2}
              placeholder="The resident never sees this."
              className="mt-1.5 w-full resize-none rounded-[20px] bg-neutral-100 px-4 py-3 text-[14px] text-neutral-900 outline-none placeholder:text-neutral-400"
            />
          </label>

          {status === "resolved" ? (
            <div className="rounded-[20px] bg-neutral-100 p-4">
              <p className="text-[12px] text-neutral-700">Photos of the finished work</p>
              <p className="mt-0.5 text-[10px] text-neutral-400">
                Up to 5 photos. Only the resident and barangay officials can see them.
              </p>
              {resolutionFiles.length ? (
                <div className="mt-3">
                  <div className="grid grid-cols-3 gap-2">
                    {resolutionFiles.slice(0, 3).map((file) => (
                      <div key={`${file.name}-${file.lastModified}`} className="relative aspect-square overflow-hidden rounded-[10px]">
                        <img
                          src={URL.createObjectURL(file)}
                          alt={file.name}
                          className="size-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => setResolutionFiles(resolutionFiles.filter((f) => f !== file))}
                          className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/50 text-white"
                        >
                          <XIcon className="size-2.5" />
                        </button>
                      </div>
                    ))}
                    {resolutionFiles.length > 3 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const items: MediaPreviewItem[] = resolutionFiles.map((f) => ({
                            src: URL.createObjectURL(f),
                            filename: f.name,
                            kind: "image" as const,
                          }))
                          setPreviewFiles({ items, index: 3 })
                        }}
                        className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[10px] bg-neutral-100 text-[14px] font-medium text-neutral-500"
                      >
                        <img
                          src={URL.createObjectURL(resolutionFiles[3])}
                          alt=""
                          className="absolute inset-0 size-full object-cover opacity-40"
                        />
                        <span className="relative">+{resolutionFiles.length - 3}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-full py-2.5 text-[12px] text-neutral-500 transition-colors hover:bg-neutral-100">
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
          ) : null}
          {previewFiles ? (
            <MediaLightbox
              items={previewFiles.items}
              index={previewFiles.index}
              onClose={() => setPreviewFiles(null)}
            />
          ) : null}



          <Button
            type="button"
            disabled={Boolean(busy) || !note.trim() || needsResolutionEvidence || needsFinalReason}
            onClick={() => void (isStatusSave ? saveUpdate() : postUpdate())}
            className="w-full rounded-full bg-brand-orange text-[14px] text-white hover:bg-brand-orange-strong"
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
          <p className="text-[11px] leading-4 text-neutral-400">
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
