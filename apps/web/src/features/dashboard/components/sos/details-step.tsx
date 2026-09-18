export const SOS_MAX_FILES = 3
const SOS_ALLOWED_TYPES = ["image/png", "image/jpeg"]
const SOS_MAX_FILE_SIZE = 10 * 1024 * 1024

export function sosPhotoError(file: File, existing: File[]): string | null {
  if (!SOS_ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported format. Use JPG or PNG."
  }
  if (file.size > SOS_MAX_FILE_SIZE) {
    return "File must be 10 MB or smaller."
  }
  if (
    existing.some(
      (current) =>
        current.name === file.name &&
        current.size === file.size &&
        current.lastModified === file.lastModified
    )
  ) {
    return "This file is already selected."
  }
  if (existing.length >= SOS_MAX_FILES) {
    return `You can attach up to ${SOS_MAX_FILES} photos.`
  }
  return null
}

export function SosDetailsStep({
  note,
  onNoteChange,
}: {
  note: string
  onNoteChange: (value: string) => void
  online?: boolean
  checking?: boolean
  mediaFiles?: File[]
  mediaError?: string | null
  onAddFiles?: (files: File[]) => void
  onRemoveFile?: (index: number) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-6 text-white/70">
        Anything else responders should know before they arrive? Landmarks, gate
        colour, floor number.
      </p>
      <label htmlFor="sos-note" className="sr-only">Optional note for responders</label>
      <textarea
        id="sos-note"
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Optional note, e.g. second floor, blue gate"
        rows={4}
        maxLength={300}
        className="w-full resize-none rounded-[18px] border border-white/15 bg-black/25 px-4 py-3.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-brand-orange"
      />
    </div>
  )
}
