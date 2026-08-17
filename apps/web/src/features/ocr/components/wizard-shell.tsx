import { useEffect, type ReactNode } from "react"
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Full-screen surface for setting up one document.
 *
 * This started as four accordions on the configuration page, then became a
 * four-step wizard. Both were wrong for the same reason: steps two and three
 * act on the *same* objects. You draw a box around a detail, then you move to
 * another destination to say what that detail must contain — and that screen
 * opened with its own dropdown to re-pick the detail you had just selected.
 *
 * So there are no steps and no sections. The workspace fills the dialog with
 * one scrolling column and everything lives in it — testing included. The
 * shell is the same object as every other dialog in the product: a bottom
 * sheet on a phone, a centred card with a 28px radius above it, a single
 * pinned pill action.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error"

function SaveNote({ state }: { state: SaveState }) {
  if (state === "idle") return null
  const busy = state === "pending" || state === "saving"
  return (
    <span
      aria-live="polite"
      className={cn(
        "hidden items-center gap-1.5 text-[13px] sm:inline-flex",
        state === "error" ? "text-sos" : "text-neutral-500"
      )}
    >
      {busy ? (
        <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden />
      ) : null}
      {state === "saved" ? (
        <CheckIcon className="size-3.5" aria-hidden />
      ) : null}
      {busy
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : "Could not save — will retry"}
    </span>
  )
}

export function ProofWizardShell({
  open,
  title,
  subtitle,
  onClose,
  saveState,
  doneDisabled = false,
  actions,
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  saveState: SaveState
  /** Disable Done until the operator changes something. */
  doneDisabled?: boolean
  /** Controls seated beside the close button (e.g. the front/back toggle). */
  actions?: ReactNode
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[min(720px,92vh)] w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-w-2xl sm:rounded-[28px] rounded-t-[28px]"
      >
        {/* The same header as every sheet: bold title, subtitle, then the
            close. The save note sits with the close, not in the body. */}
        <div className="flex shrink-0 items-start gap-2 px-5 pb-3 pt-5">
          <div className="min-w-0 flex-1 pt-1.5">
            <h2 className="text-[22px] font-bold leading-[1.2] tracking-tight text-neutral-900">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1.5 text-[15px] leading-snug text-neutral-500">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <SaveNote state={saveState} />
            {actions ? <div className="ml-2">{actions}</div> : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
            >
              <XIcon className="size-6" strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>

        {/* One scrolling column. The workspace lays out its own sections, so
            the shell adds no second scroller. */}
        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">
          {children}
        </div>

        <footer className="shrink-0 px-5 pb-6 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={doneDisabled}
            className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:opacity-100"
          >
            Save changes
          </button>
        </footer>
      </div>
    </div>
  )
}
