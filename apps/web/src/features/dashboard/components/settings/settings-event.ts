import { useEffect } from "react"

export const OPEN_SETTINGS_EVENT = "eboses:open-settings"

export function openSettingsDialog() {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT))
}

export function useSettingsPopGate(onOpen: () => void) {
  useEffect(() => {
    function handle() {
      onOpen()
    }
    window.addEventListener(OPEN_SETTINGS_EVENT, handle)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handle)
  }, [onOpen])
}