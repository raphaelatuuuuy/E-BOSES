import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { routePreviewState } from "./route-preview-map-state.ts"

const sms = readFileSync(new URL("./test-workspace-sms.tsx", import.meta.url), "utf8")
const emergency = readFileSync(new URL("./test-workspace-emergencies.tsx", import.meta.url), "utf8")
const map = readFileSync(new URL("./route-preview-map.tsx", import.meta.url), "utf8")

test("both report checks use the shared route map", () => {
  assert.match(sms, /<RoutePreviewMap/)
  assert.match(emergency, /<RoutePreviewMap/)
})

test("community-only locations do not draw a fake destination", () => {
  const state = routePreviewState(
    { boundary: { type: "Polygon", coordinates: [] }, has_destination: false, latitude: null, longitude: null },
    { geometry: { type: "LineString", coordinates: [] } },
  )
  assert.deepEqual(state, {
    showBoundary: false,
    showIncident: false,
    showResponder: false,
    showRoute: false,
    noDestination: true,
  })
  assert.doesNotMatch(map, /Local route preview/)
})

test("route geometry is rendered", () => {
  const state = routePreviewState(
    { boundary: null, has_destination: true, latitude: 14.65, longitude: 121.11 },
    { geometry: { type: "LineString", coordinates: [] } },
  )
  assert.equal(state.showIncident, true)
  assert.equal(state.showResponder, true)
  assert.equal(state.showRoute, true)
  assert.match(map, /routeRenderGeometry/)
  assert.match(map, /drawRoute/)
  assert.match(map, /glyphPinHtml/)
  assert.match(map, /addBaseTiles\(L, map, "dark"/)
  assert.match(map, /zoomControl: false/)
})

test("results open in follow-up dialogs and raw route codes stay hidden", () => {
  const concerns = readFileSync(new URL("./test-workspace-concerns.tsx", import.meta.url), "utf8")
  const page = readFileSync(new URL("./concern-classification-page.tsx", import.meta.url), "utf8")
  assert.match(concerns, /title="Concern check result"/)
  assert.match(emergency, /title=\{/)
  assert.match(page, /title="SMS check result"/)
  assert.doesNotMatch(emergency, /Matches:/)
  assert.doesNotMatch(emergency, /route\.status\}.*route\.profile/s)
})
