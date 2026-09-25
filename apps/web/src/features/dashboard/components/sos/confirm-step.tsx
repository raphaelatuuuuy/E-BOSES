import {
  MapPinIcon,
  MessageSquareIcon,
  PencilIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type React from "react"

/**
 * Review + countdown ("confirm & send") step. Combined into one file since
 * countdown is just the terminal state of the same confirm/send flow.
 */
const SOS_COUNTDOWN_SECONDS = 5
const SOS_COUNTDOWN_RING = 2 * Math.PI * 100
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
  onEditStep,
}: {
  mode: "review" | "countdown"
  submitError: string
  emergencySmsHref: string
  onSmsFallbackClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
  typeLabel?: string
  locationLabel?: string
  triageSummary?: string
  note: string
  submitting: boolean
  dispatchCountdown: number
  onEditStep?: (step: "category" | "triage" | "location") => void
}) {
  const triageFlags = (triageSummary || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  if (mode === "countdown") {
    const progress = submitting
      ? 0
      : Math.max(dispatchCountdown, 0) / SOS_COUNTDOWN_SECONDS
    return (
      <div className="flex min-h-[min(420px,52dvh)] flex-col items-center justify-center px-4 text-center">
        <div className="relative flex size-56 items-center justify-center">
          <svg
            viewBox="0 0 224 224"
            className="absolute inset-0 size-full -rotate-90"
            aria-hidden="true"
          >
            <defs>
              <linearGradient
                id="sos-countdown-ring"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0" stopColor="#ff625a" />
                <stop offset="1" stopColor="#f23b35" />
              </linearGradient>
            </defs>
            <circle
              cx="112"
              cy="112"
              r="100"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="12"
            />
            <circle
              cx="112"
              cy="112"
              r="100"
              fill="none"
              stroke="url(#sos-countdown-ring)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={SOS_COUNTDOWN_RING}
              strokeDashoffset={SOS_COUNTDOWN_RING * (1 - progress)}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <p
            className="relative text-[84px] leading-none font-semibold text-sos-bright tabular-nums"
            aria-hidden="true"
          >
            {submitting ? "…" : dispatchCountdown}
          </p>
        </div>
        <p className="mt-5 text-[12px] font-bold tracking-wide text-white/55 uppercase">
          {submitting ? "Sending alert…" : "Broadcasting in"}
        </p>
        <p className="mt-2 max-w-xs text-[16px] font-medium text-white">
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
              className="mt-3 inline-flex h-10 items-center justify-center rounded-full bg-sos px-3.5 text-[13px] font-bold text-white hover:opacity-90"
            >
              Send SOS
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Page description */}
      <p className="text-[15px] leading-5 text-white/70 px-0.5">
        Review your SOS details and confirm before broadcasting to nearby responders.
      </p>

      {/* Timeline */}
      <div className="px-0.5 pt-4">
        <div className="relative flex gap-3 pb-[32px]">
          <span className="self-center flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <TriangleAlertIcon className="size-6" strokeWidth={2} aria-hidden="true" />
          </span>
           <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold tracking-wide text-brand-orange uppercase">
              <span>Type</span>
              {onEditStep ? (
                <button
                  type="button"
                  onClick={() => onEditStep("category")}
                  className="ml-1 inline-flex items-center justify-center text-brand-orange hover:text-white transition-colors"
                  aria-label="Edit type"
                >
                  <PencilIcon className="size-[14px]" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </p>
            <p className="mt-0.5 text-[22px] leading-snug break-words text-white">
              {typeLabel ?? "—"}
            </p>
          </div>
        </div>

        <div className="relative flex gap-3 pb-[32px]">
          <span className="self-center flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <MapPinIcon className="size-6" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold tracking-wide text-brand-orange uppercase">
              <span>Location</span>
              {onEditStep ? (
                <button
                  type="button"
                  onClick={() => onEditStep("location")}
                  className="ml-1 inline-flex items-center justify-center text-brand-orange hover:text-white transition-colors"
                  aria-label="Edit location"
                >
                  <PencilIcon className="size-[14px]" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </p>
            <p className="mt-0.5 text-[22px] leading-snug break-words text-white">
              {locationLabel || "—"}
            </p>
          </div>
        </div>

        <div className="relative flex gap-3 pb-[32px]">
          <span className="self-center flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <MessageSquareIcon
              className="size-6"
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold tracking-wide text-brand-orange uppercase">
              <span>Situation</span>
              {onEditStep ? (
                <button
                  type="button"
                  onClick={() => onEditStep("triage")}
                  className="ml-1 inline-flex items-center justify-center text-brand-orange hover:text-white transition-colors"
                  aria-label="Edit situation"
                >
                  <PencilIcon className="size-[14px]" strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </p>
            {triageFlags.length ? (
              <ul className="mt-1 space-y-1">
                {triageFlags.map((flag) => (
                  <li key={flag} className="flex items-start gap-2 text-[22px] text-white/90">
                    <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-white/60" />
                    <span className="leading-snug">{flag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-[17px] text-white/55">Not answered</p>
            )}
          </div>
        </div>
      </div>

      {/* Additional notes */}
      <div className="border-l-[3px] border-brand-orange bg-white/5 px-3.5 py-2.5">
          <p className="text-[14px] font-bold tracking-wide text-brand-orange uppercase">
              Additional notes
            </p>
            <p className="mt-0.5 text-[16px] text-white/80 italic">
          {note.trim() || "None"}
        </p>
          <p className="mt-1 text-[14px] leading-5 text-red-400">
            False or misleading alerts are logged and repeated abuse can suspend your account.
          </p>
      </div>
    </div>
  )
}
