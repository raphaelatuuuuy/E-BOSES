import { Checkbox } from "@workspace/ui/components/checkbox"

export function LifecycleMeansStep({
  confirmed,
  onSetConfirmed,
  onContinue,
  onDeleteClick,
  onClose,
}: {
  confirmed: boolean
  onSetConfirmed: (v: boolean) => void
  onContinue: () => void
  onDeleteClick: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col pt-4">
      <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">
        Deactivating your account means…
      </h2>
      <ul className="mt-5 list-disc space-y-3.5 pl-5 text-[15px] leading-relaxed text-neutral-700">
        <li>You&apos;ll lose access to reports, SOS alerts, messages, and community feed activity.</li>
        <li>Your profile becomes unsearchable and you&apos;ll be unsubscribed from notifications. Previous community posts may still appear in the feed.</li>
        <li>You will no longer access barangay events, the alerts map, or other E-Boses services for Marikina Heights.</li>
      </ul>

      <label className="mt-6 flex cursor-pointer items-start gap-3">
        <Checkbox
          checked={confirmed}
          onChange={(e) => onSetConfirmed(e.currentTarget.checked)}
          className="mt-0.5"
          aria-label="Yes, I want to deactivate my account"
        />
        <span className="text-[15px] font-medium text-neutral-900">Yes, I want to deactivate my account</span>
      </label>

      <p className="mt-3 text-[13px] leading-snug text-neutral-500">
        <span className="font-semibold text-neutral-700">Note:</span> You can restore your account by logging in again.
      </p>

      <button
        type="button"
        disabled={!confirmed}
        onClick={onContinue}
        className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white transition-colors hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
      >
        Continue with deactivation
      </button>

      <button
        type="button"
        onClick={onClose}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-full text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100"
      >
        Cancel
      </button>

      <p className="mt-6 border-t border-neutral-200 pt-5 text-[13px] leading-relaxed text-neutral-500">
        To delete your account,{" "}
        <button
          type="button"
          onClick={onDeleteClick}
          className="font-semibold text-neutral-800 underline underline-offset-2 hover:text-red-700"
        >
          click here
        </button>
        . Deleting your account cannot be undone; deleted accounts cannot be restored.
      </p>
    </div>
  )
}
