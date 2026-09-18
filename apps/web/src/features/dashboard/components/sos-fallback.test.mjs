import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import test from "node:test"

import {
  buildEmergencySmsHref,
  buildEmergencySmsMessage,
  buildPinnedCoordinateAddress,
  isSosLocationReady,
} from "./sos-fallback.ts"
import { estimateOfflineStreet } from "./sos/offline-sos-config.ts"
import { sosNetworkReachable } from "./sos/offline-sos-network.ts"

const GOLDEN_PATH = fileURLToPath(
  new URL(
    "../../../../../api/apps/sms/fixtures/sms_golden_messages.json",
    import.meta.url
  )
)
const TILE_LAYER_PATH = fileURLToPath(
  new URL("./map/tile-layers.ts", import.meta.url)
)
const SOS_LOCATION_STEP_PATH = fileURLToPath(
  new URL("./sos/location-step.tsx", import.meta.url)
)
const LOCATION_PICKER_PATH = fileURLToPath(
  new URL("./location-picker.tsx", import.meta.url)
)
const SERVICE_WORKER_PATH = fileURLToPath(
  new URL("../../../../public/eboses-sw.js", import.meta.url)
)
const PRECACHE_SCRIPT_PATH = fileURLToPath(
  new URL("../../../../../../scripts/inject_sw_precache.mjs", import.meta.url)
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
    version: 3,
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

test("Emergency SOS reuses the report location picker and its pill", () => {
  const sosSource = readFileSync(SOS_LOCATION_STEP_PATH, "utf8")
  const pickerSource = readFileSync(LOCATION_PICKER_PATH, "utf8")
  assert.match(sosSource, /LocationPickerModal/)
  assert.match(sosSource, /renderInline/)
  assert.match(sosSource, /showSearch=\{false\}/)
  assert.match(sosSource, /recenterOnOpen/)
  assert.match(sosSource, /showStreetView=\{false\}/)
  assert.doesNotMatch(sosSource, /autoLocate/)
  assert.doesNotMatch(sosSource, /import\("leaflet"\)/)
  assert.match(pickerSource, /map = L\.map\(/)
  assert.match(pickerSource, /Use this location/)
})

test("the SOS map only picks the online picker when it can actually reach the network", async () => {
  const probed = []
  const answers = async (url) => {
    probed.push(url)
    return { ok: true, status: 200 }
  }
  const dead = async () => {
    throw new TypeError("Failed to fetch")
  }

  assert.equal(
    await sosNetworkReachable({ fetchImpl: answers, isOnline: () => false, apiBase: "/api" }),
    false
  )
  assert.deepEqual(probed, [], "the browser already knows there is no network")

  assert.equal(
    await sosNetworkReachable({ fetchImpl: answers, isOnline: () => true, apiBase: "/api" }),
    true
  )
  assert.equal(probed[0], "/api/", "the same-origin API is probed first")
  assert.ok(
    probed.some((url) => url.includes("basemaps.cartocdn.com")),
    "the basemap the online map needs is probed too"
  )

  // Connected to something, but nothing answers: bundled map.
  assert.equal(
    await sosNetworkReachable({ fetchImpl: dead, isOnline: () => true, apiBase: "/api" }),
    false
  )

  // Native builds use an absolute API origin where CORS can reject an healthy
  // request, so the basemap decides instead of a misleading failure.
  const blockedApi = async (url) => {
    if (url.includes("cartocdn")) return { ok: true }
    throw new TypeError("blocked")
  }
  assert.equal(
    await sosNetworkReachable({
      fetchImpl: blockedApi,
      isOnline: () => true,
      apiBase: "https://api.example.test",
    }),
    true
  )
  assert.equal(
    await sosNetworkReachable({
      fetchImpl: dead,
      isOnline: () => true,
      apiBase: "https://api.example.test",
    }),
    false
  )
})

test("the SOS location step uses one shared map backed by the cached basemap", () => {
  const locationStep = readFileSync(SOS_LOCATION_STEP_PATH, "utf8")
  assert.match(locationStep, /LocationPickerModal/)
  assert.doesNotMatch(locationStep, /OfflineSosMap/)
  assert.doesNotMatch(locationStep, /offline-sos-map/)
  assert.doesNotMatch(locationStep, /offline-sos-tiles/)
  assert.doesNotMatch(locationStep, /warmOfflineTileCache/)
  assert.doesNotMatch(locationStep, /useBundledMap/)
  assert.match(locationStep, /watchSosNetwork/)
})

test("the service worker precaches one URL at a time so a single 404 cannot disable offline mode", () => {
  const swSource = readFileSync(SERVICE_WORKER_PATH, "utf8")
  assert.match(swSource, /allSettled/)
  assert.doesNotMatch(
    swSource,
    /cache\.addAll/,
    "addAll rejects the entire install"
  )
  assert.match(swSource, /__EBOSES_PRECACHE/)
  assert.match(swSource, /startsWith\("\/tiles\/"\)/)
})

test("the service worker serves bundled tiles cache-first and never caches a miss", () => {
  const swSource = readFileSync(SERVICE_WORKER_PATH, "utf8")
  assert.match(swSource, /startsWith\("\/tiles\/"\)/)
  assert.match(swSource, /function cacheAll/)
  // Old deployments are swept away, but only their build artifacts are.
  assert.match(swSource, /startsWith\("\/assets\/"\)/)
  assert.match(swSource, /if \(keep\.size\)/)
})

test("the build precaches the whole bundle so a cold offline launch still reaches SOS", () => {
  assert.ok(
    existsSync(PRECACHE_SCRIPT_PATH),
    "scripts/inject_sw_precache.mjs must ship with the build"
  )
  const source = readFileSync(PRECACHE_SCRIPT_PATH, "utf8")
  for (const folder of ["assets", "tiles", "icons", "fonts"])
    assert.match(source, new RegExp(`folder: "${folder}"`))
  assert.match(source, /endsWith\("\.woff2"\)/)
  assert.match(source, /required: true/)
  assert.doesNotMatch(
    source,
    /(folder|route): "\/?contents"/,
    "megabytes of marketing imagery are not part of the offline shell"
  )
})
