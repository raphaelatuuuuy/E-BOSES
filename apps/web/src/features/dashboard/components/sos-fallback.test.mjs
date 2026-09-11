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
import { estimateOfflineStreet } from "./sos/offline-sos-config.ts"

const GOLDEN_PATH = fileURLToPath(
  new URL(
    "../../../../../api/apps/sms/fixtures/sms_golden_messages.json",
    import.meta.url
  )
)
const TILE_LAYER_PATH = fileURLToPath(
  new URL("./map/tile-layers.ts", import.meta.url)
)

test("buildEmergencySmsHref creates an explicit native SMS draft for a configured number", () => {
  assert.equal(
    buildEmergencySmsHref(
      "09640746068",
      "I need immediate help. This is a Fire emergency."
    ),
    "sms:09640746068?body=I%20need%20immediate%20help.%20This%20is%20a%20Fire%20emergency."
  )
})

test("buildEmergencySmsHref rejects unsafe or incomplete SMS configuration", () => {
  assert.equal(buildEmergencySmsHref("09640746068;open-app", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("123", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("09640746068", "   "), "")
})

test("the SMS body carries no prefix, user id, database id or timestamp", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Medical Emergency",
    readableArea: "Lilac Street",
    latitude: 14.6091,
    longitude: 121.0855,
  })
  for (const banned of [
    "EBOSES-SOS",
    "E-BOSES SOS",
    "User ID",
    "Request ID",
    "Timestamp",
    "Latitude:",
    "Longitude:",
  ]) {
    assert.ok(
      !message.includes(banned),
      `message still contains "${banned}": ${message}`
    )
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
    "I need immediate help. This is a Fire emergency. Please send assistance.\nLOC:14.650123,121.112345"
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
      `golden case "${testCase.name}" drifted from apps/sms/fixtures/sms_golden_messages.json`
    )
  }
})

test("long locations never discard answered triage questions", () => {
  const message = buildEmergencySmsMessage({
    emergencyType: "Flood",
    readableArea: "Mayon Street, " + "Hacienda Heights, ".repeat(24),
    triage: { peopleAffected: "one", detail: "waist", injuries: "yes" },
    latitude: 14.650123,
    longitude: 121.112345,
  })
  assert.ok(message.includes("1 person affected"))
  assert.ok(message.includes("water is waist deep or higher"))
  assert.ok(message.includes("someone is injured"))
  assert.ok(message.includes("LOC:14.650123,121.112345"))
})

test("buildPinnedCoordinateAddress keeps a usable, honest location when geocoding is unavailable", () => {
  assert.deepEqual(buildPinnedCoordinateAddress(14.6507, 121.1133), {
    primary: "Pinned location",
    full: "Pinned location on the map",
  })
})

test("isSosLocationReady accepts any finite pin and rejects missing or non-finite coordinates", () => {
  assert.equal(
    isSosLocationReady({
      lat: 14.6507,
      lng: 121.1133,
      address: "Pinned location on the map",
      addressPrimary: "Pinned location",
    }),
    true
  )
  assert.equal(isSosLocationReady({ lat: 14.6507, lng: 121.1133 }), true)
  assert.equal(isSosLocationReady({ lat: Number.NaN, lng: 121.1133 }), false)
  assert.equal(isSosLocationReady(null), false)
})

test("offline street matching measures the road segment and rejects weak GPS", () => {
  const config = {
    version: 2,
    smsNumber: "09640746068",
    community: {
      name: "Marikina Heights",
      bounds: {
        minLatitude: 14.64,
        maxLatitude: 14.66,
        minLongitude: 121.1,
        maxLongitude: 121.13,
      },
      boundaryPath: "",
      acceptance: {
        centerLatitude: 14.65,
        centerLongitude: 121.11,
        radiusMeters: 800,
      },
      streets: [
        {
          name: "Actual Road",
          points: [
            [14.65, 121.1],
            [14.65, 121.12],
          ],
        },
        {
          name: "Endpoint Road",
          points: [
            [14.649, 121.109],
            [14.649, 121.11],
          ],
        },
      ],
    },
  }

  const estimate = estimateOfflineStreet(14.65005, 121.11, 15, config)
  assert.equal(estimate?.name, "Actual Road")
  assert.ok(estimate.distanceMeters < 10)
  assert.equal(estimateOfflineStreet(14.65005, 121.11, 5000, config), null)
})

test("offline maps keep saved streets without coverage overlays or label stacks", () => {
  const source = readFileSync(TILE_LAYER_PATH, "utf8")
  assert.match(source, /community\.streets/)
  assert.match(source, /tileerror/)
  assert.doesNotMatch(source, /community\.boundaryGeometry/)
  assert.doesNotMatch(source, /L\.rectangle/)
  assert.doesNotMatch(source, /permanent:\s*true/)
})
