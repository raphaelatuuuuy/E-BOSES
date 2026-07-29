import type { ReactNode } from "react"

import type { Severity } from "./severity"
import type { StatusView } from "./status"

/**
 * The shape every module maps into before rendering a record.
 *
 * Emergencies, concerns and map alerts each supply a `toRecordView` adapter, so
 * the primitive never imports a domain type and the adapters stay pure and
 * testable. Adding a module means writing an adapter, not touching this.
 */

export interface RecordFact {
  label: string
  /** Null renders as an explicit known-unknown, never as blank space — an
   *  empty row reads as a rendering bug to the official looking at it. */
  value: string | null
  /** Shown when `value` is null, e.g. "Reporter did not share location". */
  emptyHint?: string
}

export interface RecordAction {
  key: string
  label: string
  tone?: "primary" | "default" | "danger"
  disabled?: boolean
  /** Why it is disabled — a capability the official lacks, or a state the
   *  record is not in yet. Disabled-with-reason teaches; hidden looks broken. */
  disabledReason?: string
  onSelect: () => void
}

export interface RecordTrackStep {
  key: string
  label: string
  state: "done" | "current" | "pending"
  /** Short timestamp or duration, e.g. "1:40". */
  at?: string
}

export interface RecordSection {
  key: string
  title: string
  /** Count or short status shown on the collapsed header, so officials can see
   *  there are three photos without expanding. */
  badge?: string
  defaultOpen?: boolean
  content: ReactNode
}

export interface RecordView {
  id: string
  kind: "emergency" | "concern" | "alert"

  /** Tier 1 — what, where, how bad, how long. */
  typeLabel: string
  severity: Severity
  /** False when no AI assessment exists yet; the badge says so instead of
   *  presenting a category baseline as a measurement. */
  severityAssessed: boolean
  status: StatusView
  priority: number
  title: string
  address: string | null
  elapsedLabel: string | null
  distanceLabel?: string | null
  facts: RecordFact[]

  /** Tier 2 — live workflow. `actions[0]` is the one to take now. */
  track: RecordTrackStep[]
  assigneeLabel?: string | null
  assigneeDetail?: string | null
  actions: RecordAction[]

  /** Tier 3 — collapsible depth. */
  sections: RecordSection[]
}
