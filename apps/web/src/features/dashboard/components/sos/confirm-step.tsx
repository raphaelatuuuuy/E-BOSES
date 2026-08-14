import { PhoneIcon } from "lucide-react"

/**
 * Review + countdown ("confirm & send") step. Combined into one file since
 * countdown is just the terminal state of the same confirm/send flow.
 */
export function SosConfirmStep({
  mode,
  isOnline,
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
  isOnline: boolean
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
            className="relative text-6xl font-semibold text-sos tabular-nums"
            aria-hidden="true"
          >
            {submitting ? "…" : dispatchCountdown}
          </p>
        </div>
        <p className="mt-5 text-[12px] font-bold tracking-wide text-white/55">
          {submitting ? "Sending alert…" : "Broadcasting in"}
        </p>
        <p className="mt-2 max-w-xs text-[15px] font-medium text-white">
          Tap cancel if you sent this by accident.
        </p>
        <div className="mt-6 w-full max-w-xs rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-[12px] text-white/70">
          <p>
            <span className="font-semibold text-white">
              {typeLabel ?? "Emergency"}
            </span>
            {" · "}
            {locationLabel || "Pinned location"}
          </p>
          <p className="mt-1 text-white/45">
            After sending, cancellation requires a reason.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!isOnline ? (
        <div
          className="rounded-xl border border-neutral-400/60 bg-neutral-500/15 p-4 text-white/90"
          role="status"
          aria-live="polite"
        >
          <p className="text-[14px] font-semibold">You’re offline</p>
          <p className="mt-1 text-[13px] leading-5 text-white/70">
            Your entries remain on this screen. Reconnect to use online
            responder routing
            {emergencySmsHref ? ", or open the SMS backup below." : "."}
          </p>
          {!emergencySmsHref ? (
            <p className="mt-2 text-[12px] leading-5 text-white/65">
              SMS backup is not configured on this device. If anyone is in
              immediate danger, call your local emergency number.
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-5 text-white/65">
              Opening SMS creates a draft only. Review it and press Send
              in your phone’s messaging app.
            </p>
          )}
        </div>
      ) : null}
      {submitError ? (
        <div
          className="rounded-xl border border-sos/50 bg-sos/15 p-4"
          role="alert"
        >
          <p className="text-[14px] font-semibold text-sos">
            Alert was not sent
          </p>
          <p className="mt-1 text-[13px] leading-5 text-sos/80">
            {submitError}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-white/65">
            Check your connection and try again. Your details are still
            here.
          </p>
          {emergencySmsHref ? (
            <a
              href={emergencySmsHref}
              onClick={onSmsFallbackClick}
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3.5 text-[13px] font-bold text-brand-navy hover:bg-white/90"
            >
              <PhoneIcon className="size-4" />
              Open SMS backup
            </a>
          ) : null}
          {emergencySmsHref ? (
            <p className="mt-2 text-[11px] leading-4 text-white/55">
              This opens your phone’s SMS app. Review the message and
              press send.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55">
          Emergency type
        </p>
        <p className="mt-1 text-[15px] font-semibold text-white">
          {typeLabel ?? "—"}
        </p>
      </div>
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55">
          Location
        </p>
        <p className="mt-1 text-[15px] font-semibold text-white">
          {locationLabel || "—"}
        </p>
      </div>
      <div className="rounded-xl border border-white/15 bg-white/10 p-4">
        <p className="text-[11px] font-semibold tracking-wide text-white/55">
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
      <div className="rounded-xl border border-neutral-400/40 bg-neutral-500/15 px-4 py-3 text-[13px] leading-5 text-white/90">
        False or misleading alerts are logged. Repeated abuse can suspend
        your account. Accidental alerts can be cancelled afterward with a
        reason.
      </div>
    </div>
  )
}
