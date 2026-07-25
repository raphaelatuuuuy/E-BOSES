import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  disableBrowserNotifications,
  enableBrowserNotifications,
  getBrowserNotificationState,
  type BrowserNotificationState,
} from "@/features/dashboard/browser-notifications"

export function useBrowserNotifications() {
  const [browserState, setBrowserState] = useState<BrowserNotificationState>({
    supported: true, permission: "default", serverConfigured: false, subscribed: false,
  })
  const [browserBusy, setBrowserBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getBrowserNotificationState().then((state) => { if (!cancelled) setBrowserState(state) })
    return () => { cancelled = true }
  }, [])

  async function handleEnableBrowserNotifications() {
    setBrowserBusy(true)
    try {
      await enableBrowserNotifications()
      const state = await getBrowserNotificationState()
      setBrowserState(state)
      toast.success("Browser notifications enabled")
    } catch (error) {
      const state = await getBrowserNotificationState()
      setBrowserState(state)
      toast.error(error instanceof Error ? error.message : "Could not enable browser notifications.")
    } finally { setBrowserBusy(false) }
  }

  async function handleDisableBrowserNotifications() {
    setBrowserBusy(true)
    try {
      await disableBrowserNotifications()
      const state = await getBrowserNotificationState()
      setBrowserState(state)
      toast.success("Browser notifications disabled")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disable browser notifications.")
    } finally { setBrowserBusy(false) }
  }

  return { browserState, browserBusy, handleEnableBrowserNotifications, handleDisableBrowserNotifications }
}
