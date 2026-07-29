import { useState, type ReactNode } from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * One part of proof-type setup, on a single scrolling page.
 *
 * This replaced a four-step wizard. The steps were not actually sequential —
 * an official adding a field usually wants to re-run the sample test straight
 * away, which meant walking forward and back through the stepper. Sections that
 * are all open at once let them move in whatever order the work needs, and make
 * it obvious how much setup remains.
 *
 * Each section reports whether it is done, so "am I finished?" is answerable
 * without the wizard's progress bar.
 */
export function ProofEditorSection({
  index,
  title,
  hint,
  done,
  doneLabel,
  defaultOpen = false,
  children,
}: {
  index: number
  title: string
  hint: string
  done?: boolean
  doneLabel?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = `proof-section-${index}`

  return (
    <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-tint"
        >
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
              done ? "bg-status-closed text-white" : "bg-tint text-brand-navy",
            )}
          >
            {done ? <CheckIcon className="size-3.5" /> : index}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-foreground">{title}</span>
            <span className="mt-0.5 block text-xs font-medium leading-relaxed text-muted-foreground">
              {done && doneLabel ? doneLabel : hint}
            </span>
          </span>

          <ChevronDownIcon
            aria-hidden
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
        </button>
      </h3>

      {open ? (
        <div id={contentId} className="border-t border-card-line p-3 md:p-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}
