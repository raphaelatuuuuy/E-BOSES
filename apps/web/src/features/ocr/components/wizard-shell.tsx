import { useEffect, type ReactNode } from "react"
import { ArrowLeftIcon, CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"

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
 * two panes and everything lives in one of them — testing included. This shell
 * only supplies the frame: where you are, whether it saved, and the way out.
 */

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error"

function SaveNote({ state }: { state: SaveState }) {
  if (state === "idle") return null
  const busy = state === "pending" || state === "saving"
  return (
    <span
      aria-live="polite"
      className={cn(
        "hidden items-center gap-1.5 text-meta sm:inline-flex",
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
  children,
}: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  saveState: SaveState
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
    <div className="fixed inset-0 z-[80] flex sm:items-center sm:justify-center sm:bg-black/40 sm:p-6">
      {/* A dialog on a desktop, the whole screen on a phone. Setting up a
          document is a detour from the list, not a place you live — taking the
          entire window for it on a large screen loses the context you came
          from. */}
      <div
        className="flex h-full w-full flex-col bg-white sm:h-[min(880px,92vh)] sm:max-w-[1180px] sm:rounded-3xl sm:shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 px-5 py-4 sm:px-8">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back to all documents"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
          >
            <ArrowLeftIcon className="size-5" strokeWidth={1.8} aria-hidden />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-row font-medium text-brand-navy">
              {title}
            </p>
            {subtitle ? (
              <p className="truncate text-meta text-neutral-500">{subtitle}</p>
            ) : null}
          </div>
          <SaveNote state={saveState} />
          <button
            type="button"
            onClick={onClose}
            className="ml-2 shrink-0 rounded-full bg-brand-navy px-6 py-2.5 text-read font-semibold text-white transition-colors hover:bg-accent"
          >
            Done
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-brand-navy sm:hidden"
          >
            <XIcon className="size-5" strokeWidth={1.8} aria-hidden />
          </button>
        </header>

        {/* The workspace lays out its own two panes and scrolls them
            independently, so the shell adds no column or scroller of its own. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:rounded-b-3xl">
          {children}
        </div>
      </div>
    </div>
  )
}
