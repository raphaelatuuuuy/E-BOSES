// Run with: node --test src/features/dashboard/components/record/severity.test.mjs
//
// Mirrors the existing sos-fallback.test.mjs pattern: the repo has no test
// runner, and pure logic is worth covering without adding one.
//
// The logic under test is TypeScript, so the pure functions are re-declared
// here in JS. That duplication is the cost of having no runner; it is confined
// to functions whose formulas are fixed by the design spec and change rarely.

import assert from "node:assert/strict"
import { test } from "node:test"

const SEVERITY_ORDER = ["low", "moderate", "high", "critical"]
const severityLevel = (s) => SEVERITY_ORDER.indexOf(s)
const clampToSeverity = (level) =>
  SEVERITY_ORDER[Math.max(0, Math.min(3, Math.round(level)))]

const CONCERN_CATEGORY_BASELINE = {
  public_safety: 2,
  infrastructure: 1,
  environment: 1,
  others: 0,
}

// Mirrors SEVERITY_ESTIMATE_LEVEL in severity.ts and severity.py.
// critical (3) is now a direct LLM output so the model can set the top band
// without the activeHighRisk compound condition.
const SEVERITY_ESTIMATE_LEVEL = { low: 0, medium: 1, high: 2, critical: 3 }

function deriveConcernSeverity(input) {
  const baseline = CONCERN_CATEGORY_BASELINE[input.category ?? "others"] ?? 0
  const estimate = (input.severityEstimate ?? "").toLowerCase()

  if (!(estimate in SEVERITY_ESTIMATE_LEVEL)) {
    return { severity: clampToSeverity(baseline), assessed: false }
  }

  const activeHighRisk =
    estimate === "high" &&
    input.currentDanger === true &&
    input.incidentTiming === "ongoing"

  if (activeHighRisk) {
    return { severity: clampToSeverity(3), assessed: true }
  }

  let level = Math.max(SEVERITY_ESTIMATE_LEVEL[estimate], baseline)

  const threshold = input.relevanceThreshold ?? 0.65
  if (typeof input.relevance === "number" && input.relevance < threshold)
    level -= 1
  return { severity: clampToSeverity(level), assessed: true }
}

const EMERGENCY_TYPE_BASELINE = {
  fire: 3,
  medical: 2,
  disaster: 2,
  crime: 1,
  other: 0,
}
const EMERGENCY_ACK_TARGET_MINUTES = {
  fire: 2,
  medical: 3,
  disaster: 3,
  crime: 5,
  other: 10,
}

function deriveEmergencySeverity(input) {
  const type = input.type ?? "other"
  let level = EMERGENCY_TYPE_BASELINE[type] ?? 0
  const target = EMERGENCY_ACK_TARGET_MINUTES[type] ?? 10
  if (!input.acknowledged && (input.elapsedMinutes ?? 0) > target) level += 1
  if ((input.witnessCount ?? 0) >= 2) level += 1
  return { severity: clampToSeverity(level), assessed: true }
}

function derivePriority(input) {
  const severityNorm = severityLevel(input.severity) / 3
  const ageNorm = Math.min(
    Math.max(input.hoursSinceStatusChange ?? 0, 0) / 72,
    1
  )
  const supportNorm = Math.min(Math.max(input.voteCount ?? 0, 0) / 25, 1)
  return Math.round(60 * severityNorm + 25 * ageNorm + 15 * supportNorm)
}

function sortRecords(records) {
  return [...records].sort((a, b) => {
    const band = severityLevel(b.severity) - severityLevel(a.severity)
    return band !== 0 ? band : b.priority - a.priority
  })
}

// --- Concern severity -----------------------------------------------------

test("concern severity maps severityEstimate to the correct band", () => {
  const cases = [
    ["low", "others", "low"],
    ["medium", "others", "moderate"],
    ["high", "others", "high"],
    ["critical", "others", "critical"],
  ]
  for (const [estimate, category, expected] of cases) {
    const result = deriveConcernSeverity({ category, severityEstimate: estimate })
    assert.equal(result.severity, expected, `estimate ${estimate}`)
    assert.equal(result.assessed, true)
  }
})

