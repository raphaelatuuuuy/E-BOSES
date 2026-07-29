import { useRef } from "react"
import { CameraIcon } from "lucide-react"

export function SosDetailsStep({
  note,
  onNoteChange,
  mediaFiles,
  mediaError,
  onMediaSelect,
  onClearMedia,
}: {
  note: string
  onNoteChange: (value: string) => void
  mediaFiles: File[]
  mediaError?: string
  onMediaSelect: (files: FileList | null) => void
  onClearMedia: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-6 text-white/75">
        A photo or note helps responders prepare.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => onMediaSelect(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 text-[14px] font-semibold text-white hover:bg-white/15"
      >
        <CameraIcon className="size-4" />
        {mediaFiles.length
          ? `${mediaFiles.length} photo(s) selected`
          : "Add photo"}
      </button>
      {mediaFiles.length ? (
        <div className="flex flex-wrap gap-2">
          {mediaFiles.map((file) => (
            <span
              key={file.name}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[12px] font-medium text-white/90"
            >
              {file.name}
            </span>
          ))}
          <button
            type="button"
            onClick={onClearMedia}
            className="text-[12px] font-semibold text-white/60 underline"
          >
            Clear
          </button>
        </div>
      ) : null}
      {mediaError ? (
        <p className="text-[13px] font-medium text-red-300" role="alert">
          {mediaError}
        </p>
      ) : null}
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Quick note for responders"
        rows={4}
        className="w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3.5 py-3 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-brand-orange"
      />
    </div>
  )
}
