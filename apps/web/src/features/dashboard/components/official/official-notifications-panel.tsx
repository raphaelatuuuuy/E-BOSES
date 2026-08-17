"use client"

import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { AlertTriangleIcon, FileTextIcon, MegaphoneIcon } from "lucide-react"

import { type NotificationItem } from "@/features/dashboard/components/notification-context"
import {
  NotificationsPanel,
  type NotificationsConfig,
} from "@/features/dashboard/components/notifications/notifications-panel"

/**
 * The official's notifications — the shared panel with read-state filters and
 * routes (alert or report pages).
 * Rendered as a desktop dialog / full-screen mobile sheet by
 * official-account-dialogs.tsx.
 */

const FILTERS = [
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
]

function typeGroup(item: NotificationItem): string | null {
  if (item.category === "announcement" || item.type === "announcement") return "announcements"
  if (
    item.category === "emergency" ||
    item.emergency_id ||
    item.type.startsWith("emergency") ||
    item.type === "witness_alert"
  ) {
    return "emergencies"
  }
  return "reports"
}

export function OfficialNotificationsPanel({
  onBack,
  onClose,
  initialFilter,
  variant,
}: {
  /** Mobile sheet: renders a Back arrow in the header. */
  onBack?: () => void
  /** Desktop dialog: renders an X in the header. */
  onClose?: () => void
  /** First-run filter override (e.g. an announcements row tap). */
  initialFilter?: string
  /** `sheet` hands the header to the surrounding SheetDialog. */
  variant?: "panel" | "sheet"
}) {
  const navigate = useNavigate()

  const config = useMemo<NotificationsConfig>(
    () => ({
      filters: FILTERS,
      groupOf: typeGroup,
      iconFor: (item) => {
        const group = typeGroup(item)
        if (group === "emergencies")
          return { Icon: AlertTriangleIcon, chipClass: "bg-neutral-100 text-sos" }
        if (group === "announcements")
          return { Icon: MegaphoneIcon, chipClass: "bg-neutral-100 text-neutral-600" }
        return { Icon: FileTextIcon, chipClass: "bg-neutral-100 text-neutral-700" }
      },
      filterStorageKey: "eboses:official-notifications-filter",
      landingCopy: "Report, emergency and announcement updates will land here.",
      onOpen: (item) => {
        if (item.safety_limited || item.type === "witness_alert") return
        if (item.emergency_id) {
          navigate(`/dashboard/emergencies?alert=${item.emergency_id}`)
          return
        }
        if (item.action_url) {
          navigate(item.action_url)
          return
        }
        if (item.concern_id) {
          navigate(`/dashboard/reports/${item.concern_public_id || item.concern_id}`)
        }
      },
    }),
    [navigate],
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
