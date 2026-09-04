import { useCallback, useEffect, useState } from "react"

/**
 * Sunlight contrast mode for the responder console.
 *
 * Toggles `data-ops-contrast="high"` on <html>; globals.css restates the
 * shared light token ladder with stronger text, hairline and surface steps so
 * the console stays readable under direct glare. Per device, persisted.
 */
const STORAGE_KEY = "eboses:ops-contrast"

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function useOpsContrast(): { enabled: boolean; toggle: () => void } {
  const [enabled, setEnabled] = useState<boolean>(readStored)

  useEffect(() => {
    document.documentElement.dataset.opsContrast = enabled ? "high" : "normal"
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0")
    } catch {
      // Private mode: the mode still applies for this tab.
    }
  }, [enabled])

  const toggle = useCallback(() => setEnabled((current) => !current), [])
  return { enabled, toggle }
}
