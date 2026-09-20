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

test("rebases absolute api media urls onto the configured origin", () => {
  assert.equal(
    resolveMediaUrl(
      "http://192.168.1.5:8000/api/emergencies/resolution-evidence/9/preview/",
      "https://api.example.com"
    ),
    "https://api.example.com/api/emergencies/resolution-evidence/9/preview/"
  )
  assert.equal(
    resolveMediaUrl(
      "https://api.example.com/api/concerns/media/3/preview/",
      "https://api.example.com"
    ),
    "https://api.example.com/api/concerns/media/3/preview/"
  )
})

test("leaves foreign absolute urls and empty origins alone", () => {
  assert.equal(
    resolveMediaUrl(
      "http://192.168.1.5:8000/api/emergencies/resolution-evidence/9/preview/",
      ""
    ),
    "http://192.168.1.5:8000/api/emergencies/resolution-evidence/9/preview/"
  )
  assert.equal(
    resolveMediaUrl("https://cdn.example.com/photo.jpg", "https://api.example.com"),
    "https://cdn.example.com/photo.jpg"
  )
  assert.equal(
    resolveMediaUrl("https://api.example.com/about", "https://api.example.com"),
    "https://api.example.com/about"
  )
})
