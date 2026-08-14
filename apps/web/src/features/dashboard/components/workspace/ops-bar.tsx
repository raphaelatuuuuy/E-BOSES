import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The workspace command bar — 56px, row one of every triage screen.
 *
 * This replaces the per-page "ink hero": a ~200px slab carrying a 6xl count
 * and three stat tiles. On a 900px-tall laptop that hero, plus the appeals
 * panel and the error slot beneath it, pushed the first incident to roughly
 * y=400 — half the screen spent before a dispatcher saw a single emergency.
 *
 * The counters survive because they were the only load-bearing part of the
 * hero. They just don't need 200px to say "2".
 *
 * Only one tone is coloured: `alert`, meaning a human must act. The console
 * used to paint `live` cyan and `good` green as well, so three of four counters
 * were competing and the one that needed someone did not stand out.
 */

export type OpsCounterTone = "default" | "alert" | "live" | "good"

export interface OpsCounter {
  label: string
  value: number | string
  tone?: OpsCounterTone
  onClick?: () => void
}

const toneValueClass: Record<OpsCounterTone, string> = {
  default: "text-foreground",
  alert: "text-sos",
  live: "text-foreground",
  good: "text-subtle-foreground",
}

function Counter({ counter }: { counter: OpsCounter }) {
  const tone = counter.tone ?? "default"
  const content = (
    <>
      <span className={cn("text-row tabular-nums", toneValueClass[tone])}>{counter.value}</span>
      <span className="text-meta text-subtle-foreground">{counter.label}</span>
    </>
  )

  if (!counter.onClick) {
    return <div className="flex items-baseline gap-1.5">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={counter.onClick}
      className="flex items-baseline gap-1.5 rounded-control px-1.5 py-0.5 transition-colors duration-[--duration-micro] hover:bg-card-raised"
    >
      {content}
    </button>
  )
}

export function OpsBar({
  title,
  context,
  counters = [],
  children,
  className,
}: {
  title: string
  context?: React.ReactNode
  counters?: OpsCounter[]
  /** Right-aligned slot: search trigger, aside toggle, view switches. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-4 border-b border-card-line bg-canvas px-4",
        className,
      )}
    >
      <div className="flex min-w-0 shrink-0 items-baseline gap-2.5">
        <h1 className="truncate text-heading text-foreground">{title}</h1>
        {context ? (
          <span className="hidden truncate text-label text-subtle-foreground md:inline">
            {context}
          </span>
        ) : null}
      </div>

      {counters.length > 0 ? (
        <div className="hidden min-w-0 items-center gap-4 lg:flex">
          <span aria-hidden className="h-4 w-px bg-card-line" />
          {counters.map((counter) => (
            <Counter key={counter.label} counter={counter} />
          ))}
        </div>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </header>
  )
}

/**
 * Bar-height control. Exists so every button living in the command bar shares
 * one geometry — the current console has ten different button sizes across the
 * official screens because each page invented its own.
 */
export function OpsBarButton({
  icon: Icon,
  label,
  onClick,
  active,
  tone = "default",
  hideLabel,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  active?: boolean
  tone?: "default" | "primary"
  hideLabel?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hideLabel ? label : undefined}
      aria-pressed={active}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-control px-2.5 text-label transition-colors duration-[--duration-micro]",
        tone === "primary"
          ? "bg-brand-orange text-brand-orange-ink hover:bg-brand-orange-strong"
          : active
            ? "bg-card-raised text-foreground"
            : "text-muted-foreground hover:bg-card-raised hover:text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {hideLabel ? null : <span className="hidden sm:inline">{label}</span>}
    </button>
  )
}