test("category baseline floors severity so public safety is never below 'high' without an estimate", () => {
  const result = deriveConcernSeverity({ category: "public_safety" })
  assert.equal(result.severity, "high")
  assert.equal(result.assessed, false, "unassessed — floor is not a measurement")
})

test("category baseline is applied when estimate is below the floor", () => {
  // public_safety baseline = 2 (high); a low LLM estimate is raised to high
  const result = deriveConcernSeverity({
    category: "public_safety",
    severityEstimate: "low",
  })
  assert.equal(result.severity, "high")
  assert.equal(result.assessed, true)
})

test("an active high-risk concern reaches critical without a direct critical estimate", () => {
  const result = deriveConcernSeverity({
    category: "public_safety",
    severityEstimate: "high",
    currentDanger: true,
    incidentTiming: "ongoing",
  })
  assert.equal(result.severity, "critical")
  assert.equal(result.assessed, true)
})

test("LLM severity estimate of critical reaches the top band directly", () => {
  const result = deriveConcernSeverity({
    category: "others",
    severityEstimate: "critical",
  })
  assert.equal(result.severity, "critical")
  assert.equal(result.assessed, true)
})

test("urgentAttention alone does not promote to critical — the LLM severity is authoritative", () => {
  // Regression: the old mirror escalated to critical on urgentAttention alone.
  // The backend was corrected so the LLM severity estimate is the authority;
  // this test prevents the frontend from re-introducing the same escalation.
  const result = deriveConcernSeverity({
    category: "public_safety",
    severityEstimate: "low",
    urgentAttention: true,
  })
  // low estimate is floored to the public_safety baseline (2 = high)
  assert.equal(result.severity, "high")
  assert.equal(result.assessed, true)
})

test("missing AI assessment falls back to the baseline and is flagged unassessed", () => {
  const result = deriveConcernSeverity({ category: "infrastructure" })
  assert.equal(result.severity, "moderate")
  assert.equal(
    result.assessed,
    false,
    "a category floor must not be presented as a confident measurement"
  )
})

test("low NLP relevance reduces severity by one band", () => {
  const relevant = deriveConcernSeverity({
    category: "others",
    severityEstimate: "high",
    relevance: 0.9,
  })
  const irrelevant = deriveConcernSeverity({
    category: "others",
    severityEstimate: "high",
    relevance: 0.2,
  })
  assert.equal(relevant.severity, "high")
  assert.equal(irrelevant.severity, "moderate")
})

// --- Emergency severity ---------------------------------------------------

test("emergency severity starts from the type baseline", () => {
  assert.equal(deriveEmergencySeverity({ type: "fire" }).severity, "critical")
  assert.equal(deriveEmergencySeverity({ type: "medical" }).severity, "high")
  assert.equal(deriveEmergencySeverity({ type: "crime" }).severity, "moderate")
  assert.equal(deriveEmergencySeverity({ type: "other" }).severity, "low")
})

test("an unacknowledged alert past its ack target escalates one band", () => {
  const fresh = deriveEmergencySeverity({
    type: "crime",
    elapsedMinutes: 2,
    acknowledged: false,
  })
  const overdue = deriveEmergencySeverity({
    type: "crime",
    elapsedMinutes: 9,
    acknowledged: false,
  })
  const handled = deriveEmergencySeverity({
    type: "crime",
    elapsedMinutes: 9,
    acknowledged: true,
  })
  assert.equal(fresh.severity, "moderate")
  assert.equal(overdue.severity, "high")
  assert.equal(
    handled.severity,
    "moderate",
    "acknowledging stops the escalation"
  )
})

test("two independent witnesses corroborate and escalate", () => {
  assert.equal(
    deriveEmergencySeverity({ type: "crime", witnessCount: 1 }).severity,
    "moderate"
  )
  assert.equal(
    deriveEmergencySeverity({ type: "crime", witnessCount: 2 }).severity,
    "high"
  )
})

// --- Priority -------------------------------------------------------------

