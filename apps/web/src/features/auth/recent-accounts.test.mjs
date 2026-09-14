import assert from "node:assert/strict"
import test from "node:test"

const values = new Map()
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
}

const {
  forgetRecentAccount,
  readRecentAccounts,
  rememberRecentAccount,
} = await import("./recent-accounts.ts")

test("recent accounts keep only non-sensitive metadata and newest five users", () => {
  values.clear()
  for (let id = 1; id <= 6; id += 1) {
    rememberRecentAccount(
      { id, email: `resident${id}@example.test`, full_name: `Resident ${id}` },
      `resident${id}@example.test`,
      "email",
    )
  }

  const accounts = readRecentAccounts()
  assert.equal(accounts.length, 5)
  assert.equal(accounts[0].id, 6)
  assert.equal(accounts.at(-1).id, 2)
  assert.equal(JSON.stringify(accounts).includes("password"), false)
})

test("forgetting a recent account removes only that account", () => {
  const next = forgetRecentAccount(4)
  assert.equal(next.some((account) => account.id === 4), false)
  assert.equal(next.length, 4)
})
