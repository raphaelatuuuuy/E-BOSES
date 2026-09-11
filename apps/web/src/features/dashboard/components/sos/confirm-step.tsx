import { AlertTriangleIcon, PhoneIcon } from "lucide-react"

/**
 * Review + countdown ("confirm & send") step. Combined into one file since
 * countdown is just the terminal state of the same confirm/send flow.
 */
export function SosConfirmStep({
  mode,
  submitError,
  emergencySmsHref,
  onSmsFallbackClick,
  typeLabel,
  locationLabel,
  triageSummary,
  note,
  submitting,
  dispatchCountdown,
}: {
  mode: "review" | "countdown"
  submitError: string
  emergencySmsHref: string
  onSmsFallbackClick: () => void
  typeLabel?: string
  locationLabel?: string
  triageSummary?: string
  note: string
  submitting: boolean
  dispatchCountdown: number
}) {
  if (mode === "countdown") {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center px-4 text-center">
        <div className="relative flex size-36 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-sos/15" />
          <span className="absolute inset-3 rounded-full bg-sos/20" />
          <p
            className="relative text-6xl font-semibold text-sos-bright tabular-nums"
            aria-hidden="true"
          >
            {submitting ? "…" : dispatchCountdown}
          </p>
        </div>
        <p className="mt-5 text-[12px] font-bold tracking-wide text-white/55 uppercase">
          {submitting ? "Sending alert…" : "Broadcasting in"}
        </p>
        <p className="mt-2 max-w-xs text-[15px] font-medium text-white">
          Tap cancel if you sent this by accident.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {submitError ? (
        <div
          className="rounded-[18px] border border-sos/50 bg-sos/15 p-4"
          role="alert"
        >
          <p className="text-[14px] font-semibold text-sos-bright">
            Alert was not sent
          </p>
          <p className="mt-1 text-[13px] leading-5 text-sos-bright/80">
            {submitError}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-white/65">
            Check your connection and try again. Your details are still here.
          </p>
          {emergencySmsHref ? (
            <a
              href={emergencySmsHref}
              onClick={onSmsFallbackClick}
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand-orange px-3.5 text-[13px] font-bold text-white hover:bg-brand-orange-strong"
            >
              <PhoneIcon className="size-4" />
              Send Alert
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[18px] border border-white/15">
        <div className="border-b border-white/10 px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-wide text-brand-orange uppercase">
            Emergency type
          </p>
          <p className="mt-1 text-[15px] font-semibold text-white">
            {typeLabel ?? "—"}
          </p>
        </div>
        <div className="border-b border-white/10 px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-wide text-brand-orange uppercase">
            Location
          </p>
          <p className="mt-1 text-[15px] font-semibold text-white">
            {locationLabel || "—"}
          </p>
        </div>
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-semibold tracking-wide text-brand-orange uppercase">
            Situation
          </p>
          <p className="mt-1 text-[15px] font-semibold text-white">
            {triageSummary || "Not answered"}
          </p>
          {note.trim() ? (
            <p className="mt-2 text-[14px] leading-6 text-white/75">
              {note.trim()}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-[18px] border border-sos/40 bg-sos/15 px-4 py-3">
        <AlertTriangleIcon
          className="mt-0.5 size-5 shrink-0 text-sos-bright"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="text-[13px] leading-5 font-medium text-sos-bright">
          False or misleading alerts are logged and repeated abuse can suspend
          your account.
        </p>
      </div>
    </div>
  )
}
