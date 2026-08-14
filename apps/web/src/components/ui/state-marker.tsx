import { cn } from "@workspace/ui/lib/utils"

export type StateTone = "open" | "active" | "closed" | "alarm"

const TONE: Record<StateTone, string> = {
  open: "text-neutral-500",
  active: "text-brand-navy",
  closed: "text-neutral-400",
  alarm: "text-sos",
}

const LABEL_TONE: Record<StateTone, string> = {
  open: "text-foreground",
  active: "text-foreground",
  closed: "text-neutral-500",
  alarm: "text-foreground",
}

export function StateGlyph({ tone, className }: { tone: StateTone; className?: string }) {
  if (tone === "closed") {
    return (
      <svg
        viewBox="0 0 12 12"
        aria-hidden
        className={cn("size-3 shrink-0", TONE.closed, className)}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 6.4 4.9 8.8 9.5 3.6" />
      </svg>
    )
  }
  if (tone === "open") {
    return (
      <svg viewBox="0 0 10 10" aria-hidden className={cn("size-2.5 shrink-0", TONE.open, className)}>
        <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 10 10"
      aria-hidden
      className={cn("size-2.5 shrink-0", TONE[tone], className)}
    >
      <circle cx="5" cy="5" r="4" fill="currentColor" />
    </svg>
  )
}

export function StateMarker({
  tone,
  label,
  className,
}: {
  tone: StateTone
  label: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-meta font-medium",
        LABEL_TONE[tone],
        className,
      )}
    >
      <StateGlyph tone={tone} />
      {label}
    </span>
  )
}
