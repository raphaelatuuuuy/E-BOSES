import assert from "node:assert/strict"
import test from "node:test"

import {
  SMS_MAX_PARTS,
  normalizeSmsRecipient,
  smsBodyTooLong,
} from "./sms-recipient.ts"

test("keeps valid international and local numbers", () => {
  assert.equal(normalizeSmsRecipient("+639171234567"), "+639171234567")
  assert.equal(normalizeSmsRecipient("09640746068"), "09640746068")
  assert.equal(normalizeSmsRecipient("(+63) 917-123 4567"), "+639171234567")
})

test("rejects unusable recipients", () => {
  assert.equal(normalizeSmsRecipient(""), "")
  assert.equal(normalizeSmsRecipient("12345"), "")
  assert.equal(normalizeSmsRecipient("+639171234567890123"), "")
  assert.equal(normalizeSmsRecipient("not-a-number"), "")
  assert.equal(normalizeSmsRecipient("63917ABC4567"), "")
})

test("flags bodies beyond the multipart budget", () => {
  assert.equal(smsBodyTooLong("hello"), false)
  assert.equal(smsBodyTooLong("x".repeat(SMS_MAX_PARTS * 153)), false)
  assert.equal(smsBodyTooLong("x".repeat(SMS_MAX_PARTS * 153 + 1)), true)
})
