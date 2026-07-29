import { useCallback, useEffect, useState } from "react"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  getResponderDashboardSummary,
  type ResponderAssignedUnit,
  type ResponderRoleSummary,
} from "@/features/dashboard/api"

/** Legacy enum labels, for accounts that predate the unit registry. */
const legacyUnitLabels: Record<string, string> = {
  tanod: "Barangay Tanod",
  bhw: "Barangay Health Workers",
  bdrrmo: "BDRRMO",
  other: "Other responder",
}

export interface ResponderUnitView {
  /** Full unit name as the barangay wrote it, e.g. "Barangay Health Workers". */
  name: string
  /** Abbreviation for tight spaces, e.g. "BHW". */
  shortName: string
  /** What the unit handles, when an official filled it in. */
  description: string
  /** False when nobody has placed this responder in a unit yet. */
  assigned: boolean
  summary: ResponderRoleSummary | null
  loading: boolean
  reload: () => Promise<void>
}

function view(unit: ResponderAssignedUnit | null | undefined, legacy: string): {
  name: string
  shortName: string
  description: string
  assigned: boolean
} {
  if (unit) {
    return {
      name: unit.name,
      shortName: unit.short_name || unit.name,
      description: unit.description || "",
      assigned: true,
    }
  }
  const label = legacyUnitLabels[legacy] ?? ""
  return {
    name: label || "No unit assigned",
    shortName: label ? legacy.toUpperCase() : "Unassigned",
    description: "",
    assigned: Boolean(label),
  }
}

/**
 * The responder's unit, as the barangay assigned it.
 *
 * Read-only by design. A responder used to pick their own unit when starting a
 * shift, which let them route themselves into another unit's emergencies; the
 * server now ignores any unit sent from a responder client, and this is how the
 * screens show what they actually belong to.
 */
export function useResponderUnit(): ResponderUnitView {
  const { user } = useAuthSession()
  const [summary, setSummary] = useState<ResponderRoleSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setSummary(await getResponderDashboardSummary())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void reload().catch(() => {
        if (!cancelled) setLoading(false)
      })
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [reload])

  return {
    ...view(summary?.assigned_unit, summary?.responder_unit || user?.responder_unit || ""),
    summary,
    loading,
    reload,
  }
}
