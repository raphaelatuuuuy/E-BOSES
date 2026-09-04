import { useEffect, useMemo, useState, type ChangeEvent } from "react"
import { CameraIcon, LoaderCircleIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import {
  SheetDialog,
  SheetPrimaryButton,
  SheetSecondaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import {
  resolveEmergency,
  type EmergencyAlert,
} from "@/features/dashboard/emergency-api"

export function EmergencyResolutionSheet({
  alert,
  open,
  onClose,
  onResolved,
}: {
  alert: EmergencyAlert
  open: boolean
  onClose: () => void
  onResolved: (next: EmergencyAlert) => void
}) {
  const [note, setNote] = useState("")
  const [internalNote, setInternalNote] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files]
  )

  useEffect(
    () => () => {
      previews.forEach(({ url }) => URL.revokeObjectURL(url))
    },
    [previews]
  )

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    const invalid = selected.find(
      (file) =>
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size > 2 * 1024 * 1024
    )
    if (invalid) {
      toast.error(`${invalid.name}: use JPG or PNG up to 2 MB.`)
      event.target.value = ""
      return
    }
    setFiles((current) => [...current, ...selected].slice(0, 5))
    event.target.value = ""
  }

  async function submit() {
    const trimmed = note.trim()
    if (trimmed.length < 3 && files.length === 0) {
      toast.error("Add a short resolution note or at least one photo.")
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append("note", trimmed)
      form.append("internal_note", internalNote.trim())
      form.append("status_version", String(alert.status_version))
      files.forEach((file) =>
        form.append("resolution_evidence", file, file.name)
      )
      const next = await resolveEmergency(alert.id, form)
      onResolved(next)
      setNote("")
      setInternalNote("")
      setFiles([])
      onClose()
      toast.success("Incident resolved")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not resolve incident."
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Resolve incident"
      description="Confirm the response and record what the resident should know."
      size="wide"
      className="max-h-[min(860px,94dvh)]"
      bodyClassName="space-y-4 pt-1"
    >
      <label className="block">
        <span className="text-[13px] font-normal text-neutral-500">
          Resolution details
        </span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="e.g. Fire contained and the area is safe."
          className="mt-1.5 w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
        />
      </label>

      <label className="block">
        <span className="text-[13px] font-normal text-neutral-500">
          Internal note (officials only)
        </span>
        <textarea
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Private note for the response team."
          className="mt-1.5 w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
        />
      </label>

      <div className="rounded-[14px] border-[1.5px] border-neutral-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-normal text-neutral-500">
            Response evidence
          </span>
          <span className="text-[12px] text-neutral-500">{files.length}/5</span>
        </div>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-full py-2.5 text-[12px] text-neutral-500 transition-colors hover:bg-neutral-100">
          <CameraIcon className="size-4" />
          Choose photos
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="hidden"
            onChange={addFiles}
          />
        </label>
        {files.length ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="relative aspect-square overflow-hidden rounded-[12px] bg-neutral-100"
              >
                <img
                  src={previews[index]?.url}
                  alt={file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                  aria-label={`Remove ${file.name}`}
                  className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-sm"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <p className="mt-2 text-[12px] text-neutral-400">
          Add up to 5 photos from the completed response. Visible to the
          resident and barangay officials.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <SheetSecondaryButton
          onClick={onClose}
          className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]"
        >
          Cancel
        </SheetSecondaryButton>
        <SheetPrimaryButton
          tone="accent"
          onClick={() => void submit()}
          disabled={busy}
          className="flex-1 text-[15px]"
        >
          {busy ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            "Resolve incident"
          )}
        </SheetPrimaryButton>
      </div>
    </SheetDialog>
  )
}
