import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  buildEmergencySmsHref,
  buildEmergencySmsMessage,
  buildPinnedCoordinateAddress,
  isSosLocationReady,
} from "./sos-fallback.ts"

const GOLDEN_PATH = fileURLToPath(
  new URL(
    "../../../../../api/apps/sms/fixtures/sms_golden_messages.json",
    import.meta.url,
  ),
)

test("buildEmergencySmsHref creates an explicit native SMS draft for a configured number", () => {
  assert.equal(
    buildEmergencySmsHref(
      "+63 (917) 123-4567",
      "I need immediate help. This is a Fire emergency."
    ),
    "sms:+639171234567?body=I%20need%20immediate%20help.%20This%20is%20a%20Fire%20emergency."
  )
})

test("buildEmergencySmsHref rejects unsafe or incomplete SMS configuration", () => {
  assert.equal(buildEmergencySmsHref("0917;open-app", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("123", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("09171234567", "   "), "")
})

test("the SMS body carries no prefix, user id, database id or timestamp", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Medical Emergency",
    readableArea: "Lilac Street",
    latitude: 14.6091,
    longitude: 121.0855,
  })
  for (const banned of ["EBOSES-SOS", "E-BOSES SOS", "User ID", "Request ID", "Timestamp", "Latitude:", "Longitude:"]) {
    assert.ok(!message.includes(banned), `message still contains "${banned}": ${message}`)
  }
  assert.ok(message.startsWith("I need immediate help."))
  assert.ok(message.includes("This is a Medical emergency near Lilac Street"))
})

test("the LOC footer is omitted when there is no GPS fix", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Fire",
    readableArea: "Champaca Street",
  })
  assert.ok(!message.includes("LOC:"))
  assert.ok(message.includes("Champaca Street"))
})

test("a message with no readable area still names the category", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Fire",
    latitude: 14.650123,
    longitude: 121.112345,
  })
  assert.equal(
    message,
    "I need immediate help. This is a Fire emergency. Please send assistance.\nLOC:14.650123,121.112345",
  )
})

test("an over-long note is dropped before the category, area or LOC footer", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Fire",
    readableArea: "Champaca Street, Marikina Heights",
    latitude: 14.650123,
    longitude: 121.112345,
    triage: { peopleAffected: "few", injuries: "yes", detail: "spreading" },
    note: "x".repeat(600),
  })
  assert.ok(message.length <= 153 * 3)
  assert.ok(message.includes("Fire emergency"))
  assert.ok(message.includes("Champaca Street, Marikina Heights"))
  assert.ok(message.includes("LOC:14.650123,121.112345"))
  assert.ok(!message.includes("xxxxx"))
})

test("golden fixtures render exactly what the backend parser expects", () => {
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"))
  for (const testCase of golden.cases) {
    assert.equal(
      buildEmergencySmsMessage(testCase.input),
      testCase.message,
      `golden case "${testCase.name}" drifted from apps/sms/fixtures/sms_golden_messages.json`,
    )
  }
})

test("buildPinnedCoordinateAddress keeps a usable, honest location when geocoding is unavailable", () => {
  assert.deepEqual(buildPinnedCoordinateAddress(14.6507, 121.1133), {
    primary: "Pinned location",
    full: "Pinned location on the map",
  })
})

test("isSosLocationReady accepts coordinate fallback but rejects an unconfirmed default pin", () => {
  assert.equal(
    isSosLocationReady({
      lat: 14.6507,
      lng: 121.1133,
      address: "Pinned location on the map",
      addressPrimary: "Pinned location",
    }),
    true
  )
  assert.equal(
    isSosLocationReady({
      lat: 14.6507,
      lng: 121.1133,
      address: "",
      addressPrimary: "",
    }),
    false
  )
})
