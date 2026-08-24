import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const tracking = readFileSync(
  new URL("./emergency-tracking-sheet.tsx", import.meta.url),
  "utf8",
)
const responder = readFileSync(
  new URL("../pages/responder-dispatch.tsx", import.meta.url),
  "utf8",
)
const responderMap = readFileSync(
  new URL("./responder/responder-leaflet-map.tsx", import.meta.url),
  "utf8",
)

test("manual dispatch never claims that a responder is handling the alert", () => {
  assert.match(tracking, /hasActiveResponder\(alert\)/)
  assert.match(tracking, /Manual dispatch in progress/)
  assert.match(tracking, /No responder is assigned yet/)
  assert.doesNotMatch(tracking, /isLive && !canCancel/)
})

test("tracking falls back to real status events and shows manual dispatch", () => {
  assert.match(tracking, /alert\.status_events/)
  assert.match(tracking, /byKey\.get\("no_responder"\)/)
  assert.match(tracking, /hasActiveResponder\(alert\) && alert\.status !== "submitted"/)
  assert.match(tracking, /connectionState === "live" \? 15000 : 5000/)
  assert.doesNotMatch(tracking, /connectionState !== "degraded"/)
})

test("responder location success waits for the server and refreshes assignments", () => {
  assert.match(responder, /await sendLocationPing/)
  assert.match(responder, /if \(!result\.accepted\) throw/)
  assert.match(responder, /await refresh\(\)/)
  assert.match(responder, /emergency_id/)
  assert.match(responder, /Waiting for dispatch/)
  assert.doesNotMatch(responder, />\s*All clear\s*</)
})

test("a zero-length route explains that the responder is already at the incident", () => {
  assert.match(responderMap, /route\.distance_meters/)
  assert.match(responderMap, /You are at the incident location/)
})
