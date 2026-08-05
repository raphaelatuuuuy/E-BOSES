import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Tabs for a record pane.
 *
 * The concern record was eight stacked cards — description, timeline, chat,
 * resident, location, evidence, review rail — rendered into a column that was
 * 128px wide at 1280px. Widening the column fixes the horizontal half of that
 * problem; this fixes the vertical half, which is that an official had to
 * scroll past six panels to reach the one they wanted.
 *
 * Underline rather than a filled pill: the record header directly above
 * already carries severity and status colour, and a second saturated control
 * immediately under it turns the top of every record into stripes.
 *
 * Roving-tabindex keyboard support (arrows, Home/End) per the WAI-ARIA tabs
 * pattern — only the selected tab is in the tab order.
 */

export interface OpsTab {
  id: string
  label: string
  /** Rendered as a trailing count. Zero is shown; null/undefined is hidden. */
  count?: number | null
  highlighted?: boolean
  content: React.ReactNode
}

/**
 * `underline` is the record-pane treatment described above.
 *
 * `pill` is for a card that is *only* tabs — the responder's comms card, where
 * there is no coloured record header above to compete with, and the tab row is
 * the card's own header. A filled pill there reads as a control; an underline
 * reads as a leftover border.
 */
export type OpsTabsVariant = "underline" | "pill"

export function OpsTabs({
  tabs,
  value,
  onValueChange,
  className,
  variant = "underline",
}: {
  tabs: OpsTab[]
  value: string
  onValueChange: (id: string) => void
  className?: string
  variant?: OpsTabsVariant
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const active = tabs.find((tab) => tab.id === value) ?? tabs[0]

  function focusTab(index: number) {
    const wrapped = (index + tabs.length) % tabs.length
    const target = tabs[wrapped]
    if (!target) return
    onValueChange(target.id)
    const node = listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${target.id}"]`)
    node?.focus()
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === value)
    if (index < 0) return
    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusTab(index + 1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusTab(index - 1)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusTab(tabs.length - 1)
    }
  }

  const pill = variant === "pill"

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={handleKeyDown}
        className={cn(
          "scrollbar-hide flex shrink-0 overflow-x-auto",
          pill ? "gap-1" : "-mx-1 gap-1 border-b border-card-line px-1",
        )}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active?.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab-id={tab.id}
              aria-selected={selected}
              aria-controls={`ops-tabpanel-${tab.id}`}
              id={`ops-tab-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(tab.id)}
              className={cn(
                "relative shrink-0 whitespace-nowrap text-label transition-colors duration-[--duration-micro]",
                // 44px tall in the pill variant: it is the primary control on a
                // touch surface, not a secondary affordance inside a record.
                pill ? "flex h-11 items-center rounded-pill px-4" : "px-3 py-2.5",
                selected
                  ? pill
                    ? "bg-card-raised text-foreground"
                    : "text-foreground"
                  : tab.highlighted
                    ? "text-brand-orange hover:text-brand-orange-strong"
                    : "text-subtle-foreground hover:text-muted-foreground",
              )}
            >
              {tab.label}
              {tab.count != null ? (
                <span className="ml-1.5 tabular-nums text-faint-foreground">{tab.count}</span>
              ) : null}
              {pill ? null : (
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-2 -bottom-px h-0.5 rounded-pill transition-opacity duration-[--duration-micro]",
                    selected ? "bg-brand-orange opacity-100" : "opacity-0",
                  )}
                />
              )}
            </button>
          )
        })}
      </div>

      {active ? (
        <div
          role="tabpanel"
          id={`ops-tabpanel-${active.id}`}
          aria-labelledby={`ops-tab-${active.id}`}
          // The pill panel scrolls on its own so the tab row stays put when
          // the card's height is constrained; unconstrained it is a no-op.
          className={cn(
            "min-w-0",
            pill ? "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-3" : "pt-4",
          )}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  )
}
