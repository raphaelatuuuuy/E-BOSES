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
    <div className="fixed inset-0 z-[400]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="motion-safe:animate-in motion-safe:fade-in absolute inset-0 bg-black/50 motion-safe:duration-200"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duty-hours-title"
        className="motion-safe:animate-in motion-safe:fade-in relative z-10 flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border-0 bg-brand-navy text-white shadow-none motion-safe:duration-200"
      >
        <div className="flex shrink-0 items-start gap-2 px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-1">
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[11px] font-bold tracking-wide text-brand-orange uppercase">
              Emergency SOS
            </p>
            <h2
              id="duty-hours-title"
              className="mt-0.5 text-[22px] leading-[1.2] font-bold tracking-tight text-white"
            >
              Outside barangay duty hours
            </h2>
          </div>
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
            >
              <XIcon className="size-6" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="mt-1 px-5 pb-4 text-[15px] leading-snug text-white/65">
            {window_} For the fastest help right now, please call one of these
            directly.
          </p>

          <div className="mx-5 mb-5 overflow-hidden rounded-[18px] border border-white/15">
            {hotlines.map((hotline) => (
              <a
                key={`${hotline.label}-${hotline.number}`}
                href={`tel:${hotline.number.replace(/[^\d+]/g, "")}`}
                className="flex min-h-[3.25rem] items-center justify-between gap-3 border-b border-white/10 px-5 py-3 transition-colors last:border-b-0 hover:bg-white/10"
              >
                <span className="text-[15px] font-medium text-white">
                  {hotline.label}
                </span>
                <span className="flex items-center gap-2 text-[16px] font-bold text-white tabular-nums">
                  <PhoneCallIcon
                    className="size-4 text-brand-orange"
                    aria-hidden="true"
                  />
                  {hotline.number}
                </span>
              </a>
            ))}
          </div>
        </div>

        <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onSendAnyway}
            className="flex h-[52px] w-full items-center justify-center rounded-full bg-brand-orange text-[17px] font-semibold text-white transition-all hover:bg-brand-orange-strong active:scale-[0.99]"
          >
            Send SOS anyway
          </button>
          <p className="mt-2 text-center text-[13px] leading-5 text-white/55">
            Your report is still recorded and sent to the officer on call.
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
