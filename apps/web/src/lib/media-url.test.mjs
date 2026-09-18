import assert from "node:assert/strict"
import test from "node:test"

import { resolveMediaUrl } from "./media-url.ts"

test("prefixes app-relative media paths with the api origin", () => {
  assert.equal(
    resolveMediaUrl("/api/emergencies/media/9/preview/", "https://api.example.com"),
    "https://api.example.com/api/emergencies/media/9/preview/"
  )
  assert.equal(
    resolveMediaUrl("/api/x/", "https://api.example.com/"),
    "https://api.example.com/api/x/"
  )
})

test("leaves absolute, protocol-relative, blob, and empty sources alone", () => {
  assert.equal(
    resolveMediaUrl("https://cdn.example.com/a.webp", "https://api.example.com"),
    "https://cdn.example.com/a.webp"
  )
  assert.equal(
    resolveMediaUrl("//cdn.example.com/a.webp", "https://api.example.com"),
    "//cdn.example.com/a.webp"
  )
  assert.equal(
    resolveMediaUrl("blob:https://localhost/1", "https://api.example.com"),
    "blob:https://localhost/1"
  )
  assert.equal(resolveMediaUrl("", "https://api.example.com"), "")
})
