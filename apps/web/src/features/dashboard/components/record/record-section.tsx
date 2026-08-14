import { useCallback, useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { RecordSection as RecordSectionData } from "./types"

/**
 * Tier 3 — collapsible depth.
 *
 * Open state persists per section key across records and reloads, because an
 * official who always wants to see AI validation should not reopen it on every
 * incident. Persistence is best-effort: private browsing and disabled storage
 * fall back to the section's default rather than failing.
 */

const STORAGE_PREFIX = "eboses.record-section."

function readPersisted(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    return raw === null ? fallback : raw === "1"
  } catch {
    return fallback
  }
}

function persist(key: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? "1" : "0")
  } catch {
    // Storage unavailable — the section still works, it just will not remember.
  }
}

export function RecordSection({
  section,
  embedded = false,
}: {
  section: RecordSectionData
  /** Render as a band inside a unified dossier card, without its own border. */
  embedded?: boolean
}) {
  const fallback = section.defaultOpen ?? false
  // Lazy initialiser rather than a setState-in-effect: the stored preference is
  // known before first paint, so the section does not flash shut then open.
  const [open, setOpen] = useState(() => readPersisted(section.key, fallback))

  const toggle = useCallback(() => {
    setOpen((previous) => {
      const next = !previous
      persist(section.key, next)
      return next
    })
  }, [section.key])

  const contentId = `record-section-${section.key}`

  return (
    <section className={cn("overflow-hidden bg-card", !embedded && "rounded-panel border border-card-line")}>
      <h3>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-tint"
        >
          <ChevronDownIcon
            aria-hidden
            className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
          />
          <span className="text-sm font-bold text-foreground">{section.title}</span>
          {section.badge ? (
            <span className="ml-auto rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-brand-navy">
              {section.badge}
            </span>
          ) : null}
        </button>
      </h3>
      {open ? (
        <div id={contentId} className="border-t border-card-line px-4 py-3">
          {section.content}
        </div>
      ) : null}
    </section>
  )
}
