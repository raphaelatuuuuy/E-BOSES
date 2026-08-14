import { type ReactNode } from "react"
import { XIcon } from "lucide-react"

/**
 * Shell for the alert-map detail panel.
 *
 * Badges were removed from the shell entirely: no severity rule, no severity
 * or status chip, and no eyebrow over the title. The title carries the panel.
 *
 * Everything here reads from the theme tokens, so the panel inherits whichever
 * surface it is mounted on. On the alert map that is the `staff-dark` scope, so
 * it sits on the navy glass instead of drawing a second white card inside it —
 * a card inside a panel is what made this read as cramped.
 */

export function PanelShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <section className="px-4 py-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-section capitalize text-foreground">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card-raised hover:text-foreground"
          aria-label="Close details"
        >
          <XIcon className="size-4.5" />
        </button>
      </div>
      <div className="grid gap-5">{children}</div>
    </section>
  )
}

/**
 * A label/value pair. The badge replacement: anything that is not a live status
 * is a fact with a name, not a pill.
 */
export function InfoRow({
  icon,
  label,
  value,
  emphasis = false,
}: {
  icon: ReactNode
  label: string
  value: string | null
  /** Lifts a row out of the list for the one or two facts that drive the
   *  decision, so not every fact carries identical weight. */
  emphasis?: boolean
}) {
  const missing = value === null || value.trim() === ""

  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-faint-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-subtle-foreground">{label}</span>
        <span
          className={
            missing
              ? "mt-1 block text-[15px] italic text-faint-foreground"
              : emphasis
                ? "mt-1 block text-[19px] font-semibold leading-snug text-foreground"
                : "mt-1 block text-[15px] leading-snug text-foreground"
          }
        >
          {/* Explicit known-unknown: blank space reads as a rendering bug. */}
          {missing ? "Not available" : value}
        </span>
      </span>
    </div>
  )
}
