import { Spinner } from "@phosphor-icons/react"

export function LifecycleFeedbackStep({
  feedback,
  busy,
  onFeedbackChange,
  onDeactivate,
  onClose,
}: {
  feedback: string
  busy: boolean
  onFeedbackChange: (v: string) => void
  onDeactivate: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col pt-4">
      <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">One last thing</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
        Your feedback is incredibly valuable to make E-Boses better for everyone. We&apos;d love to hear any other suggestions you have for improving our platform.
      </p>
      <textarea
        value={feedback}
        onChange={(e) => onFeedbackChange(e.target.value)}
        maxLength={200}
        rows={5}
        aria-label="Optional feedback" placeholder="Optional feedback"
        className="mt-5 w-full resize-none rounded-xl border border-neutral-300 bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-500"
      />
      <button
        type="button"
        disabled={busy}
        onClick={onDeactivate}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-red-600 text-[15px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
      >
        {busy ? <><Spinner className="mr-2 size-4 animate-spin" />Deactivating…</> : "Deactivate my account"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  )
}
