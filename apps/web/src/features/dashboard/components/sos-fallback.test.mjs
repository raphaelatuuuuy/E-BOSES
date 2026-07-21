import assert from "node:assert/strict"
import test from "node:test"

import {
  buildEmergencySmsHref,
  buildPinnedCoordinateAddress,
  isSosLocationReady,
} from "./sos-fallback.ts"

test("buildEmergencySmsHref creates an explicit native SMS draft for a configured number", () => {
  assert.equal(
    buildEmergencySmsHref(
      "+63 (917) 123-4567",
      "E-BOSES SOS: Medical. Location: Lilac Street"
    ),
    "sms:+639171234567?body=E-BOSES%20SOS%3A%20Medical.%20Location%3A%20Lilac%20Street"
  )
})

test("buildEmergencySmsHref rejects unsafe or incomplete SMS configuration", () => {
  assert.equal(buildEmergencySmsHref("0917;open-app", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("123", "Emergency"), "")
  assert.equal(buildEmergencySmsHref("09171234567", "   "), "")
})

test("buildPinnedCoordinateAddress keeps a usable, honest location when geocoding is unavailable", () => {
  assert.deepEqual(buildPinnedCoordinateAddress(14.6507, 121.1133), {
    primary: "Pinned coordinates",
    full: "Pinned coordinates: 14.650700, 121.113300",
  })
})

test("isSosLocationReady accepts coordinate fallback but rejects an unconfirmed default pin", () => {
  assert.equal(
    isSosLocationReady({
      lat: 14.6507,
      lng: 121.1133,
      address: "Pinned coordinates: 14.650700, 121.113300",
      addressPrimary: "Pinned coordinates",
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
