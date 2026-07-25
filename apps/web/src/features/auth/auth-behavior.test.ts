import assert from "node:assert/strict"
import test from "node:test"

import { readFile } from "node:fs/promises"

import { getStatusPath, isAppRouteEligible } from "./auth-behavior.ts"
import { middleNameStepSchema, nameStepSchema } from "./schemas/name-schema.ts"
import { signInSchema } from "./schemas/sign-in-schema.ts"

test("pending verification users are eligible for guarded app routes", async () => {
  assert.equal(isAppRouteEligible("verified"), true)
  assert.equal(isAppRouteEligible("pending_verification"), true)
  assert.equal(isAppRouteEligible("pending_otp"), false)
  assert.equal(isAppRouteEligible("pending_profile"), false)
  assert.equal(isAppRouteEligible("rejected"), false)
  assert.equal(isAppRouteEligible("suspended"), false)
  assert.equal(getStatusPath("pending_verification", { isOnboarded: false }), "/onboarding")
  assert.equal(getStatusPath("pending_verification", { isOnboarded: true }), "/dashboard")

  const appSource = await readFile(new URL("../../App.tsx", import.meta.url), "utf8")
  assert.equal(
    appSource.match(/if \(!isAppRouteEligible\(user\.status\)\)/g)?.length,
    2,
    "both guarded app routes must consume the shared eligibility predicate",
  )
})

test("sign-in accepts email or an accepted Philippine mobile number", () => {
  const valid = ["resident@example.com", "+639123456789"]
  const invalid = [
    "resident@",
    "not an identifier",
    "+638123456789",
    "09123456789",
    "9123456789",
    "+63912345678",
    "+6391234567890",
  ]

  for (const email of valid) {
    assert.equal(
      signInSchema.safeParse({ email, password: "password" }).success,
      true,
      `expected ${email} to be accepted`,
    )
  }

  for (const email of invalid) {
    assert.equal(
      signInSchema.safeParse({ email, password: "password" }).success,
      false,
      `expected ${email} to be rejected`,
    )
  }
})

test("name schemas accept Unicode letters and common punctuation only", () => {
  for (const name of ["José", "María-José", "O’Connor", "D'Angelo", "李 明"]) {
    assert.equal(
      nameStepSchema.safeParse({ firstName: name, lastName: name }).success,
      true,
      `expected ${name} to be accepted`,
    )
    assert.equal(middleNameStepSchema.safeParse({ middleName: name }).success, true)
  }

  for (const name of ["John3", "Ana\u0007Maria", "Maria_Clara", "<script>"]) {
    assert.equal(
      nameStepSchema.safeParse({ firstName: name, lastName: "Valid" }).success,
      false,
      `expected ${JSON.stringify(name)} to be rejected`,
    )
    assert.equal(middleNameStepSchema.safeParse({ middleName: name }).success, false)
  }
})
