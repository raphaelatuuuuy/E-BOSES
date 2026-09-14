import { useEffect, useMemo, useRef, useState } from "react"
import { CameraIcon, ImageIcon, XIcon } from "lucide-react"

import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { toMediaPreviewItem } from "@/features/dashboard/lib/authenticated-media"

export const SOS_MAX_FILES = 3
const SOS_ALLOWED_TYPES = ["image/png", "image/jpeg"]
const SOS_ACCEPT_STRING = ".png,.jpg,.jpeg,image/png,image/jpeg"
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
  online,
  checking,
  mediaFiles,
  mediaError,
  onAddFiles,
  onRemoveFile,
}: {
  note: string
  onNoteChange: (value: string) => void
  online: boolean
  checking?: boolean
  mediaFiles: File[]
  mediaError: string | null
  onAddFiles: (files: File[]) => void
  onRemoveFile: (index: number) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const previewUrls = useMemo(
    () => mediaFiles.map((file) => URL.createObjectURL(file)),
    [mediaFiles]
  )

  useEffect(
    () => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)),
    [previewUrls]
  )

  const maxed = mediaFiles.length >= SOS_MAX_FILES

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

      {online ? (
        <div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={SOS_ACCEPT_STRING}
              multiple
              aria-label="Add SOS photos"
              className="hidden"
              tabIndex={-1}
              hidden
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              aria-label="Take an SOS photo"
              className="hidden"
              tabIndex={-1}
              hidden
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []))
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={maxed || checking}
              className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full border border-dashed border-white/30 bg-white/[0.06] text-[14px] font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <ImageIcon className="size-5" strokeWidth={2} aria-hidden="true" />
              {checking ? "Checking…" : "Add photo"}
            </button>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={maxed || checking}
              aria-label="Take photo"
              className="flex size-[52px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/30 bg-white/[0.06] text-white transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              <CameraIcon className="size-5" strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
          {mediaFiles.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2.5">
              {mediaFiles.map((file, index) => (
                <div
                  key={`${file.name}-${file.lastModified}`}
                  className="relative h-20 w-20 overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15"
                >
                  <button
                    type="button"
                    className="block h-full w-full"
                    onClick={() => setPreviewIndex(index)}
                    aria-label={`Preview ${file.name}`}
                  >
                    <img
                      src={previewUrls[index]}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(index)}
                    className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                    aria-label="Remove photo"
                  >
                    <XIcon className="size-3.5" strokeWidth={2.25} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {mediaError ? (
            <p className="mt-2 text-[13px] font-medium text-sos-bright" role="alert">
              {mediaError}
            </p>
          ) : null}
        </div>
      ) : null}

      {previewIndex != null && previewUrls[previewIndex] ? (
        <MediaLightbox
          items={mediaFiles.map((file, index) =>
            toMediaPreviewItem(previewUrls[index] ?? "", file.name, file.type)
          )}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </div>
  )
}
