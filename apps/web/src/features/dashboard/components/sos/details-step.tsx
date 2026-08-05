/**
 * Final optional note.
 *
 * The photo attachment was removed: on the offline path the whole report goes
 * out as an SMS, which cannot carry an image, so attaching one produced a
 * report where half the evidence silently vanished. Photos still belong on the
 * incident — responders and the resident can exchange them in the emergency
 * chat once the alert is open and there is a connection to carry them.
 */
export function SosDetailsStep({
  note,
  onNoteChange,
}: {
  note: string
  onNoteChange: (value: string) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-6 text-white/75">
        Anything else responders should know before they arrive? Landmarks, gate
        colour, floor number.
      </p>
      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Optional note, e.g. second floor, blue gate"
        rows={4}
        maxLength={300}
        className="w-full resize-none rounded-xl border border-white/15 bg-black/25 px-3.5 py-3 text-[14px] text-white outline-none placeholder:text-white/40 focus:border-brand-orange"
      />
      <p className="text-[12px] text-white/50">
        You can send photos in the chat once help is on the way.
      </p>
    </div>
  )
}
