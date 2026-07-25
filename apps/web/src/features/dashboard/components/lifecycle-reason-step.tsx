import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@workspace/ui/lib/utils"

const DEACTIVATE_REASONS = [
  "Too many emails or notifications",
  "Too many negative conversations",
  "Content not relevant to me",
  "Moved or moving",
  "Privacy concerns",
  "Duplicate or accidental account",
  "Too many ads",
  "Posts from too far away",
  "Other",
] as const

export function LifecycleReasonStep({
  reason,
  reasonOpen,
  onSetReason,
  onToggleOpen,
  onContinue,
}: {
  reason: string
  reasonOpen: boolean
  onSetReason: (r: string) => void
  onToggleOpen: () => void
  onContinue: () => void
}) {
  return (
    <div className="flex flex-col items-center pt-6">
      <div className="h-28 w-full max-w-[280px]" aria-hidden />
      <h2 className="mt-6 text-center text-[1.65rem] font-bold leading-tight tracking-tight text-neutral-900">
        We&apos;re sorry to see you go!
      </h2>
      <p className="mt-2 text-center text-[15px] text-neutral-500">
        Please tell us why you&apos;re leaving
      </p>

      <div className="relative mt-6 w-full">
        <button
          type="button"
          onClick={onToggleOpen}
          className={cn(
            "flex h-12 w-full items-center justify-between rounded-xl border bg-white px-4 text-left text-[15px] transition-colors",
            reasonOpen ? "border-neutral-800" : "border-neutral-300 hover:border-neutral-400",
            reason ? "text-neutral-900" : "text-neutral-400",
          )}
        >
          <span className="truncate">{reason || "Reason for leaving"}</span>
          <CaretDown className={cn("size-5 shrink-0 text-neutral-500 transition-transform", reasonOpen && "rotate-180")} />
        </button>

        {reasonOpen ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,360px)] overflow-y-auto rounded-2xl border border-neutral-200 bg-white py-1 shadow-[0_12px_40px_rgba(15,23,42,0.14)]">
            <p className="px-4 pb-1 pt-3 text-[13px] font-semibold text-neutral-500">
              Reasons for deactivating
            </p>
            {DEACTIVATE_REASONS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onSetReason(item)}
                className={cn(
                  "flex w-full px-4 py-3.5 text-left text-[15px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50",
                  reason === item && "bg-neutral-50",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {reason && !reasonOpen ? (
        <button
          type="button"
          onClick={onContinue}
          className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white hover:bg-[#e6732e]"
        >
          Continue
        </button>
      ) : null}
    </div>
  )
}