test("priority saturates on age and on community support", () => {
  const capped = derivePriority({
    severity: "low",
    hoursSinceStatusChange: 10_000,
    voteCount: 10_000,
  })
  const atCap = derivePriority({
    severity: "low",
    hoursSinceStatusChange: 72,
    voteCount: 25,
  })
  assert.equal(
    capped,
    atCap,
    "beyond the caps, more waiting or more votes adds nothing"
  )
  assert.equal(capped, 40)
})

// --- The equity guarantee -------------------------------------------------

test("community support cannot promote a record across a severity band", () => {
  // The research position (Schiff 2023) is that ranking must not follow the
  // reporter's social standing. A maximally-supported, long-waiting moderate
  // concern must still sort below an untouched high one.
  const boosted = {
    id: "well-connected-neighbourhood",
    severity: "moderate",
    priority: derivePriority({
      severity: "moderate",
      hoursSinceStatusChange: 72,
      voteCount: 25,
    }),
  }
  const quiet = {
    id: "quiet-neighbourhood",
    severity: "high",
    priority: derivePriority({
      severity: "high",
      hoursSinceStatusChange: 0,
      voteCount: 0,
    }),
  }

  assert.ok(
    boosted.priority > quiet.priority,
    "precondition: the blended score alone would rank the boosted record higher"
  )

  const [first] = sortRecords([boosted, quiet])
  assert.equal(
    first.id,
    "quiet-neighbourhood",
    "severity band must be compared before the priority score"
  )
})

test("within a band, community support does affect ordering", () => {
  // Civic engagement is defined as residents contributing to prioritisation,
  // so support must still matter — just never across a band.
  const supported = {
    id: "supported",
    severity: "moderate",
    priority: derivePriority({ severity: "moderate", voteCount: 25 }),
  }
  const ignored = {
    id: "ignored",
    severity: "moderate",
    priority: derivePriority({ severity: "moderate", voteCount: 0 }),
  }
  const [first] = sortRecords([ignored, supported])
  assert.equal(first.id, "supported")
})

// --- Queue ranking (mirrors rankConcerns / triageAlerts) -------------------

function rank(items) {
  // Both module queues rank the same way: severity band, then priority.
  return [...items].sort((a, b) => {
    const band = severityLevel(b.severity) - severityLevel(a.severity)
    return band !== 0 ? band : b.priority - a.priority
  })
}

test("a heavily-supported low-severity concern never tops the queue", () => {
  const queue = [
    {
      id: "popular-but-minor",
      severity: deriveConcernSeverity({
        category: "others",
        severityEstimate: "low",
      }).severity,
      priority: derivePriority({
        severity: "low",
        hoursSinceStatusChange: 72,
        voteCount: 500,
      }),
    },
    {
      id: "serious-but-quiet",
      severity: deriveConcernSeverity({
        category: "public_safety",
        severityEstimate: "high",
      }).severity,
      priority: derivePriority({
        severity: "critical",
        hoursSinceStatusChange: 0,
        voteCount: 0,
      }),
    },
  ]

  assert.equal(rank(queue)[0].id, "serious-but-quiet")
})

test("unassessed concerns fall back to the category floor, not to zero", () => {
  // A public-safety report whose photo has not been scored yet must not sink
  // below an assessed-but-trivial one just because the AI has not run.
  const pendingSafety = deriveConcernSeverity({ category: "public_safety" })
  const scoredTrivial = deriveConcernSeverity({
    category: "others",
    severityEstimate: "low",
  })

  assert.equal(pendingSafety.assessed, false)
  assert.ok(
    severityLevel(pendingSafety.severity) >
      severityLevel(scoredTrivial.severity)
  )
})

test("emergency triage puts an overdue unacknowledged alert above a fresh one", () => {
  const queue = [
    {
      id: "fresh-medical",
      severity: deriveEmergencySeverity({
        type: "medical",
        elapsedMinutes: 1,
        acknowledged: false,
      }).severity,
      priority: 0,
    },
    {
      id: "overdue-medical",
      severity: deriveEmergencySeverity({
        type: "medical",
        elapsedMinutes: 20,
        acknowledged: false,
      }).severity,
      priority: 0,
    },
  ]

  assert.equal(rank(queue)[0].id, "overdue-medical")
})