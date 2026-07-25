import { Spinner } from "@phosphor-icons/react"

export function LifecycleDeleteConfirmStep({
  busy,
  onCancel,
  onDelete,
}: {
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col pt-6">
      <h2 className="text-[1.55rem] font-bold leading-tight tracking-tight text-neutral-900">Delete account?</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
        This will permanently delete your account and associated data. This cannot be undone. Our team will process your request within 72 hours.
      </p>
      <div className="mt-10 flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="inline-flex h-11 items-center justify-center rounded-full bg-red-600 px-6 text-[15px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {busy ? <Spinner className="size-4 animate-spin" /> : "Delete"}
        </button>
      </div>
    </div>
  )
}
