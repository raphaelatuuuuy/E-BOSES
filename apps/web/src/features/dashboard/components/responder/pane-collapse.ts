// apps/web/src/features/dashboard/components/responder/pane-collapse.ts

import * as React from "react"

/**
 * Collapse state for a pane, persisted per responder.
 *
 * Lives here rather than in the console so every pane that opts into a header
 * chevron behaves identically and remembers itself across reloads — a
 * responder who works with the comms pane shut should not have to shut it
 * again every shift.
 */
export function usePaneCollapse(storageKey: string, initial = false) {
  const [collapsed, setCollapsed] = React.useState(() => {
    if (typeof window === "undefined") return initial
    const raw = window.localStorage.getItem(storageKey)
    return raw == null ? initial : raw === "1"
  })

  React.useEffect(() => {
    window.localStorage.setItem(storageKey, collapsed ? "1" : "0")
  }, [collapsed, storageKey])

  return [collapsed, setCollapsed] as const
}