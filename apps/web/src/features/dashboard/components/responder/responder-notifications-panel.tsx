"use client"

import { useMemo } from "react"
import { useNavigate } from "react-router-dom"

import { type NotificationItem } from "@/features/dashboard/components/notification-context"
import {
  NotificationsPanel,
  type NotificationsConfig,
} from "@/features/dashboard/components/notifications/notifications-panel"
import { notificationIconFor } from "@/features/dashboard/components/notifications/notification-visuals"

/**
 * The responder's notifications — the shared panel with the responder's
 * Dispatch bucket and routes (alert screen or report page). Rendered as a
 * desktop dialog / full-screen mobile sheet by account-dialogs.tsx.
 */

const FILTERS = [
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
]

function categoryOf(item: NotificationItem): "dispatch" | "system" {
  const type = (item.type ?? "").toLowerCase()
  if (
    item.emergency_id ||
    type.startsWith("emergency") ||
    type.startsWith("backup") ||
    type === "assignment" ||
    type === "dispatch_note" ||
    type.includes("routed")
  ) {
    return "dispatch"
  }
  return "system"
}

export function ResponderNotificationsPanel({
  onBack,
  onClose,
  initialFilter,
  variant,
}: {
  /** Mobile sheet: renders a Back arrow in the header. */
  onBack?: () => void
  /** Desktop dialog: renders an X in the header. */
  onClose?: () => void
  /** First-run filter override (e.g. a row tap); falls back to storage. */
  initialFilter?: string
  /** `sheet` hands the header to the surrounding SheetDialog. */
  variant?: "panel" | "sheet"
}) {
  const navigate = useNavigate()

  const config = useMemo<NotificationsConfig>(
    () => ({
      heading: "Dispatch updates",
      filters: FILTERS,
      dark: false,
      groupOf: (item) => (categoryOf(item) === "dispatch" ? "dispatch" : null),
      iconFor: notificationIconFor,
      filterStorageKey: "eboses:responder-notifications-filter",
      landingCopy: "Dispatch, backup and assignment updates will land here.",
      onOpen: (item) => {
        if (item.safety_limited || item.type === "witness_alert") return
        if (item.emergency_id) {
          navigate(`/dashboard/responders/dispatch?alert=${item.emergency_id}`)
          return
        }
        if (item.action_url) {
          navigate(item.action_url)
          return
        }
        if (item.concern_id) {
          navigate(
            `/dashboard/reports/${item.concern_public_id || item.concern_id}`
          )
        }
      },
    }),
    [navigate]
  )

  return (
    <NotificationsPanel
      config={config}
      onBack={onBack}
      onClose={onClose}
      initialFilter={initialFilter}
      variant={variant}
    />
  )
}
