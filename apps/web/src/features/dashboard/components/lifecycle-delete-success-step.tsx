export function LifecycleDeleteSuccessStep({
  onClose,
}: {
  onClose: () => void
}) {
  return (
    <div className="flex flex-col pt-10">
      <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-neutral-900">
        Account deletion request successful
      </h2>
      <p className="mt-4 text-[15px] leading-relaxed text-neutral-600">
        We&apos;ve received your request to delete your account and will process your request within 72 hours.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-10 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e]"
      >
        Done
      </button>
    </div>
  )
}
