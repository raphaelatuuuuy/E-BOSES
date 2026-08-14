import { useEffect } from "react"

/**
 * Cross-surface channel for opening the notifications pop-up.
 *
 * Surfaces that can only navigate (notification rows carrying an `action_url`
 * like `/dashboard/notifications?type=announcements`) dispatch
 * `eboses:open-notifications`; the shell-mounted gate(s) for the signed-in
 * role then open their own dialog/sheet — so a row click lands in the pop-up,
 * never on the standalone page.
 */

export const OPEN_NOTIFICATIONS_EVENT = "eboses:open-notifications"

export function openNotificationsPop(filter?: string) {
  window.dispatchEvent(
    new CustomEvent(OPEN_NOTIFICATIONS_EVENT, { detail: { filter: filter ?? "all" } }),
  )
}

/** Parses a notification-page action URL (`/dashboard/notifications?type=…`). */
export function notificationsPageFilter(actionUrl?: string | null): string | undefined {
  if (!actionUrl || typeof window === "undefined") return undefined
  try {
    const parsed = new URL(actionUrl, window.location.origin)
    const path = parsed.pathname.replace(/\/+$/, "")
    if (path !== "/dashboard/notifications") return undefined
    const type = parsed.searchParams.get("type")
    return (type ?? "all").trim() || "all"
  } catch {
    return undefined
  }
}

/**
 * Calls `onOpen(filter)` once whenever a row or link asks to open the
 * notifications pop-up. Mount the returned gate in exactly ONE component per
 * viewport per role (the shell), then render your role's dialog from it.
 */
export function useNotificationsPopGate(onOpen: (filter?: string) => void) {
  useEffect(() => {
    function handle(e: Event) {
      onOpen((e as CustomEvent<{ filter?: string }>).detail?.filter ?? "all")
    }
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, handle)
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, handle)
  }, [onOpen])
}