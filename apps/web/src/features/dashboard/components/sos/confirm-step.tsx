import {
  MapPinIcon,
  MessageSquareIcon,
  PhoneIcon,
  SirenIcon,
  type LucideIcon,
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
}) {
  const summaryRows: {
    key: "category" | "triage" | "location"
    eyebrow: string
    value: string
    icon: LucideIcon
  }[] = [
    {
      key: "category",
      eyebrow: "Emergency type",
      value: typeLabel ?? "—",
      icon: SirenIcon,
    },
    {
      key: "location",
      eyebrow: "Location",
      value: locationLabel || "—",
      icon: MapPinIcon,
    },
    {
      key: "triage",
      eyebrow: "Situation",
      value: triageSummary || "Not answered",
      icon: MessageSquareIcon,
    },
  ]
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

      <div className="divide-y divide-white/10 overflow-hidden rounded-[18px] border border-white/15 bg-white/5">
        {summaryRows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 px-4 py-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(160deg,#ff8a3d_0%,#f2541b_60%,#d9480f_100%)] text-white">
              <row.icon
                className="size-[22px]"
                strokeWidth={2}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-wide text-brand-orange uppercase">
                {row.eyebrow}
              </p>
              <p className="mt-0.5 text-[16px] font-semibold break-words text-white">
                {row.value}
              </p>
            </div>
            {onEditStep ? (
              <button
                type="button"
                onClick={() => onEditStep(row.key)}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 px-3 text-[13px] font-bold text-white transition-colors hover:bg-white/15 active:scale-95"
              >
                Edit
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {note.trim() ? (
        <p className="px-1 text-[14px] leading-6 text-white/75">
          {note.trim()}
        </p>
      ) : null}
    </div>
  )
}
