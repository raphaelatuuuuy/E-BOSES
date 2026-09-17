import { describe, it } from "node:test"
import assert from "node:assert/strict"

const listeners = {}
globalThis.self = {
  location: { origin: "https://app.test" },
  addEventListener: (type, handler) => {
    listeners[type] ??= []
    listeners[type].push(handler)
  },
}

await import("../../../../../public/eboses-sw.js")

const messageHandlers = listeners.message ?? []
assert.ok(messageHandlers.length >= 1, "worker registers a message handler")

function lonToX(lng, zoom) {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom)
}

function latToY(lat, zoom) {
  const radians = (lat * Math.PI) / 180
  return Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) *
      2 ** zoom
  )
}

function runWarm(payload, { preseed = [] } = {}) {
  const fetched = []
  const stored = new Map(preseed)
  globalThis.caches = {
    open: async () => ({
      match: async (url) => stored.get(url) ?? null,
      put: async (url, response) => {
        stored.set(url, response)
      },
      keys: async () => [...stored.keys()],
      delete: async (url) => {
        stored.delete(url)
      },
    }),
  }
  globalThis.fetch = async (url) => {
    fetched.push(url)
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      blob: async () => new Blob(["tile"]),
    }
  }
  const pending = []
  const event = {
    data: { type: "eboses.warm-tiles", payload },
    waitUntil: (promise) => {
      pending.push(promise)
    },
  }
  for (const handler of messageHandlers) handler(event)
  return { fetched, stored, done: () => Promise.all(pending) }
}

const TEMPLATE =
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=K"
const BOUNDS = { minLat: 14.648, maxLat: 14.652, minLng: 121.111, maxLng: 121.115 }

describe("eboses-sw offline-maps range", () => {
  const ARCHIVE = "https://app.test/offline-maps/marikina-heights.pmtiles"
  const BYTES = new Uint8Array(500).map((_, i) => i % 251)

  function rangeSetup({ cached = true, online = true } = {}) {
    const fetched = []
    const stored = new Map()
    if (cached) {
      stored.set(
        "/offline-maps/marikina-heights.pmtiles",
        new Response(BYTES, {
          headers: { "content-type": "application/octet-stream" },
        })
      )
    }
    globalThis.caches = {
      open: async () => ({
        match: async (key) => {
          const hit = stored.get(typeof key === "string" ? key : key.url)
          return hit ? hit.clone() : null
        },
        put: async (key, response) => {
          stored.set(typeof key === "string" ? key : key.url, response)
        },
        keys: async () => [...stored.keys()],
        delete: async (key) => {
          stored.delete(typeof key === "string" ? key : key.url)
        },
      }),
    }
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url
      fetched.push(url)
      if (!online) throw new Error("offline")
      return new Response(BYTES, {
        headers: { "content-type": "application/octet-stream" },
      })
    }
    return { fetched, stored }
  }

  async function requestRange(range) {
    const event = {
      request: new Request(ARCHIVE, range ? { headers: { range } } : {}),
      promise: null,
      respondWith(promise) {
        this.promise = promise
      },
    }
    for (const handler of listeners.fetch ?? []) handler(event)
    if (!event.promise) throw new Error("no fetch handler answered")
    return event.promise
  }

  it("serves byte ranges from cache while offline", async () => {
    rangeSetup({ cached: true, online: false })
    const response = await requestRange("bytes=0-99")
    assert.equal(response.status, 206)
    assert.equal(response.headers.get("Content-Range"), "bytes 0-99/500")
    assert.equal(response.headers.get("Accept-Ranges"), "bytes")
    const body = new Uint8Array(await response.arrayBuffer())
    assert.equal(body.length, 100)
    assert.deepEqual([...body], [...BYTES.slice(0, 100)])
  })

  it("serves the full file without a range and rejects bad ranges", async () => {
    rangeSetup({ cached: true, online: false })
    const full = await requestRange(null)
    assert.equal(full.status, 200)
    assert.equal(new Uint8Array(await full.arrayBuffer()).length, 500)
    const bad = await requestRange("bytes=900-999")
    assert.equal(bad.status, 416)
  })

  it("fetches and caches the archive on first request", async () => {
    const { fetched, stored } = rangeSetup({ cached: false, online: true })
    const response = await requestRange("bytes=10-19")
    assert.equal(response.status, 206)
    assert.ok(fetched.includes("/offline-maps/marikina-heights.pmtiles"))
    assert.ok(stored.has("/offline-maps/marikina-heights.pmtiles"))
  })
})

describe("eboses-sw warm-tiles", () => {
  it("saves the exact tile URLs Leaflet would request", async () => {
    const { fetched, stored, done } = runWarm({
      template: TEMPLATE,
      subdomains: "abcd",
      bounds: BOUNDS,
      zooms: [16],
      retina: false,
    })
    await done()
    const minX = lonToX(BOUNDS.minLng, 16)
    const maxX = lonToX(BOUNDS.maxLng, 16)
    const minY = latToY(BOUNDS.maxLat, 16)
    const maxY = latToY(BOUNDS.minLat, 16)
    const expected = (maxX - minX + 1) * (maxY - minY + 1)
    assert.ok(expected > 1, "bounds span several tiles")
    assert.equal(fetched.length, expected)
    const x = lonToX(121.1133, 16)
    const y = latToY(14.6507, 16)
    const s = "abcd"[Math.abs(x + y) % 4]
    assert.ok(
      fetched.includes(
        `https://${s}.basemaps.cartocdn.com/light_all/16/${x}/${y}.png?key=K`
      )
    )
    for (const url of fetched) {
      const response = stored.get(url)
      assert.ok(response, `cached ${url}`)
      assert.ok(
        Number(response.headers.get("x-eboses-cached-at")) > 0,
        "stamped for TTL"
      )
    }
  })

  it("uses @2x URLs on retina screens", async () => {
    const { fetched, done } = runWarm({
      template: TEMPLATE,
      subdomains: "abcd",
      bounds: BOUNDS,
      zooms: [14],
      retina: true,
    })
    await done()
    assert.ok(fetched.length > 0)
    assert.ok(fetched.every((url) => url.includes("@2x.png")))
  })

  it("skips tiles already saved and refuses off-origin templates", async () => {
    const x = lonToX(121.1133, 15)
    const y = latToY(14.6507, 15)
    const s = "abcd"[Math.abs(x + y) % 4]
    const fresh = new Response("tile", {
      headers: { "x-eboses-cached-at": String(Date.now()) },
    })
    const seededUrl = `https://${s}.basemaps.cartocdn.com/light_all/15/${x}/${y}.png?key=K`
    const first = runWarm(
      {
        template: TEMPLATE,
        subdomains: "abcd",
        bounds: BOUNDS,
        zooms: [15],
        retina: false,
      },
      { preseed: [[seededUrl, fresh]] }
    )
    await first.done()
    assert.ok(!first.fetched.includes(seededUrl))

    const second = runWarm({
      template: "https://evil.test/{z}/{x}/{y}.png",
      subdomains: "a",
      bounds: BOUNDS,
      zooms: [15],
      retina: false,
    })
    await second.done()
    assert.equal(second.fetched.length, 0)
  })
})
