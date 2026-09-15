import assert from "node:assert/strict"
import test from "node:test"

import {
  isGatewaySender,
  parseSmsUpdate,
} from "./sms-update-parser.ts"

test("maps the six resident wordings to timeline stages", () => {
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Your fire emergency was received. Responders have been notified."
    ),
    "received"
  )
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Responders are on the way. Stay safe and keep your phone open."
    ),
    "en_route"
  )
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Responders are almost there. Watch for them if safe."
    ),
    "nearby"
  )
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Responders have arrived at your location."
    ),
    "arrived"
  )
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Your emergency is marked resolved. Thank you, stay safe."
    ),
    "resolved"
  )
  assert.equal(
    parseSmsUpdate(
      "Good day, Maria! Your emergency was received. We are still arranging responders."
    ),
    "received"
  )
})

test("ignores OTP-shaped texts and unknown senders content", () => {
  assert.equal(
    parseSmsUpdate("E-Boses registration code: 482913. This code expires in 5 minutes."),
    null
  )
  assert.equal(parseSmsUpdate("Claim your prize, congrats!"), null)
  assert.equal(parseSmsUpdate(""), null)
})

test("matches the gateway number loosely and rejects others", () => {
  assert.equal(isGatewaySender("09640746068", "09640746068"), true)
  assert.equal(isGatewaySender("+639640746068", "09640746068"), true)
  assert.equal(isGatewaySender("09171234567", "09640746068"), false)
  assert.equal(isGatewaySender("", "09640746068"), false)
})
