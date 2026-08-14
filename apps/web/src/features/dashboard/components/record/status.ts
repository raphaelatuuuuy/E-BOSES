export {
  ACTIVE_EMERGENCY_STATUSES,
  SETTLED_EMERGENCY_STATUSES,
  STATUS_GROUP_LABEL,
  STATUS_LABEL,
  isEmergencyActive,
  statusGroupOf,
  statusLabelOf,
  type StatusGroup,
} from "@/features/dashboard/lib/status-vocabulary"

import {
  ACTIVE_CONCERN_STATUSES as ACTIVE_CONCERN_STATUS_SET,
  statusGroupOf as groupOf,
  statusLabelOf as labelOf,
} from "@/features/dashboard/lib/status-vocabulary"

import type { StatusGroup } from "@/features/dashboard/lib/status-vocabulary"

export interface StatusView {
  group: StatusGroup
  label: string
}

export const ACTIVE_CONCERN_STATUSES = [...ACTIVE_CONCERN_STATUS_SET] as const

export function toStatusView(status: string | null | undefined): StatusView {
  return { group: groupOf(status), label: labelOf(status) }
}

export function needsAttention(status: string | null | undefined): boolean {
  return groupOf(status) === "open"
}
