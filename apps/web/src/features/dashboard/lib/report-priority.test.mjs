// Run with: node --experimental-strip-types --test src/features/dashboard/lib/report-priority.test.mjs
//
// Locks in the row sequencing used by the overviews, the "View all" sheet,
// and the resident reports queue: Critical → High → Moderate → Low →
// Resolved → Rejected, most recent within a band.

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  compareReportPriority,
  reportSeverityRank,
} from "./report-priority.ts"

function row({ id = 1, severity = "low", status = "submitted", created_at = "2026-09-15T10:00:00Z" } = {}) {
  return { id, severity, status, created_at, tracking_id: `T-${id}` }
}

const byTitle = (rows) => rows.map((row) => row.severity ?? row.status)

test("open reports order Critical → High → Moderate → Low", () => {
  const rows = [
    row({ id: 1, severity: "low" }),
    row({ id: 2, severity: "critical" }),
    row({ id: 3, severity: "moderate" }),
    row({ id: 4, severity: "high" }),
  ]
  const sorted = [...rows].sort(compareReportPriority)
  assert.deepEqual(
    sorted.map((row) => row.severity),
    ["critical", "high", "moderate", "low"]
  )
})

test("resolved and rejected sink below every open band, rejected last", () => {
  const rows = [
    row({ id: 1, severity: "low", created_at: "2026-09-15T10:00:00Z" }),
    row({
      id: 2,
      severity: "low",
      status: "resolved",
      created_at: "2026-09-15T09:00:00Z",
    }),
    row({
      id: 3,
      severity: "critical",
      status: "rejected",
      created_at: "2026-09-15T09:00:00Z",
    }),
    row({ id: 4, severity: "moderate", created_at: "2026-09-15T10:00:00Z" }),
    row({
      id: 5,
      severity: "critical",
      status: "resolved",
      created_at: "2026-09-15T08:00:00Z",
    }),
  ]
  const sorted = [...rows].sort(compareReportPriority)
  assert.deepEqual(
    sorted.map((row) => row.status),
    ["submitted", "submitted", "resolved", "resolved", "rejected"],
    "resolved rows rank below the lowest open band even when the resolved\n     row was critical, and rejected is last"
  )
})

test("an unknown severity sorts as low, below the other open bands", () => {
  const rows = [
    row({ id: 1, severity: "mystery" }),
    row({ id: 2, severity: "high" }),
  ]
  const sorted = [...rows].sort(compareReportPriority)
  assert.deepEqual(
    sorted.map((row) => row.id),
    [2, 1]
  )
})

test("within a band the most recent report comes first", () => {
  const rows = [
    row({ id: 1, severity: "high", created_at: "2026-09-10T08:00:00Z" }),
    row({ id: 2, severity: "high", created_at: "2026-09-14T08:00:00Z" }),
    row({ id: 3, severity: "high", created_at: "2026-09-12T08:00:00Z" }),
  ]
  const sorted = [...rows].sort(compareReportPriority)
  assert.deepEqual(
    sorted.map((row) => row.id),
    [2, 3, 1]
  )
})

test("emergency alerts without a severity field rank as live criticals", () => {
  const alert = { id: 9, created_at: "2026-09-15T09:00:00Z", tracking_id: "E-9" }
  assert.equal(reportSeverityRank(alert), 3)
  assert.equal(
    reportSeverityRank({ ...alert, status: "resolved" }),
    -1,
    "a settled alert is closed work, not a live critical"
  )
})

test("severity ties break on recency, then on id", () => {
  const older = row({ id: 1, severity: "high", created_at: "2026-09-13T08:00:00Z" })
  const newer = row({ id: 2, severity: "high", created_at: "2026-09-13T08:00:00Z" })
  // Negative means the first argument sorts first: the newer id wins the tie.
  assert.equal(compareReportPriority(newer, older), -1)
  assert.equal(compareReportPriority(older, newer), 1)
})
