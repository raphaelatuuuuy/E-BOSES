import { useEffect, useMemo, useRef, useState } from "react"
import { ImagePlusIcon, XIcon } from "lucide-react"

const MAX_PHOTO_BYTES = 8 * 1024 * 1024

export function SosDetailsStep({
  note,
  onNoteChange,
  photo,
  onPhotoChange,
  online,
}: {
  note: string
  onNoteChange: (value: string) => void
  photo: File | null
  onPhotoChange: (file: File | null) => void
  online: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState("")

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : ""), [photo])

  useEffect(() => {
    if (!preview) return
    return () => URL.revokeObjectURL(preview)
  }, [preview])

  const offlineWithPhoto = !online && photo !== null
  useEffect(() => {
    if (offlineWithPhoto) onPhotoChange(null)
  }, [offlineWithPhoto, onPhotoChange])

  function choose(file: File | null) {
    setError("")
    if (!file) {
      onPhotoChange(null)
      return
    }
    if (!file.type.startsWith("image/")) {
      setError("Choose a photo file.")
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("That photo is larger than 8MB. Choose a smaller one.")
      return
    }
    onPhotoChange(file)
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-6 text-white/70">
        Anything else responders should know before they arrive? Landmarks, gate
        colour, floor number.
      </p>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Optional note, e.g. second floor, blue gate"
        rows={4}
        maxLength={300}
        className="w-full resize-none rounded-[18px] border border-white/15 bg-black/25 px-4 py-3.5 text-[16px] text-white outline-none placeholder:text-white/40 focus:border-brand-orange"
      />

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => choose(event.target.files?.[0] ?? null)}
        />
        {preview ? (
          <div className="relative overflow-hidden rounded-[18px] border border-white/15">
            <img src={preview} alt="" className="max-h-44 w-full object-cover" />
            <button
              type="button"
              onClick={() => choose(null)}
              aria-label="Remove photo"
              className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!online}
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-[18px] border border-dashed border-white/25 py-3.5 text-[14px] font-semibold text-white/75 transition-colors hover:border-white/40 hover:text-white disabled:opacity-45"
          >
            <ImagePlusIcon className="size-4" />
            Add a photo
          </button>
        )}
      </div>

      {error ? <p className="text-[12px] text-sos-bright">{error}</p> : null}
      {offlineWithPhoto ? (
        <p className="text-[12px] text-sos-bright">
          Photos cannot be sent while offline. Your note will still go out by text.
        </p>
      ) : null}

      <p className="text-[12px] text-white/50">
        {online
          ? "Your note and photo open the emergency chat so responders see them straight away."
          : "You are offline. The alert will be sent by text, which cannot carry a photo."}
      </p>
    </div>
  )
}
