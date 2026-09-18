import {
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  TriangleAlertIcon,
} from "lucide-react"

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
  isOnline,
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
  onEditStep?: (step: "category" | "triage" | "location") => void
  isOnline?: boolean
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
              className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand-orange px-3.5 text-[13px] font-bold text-white hover:bg-brand-orange-strong"
            >
              <PhoneIcon className="size-4" />
              Send Alert
            </a>
          ) : null}
        </div>
      ) : null}

      {isOnline && !submitError ? (
        <div
          style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "18px", padding: "12px 16px", display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}
          role="status"
        >
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", boxShadow: "0 0 8px rgba(16,185,129,0.6)", flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: "14px", fontWeight: 700, color: "#6ee7b7" }}>Connection restored</p>
            <p style={{ fontSize: "12px", lineHeight: "1.5", color: "rgba(255,255,255,0.6)", marginTop: "2px" }}>Your alert will be sent online. Details are still here.</p>
          </div>
        </div>
      ) : null}

      {/* Timeline */}
      <div className="px-0.5 pt-1">
        <div className="relative flex gap-3 pb-[18px]">
          <span
            aria-hidden="true"
            className="absolute top-[42px] bottom-0 left-[19px] w-[2px] bg-[linear-gradient(rgba(255,106,26,0.6),rgba(255,106,26,0.08))]"
          />
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <TriangleAlertIcon className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-wide text-[#ff8a5c] uppercase">
              Type
            </p>
            <p className="mt-0.5 text-[15.5px] leading-snug font-semibold break-words text-white">
              {typeLabel ?? "—"}
            </p>
          </div>
          {onEditStep ? (
            <button
              type="button"
              onClick={() => onEditStep("category")}
              className="flex min-h-11 shrink-0 items-center justify-center self-start rounded-[10px] px-3 text-[12px] font-bold text-white transition-colors hover:bg-white/10 active:scale-95"
            >
              Change
            </button>
          ) : null}
        </div>

        <div className="relative flex gap-3 pb-[18px]">
          <span
            aria-hidden="true"
            className="absolute top-[42px] bottom-0 left-[19px] w-[2px] bg-[linear-gradient(rgba(255,106,26,0.6),rgba(255,106,26,0.08))]"
          />
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <MapPinIcon className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-wide text-[#ff8a5c] uppercase">
              Location
            </p>
            <p className="mt-0.5 text-[15.5px] leading-snug font-semibold break-words text-white">
              {locationLabel || "—"}
            </p>
          </div>
          {onEditStep ? (
            <button
              type="button"
              onClick={() => onEditStep("location")}
              className="flex min-h-11 shrink-0 items-center justify-center self-start rounded-[10px] px-3 text-[12px] font-bold text-white transition-colors hover:bg-white/10 active:scale-95"
            >
              Change
            </button>
          ) : null}
        </div>

        <div className="relative flex gap-3 pb-1">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white shadow-[0_6px_16px_rgba(242,84,27,0.4)]">
            <MessageSquareIcon
              className="size-5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold tracking-wide text-[#ff8a5c] uppercase">
              Situation
            </p>
            {triageFlags.length ? (
              <ul className="mt-1 space-y-1">
                {triageFlags.map((flag) => (
                  <li key={flag} className="flex items-start gap-2 text-[14px] text-white/90">
                    <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-white/60" />
                    <span className="leading-snug">{flag}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-[14px] text-white/55">Not answered</p>
            )}
          </div>
          {onEditStep ? (
            <button
              type="button"
              onClick={() => onEditStep("triage")}
              className="flex min-h-11 shrink-0 items-center justify-center self-start rounded-[10px] px-3 text-[12px] font-bold text-white transition-colors hover:bg-white/10 active:scale-95"
            >
              Change
            </button>
          ) : null}
        </div>
      </div>

      {/* Additional notes */}
      <div className="rounded-r-[14px] border-l-[3px] border-brand-orange bg-white/5 px-3.5 py-2.5">
        <p className="text-[11px] font-bold tracking-wide text-[#ff8a5c] uppercase">
          Additional notes
        </p>
        <p className="mt-0.5 text-[13.5px] text-white/80 italic">
          {note.trim() || "None"}
        </p>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-red-300/90" strokeWidth={2} aria-hidden="true" />
        <p className="text-[12px] leading-5 text-red-300/90">
          False or misleading alerts are logged and repeated abuse can suspend your account.
        </p>
      </div>
    </div>
  )
}
