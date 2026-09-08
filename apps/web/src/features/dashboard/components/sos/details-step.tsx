export function SosDetailsStep({
  note,
  onNoteChange,
}: {
  note: string
  onNoteChange: (value: string) => void
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
      <p className="text-[12px] text-white/50">
        Your note is included in the emergency details. SMS sends text and coordinates only.
      </p>
    </div>
  )
}
