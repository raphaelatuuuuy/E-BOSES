import { createPortal } from "react-dom"
import { PhoneCallIcon, XIcon } from "lucide-react"

export interface Hotline {
  label: string
  number: string
}

export interface DutyHours {
  within_duty_hours: boolean
  start: string | null
  end: string | null
}

/**
 * Shown when the resident taps SOS outside barangay duty hours.
 *
 * It advises, it does not block. A phone call to city rescue is genuinely
 * faster at 2am than an app dispatch to an off-duty barangay unit, so the
 * hotlines come first — but "Send SOS anyway" is always there, because an
 * emergency the app refuses to accept is an emergency nobody hears about.
 */
export function DutyHoursDialog({
  open,
  hotlines,
  dutyHours,
  onSendAnyway,
  onClose,
}: {
  open: boolean
  hotlines: Hotline[]
  dutyHours: DutyHours | null
  onSendAnyway: () => void
  onClose: () => void
}) {
  if (typeof document === "undefined" || !open) return null

  const window_ =
    dutyHours?.start && dutyHours?.end
      ? `Barangay responders are on duty ${dutyHours.start} to ${dutyHours.end}.`
      : "Barangay responders are off duty right now."

  return createPortal(
    <div className="fixed inset-0 z-[240] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duty-hours-title"
        className="z-10 w-full max-w-md rounded-t-3xl border border-amber-400/30 bg-brand-navy p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-white shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="duty-hours-title" className="text-[17px] font-bold text-amber-300">
            Outside barangay duty hours
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/70 hover:bg-white/10"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <p className="mt-2 text-[14px] leading-6 text-white/80">
          {window_} For the fastest help right now, please call one of these
          directly.
        </p>

        <div className="mt-4 grid gap-2">
          {hotlines.map((hotline) => (
            <a
              key={`${hotline.label}-${hotline.number}`}
              href={`tel:${hotline.number.replace(/[^\d+]/g, "")}`}
              className="flex min-h-[3.25rem] items-center justify-between gap-3 rounded-2xl border border-white/20 bg-white/10 px-4 text-white hover:bg-white/15"
            >
              <span className="text-[14px] font-semibold">{hotline.label}</span>
              <span className="flex items-center gap-2 text-[16px] font-bold tabular-nums text-amber-300">
                <PhoneCallIcon className="size-4" aria-hidden="true" />
                {hotline.number}
              </span>
            </a>
          ))}
        </div>

        <button
          type="button"
          onClick={onSendAnyway}
          className="mt-4 h-12 w-full rounded-full bg-brand-orange text-[15px] font-semibold text-white hover:bg-brand-orange-strong"
        >
          Send SOS anyway
        </button>
        <p className="mt-2 text-center text-[12px] leading-5 text-white/55">
          Your report is still recorded and sent to the officer on call.
        </p>
      </div>
    </div>,
    document.body
  )
}