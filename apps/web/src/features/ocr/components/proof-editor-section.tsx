import { useState, type ReactNode } from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

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
  hint?: string
  done?: boolean
  doneLabel?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = `proof-section-${index}`
  const subtitle = done && doneLabel ? doneLabel : hint

  return (
    <section className="overflow-hidden rounded-2xl border border-line-tint bg-white">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-tint"
        >
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold leading-none",
              done ? "bg-emerald-600 text-white" : "bg-tint text-brand-navy",
            )}
          >
            {done ? <CheckIcon className="size-3.5" /> : index}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{title}</span>
            {subtitle ? (
              <span className="mt-0.5 block text-xs font-medium leading-relaxed text-muted-foreground">
                {subtitle}
              </span>
            ) : null}
          </span>

          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open ? "" : "-rotate-90",
            )}
          />
        </button>
      </h3>

      {open ? (
        <div id={contentId} className="border-t border-line-tint p-3 md:p-4">
          {children}
        </div>
      ) : null}
    </section>
  )
}