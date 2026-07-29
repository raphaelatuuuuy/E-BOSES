import type leaflet from "leaflet"

/**
 * One definition of how a responder route is drawn, everywhere.
 *
 * Five surfaces render road geometry — the alert map, the incident board, the
 * responder field map, the resident tracking sheet, and the straight-line
 * fallback each of them uses when OSM returns no route. Each had invented its
 * own colour, weight and dash pattern (`"6 7"`, `"1 8"`, `"7 7"`, `"8 4"`,
 * sometimes none at all), so the same journey looked like a different kind of
 * object depending on which screen you opened.
 *
 * The rule this encodes:
 *
 *   LIVE  — a responder is currently travelling to an open incident.
 *           Blue, and the dashes crawl toward the incident. Motion is the
 *           signal; direction carries the meaning.
 *
 *   IDLE  — resolved, cancelled, stood down, or simply not the incident in
 *           focus. Grey and completely still.
 *
 * Motion is deliberately scarce in this console: the live pulse and this dash
 * are the only two things that move without user input. A route that keeps
 * animating after the incident closes spends that signal for nothing, which is
 * exactly what made the old maps feel busy.
 */

/** Applied to the rendered SVG path; the keyframes live in globals.css. */
export const ROUTE_LIVE_CLASS = "ops-route-dash"

export interface RouteLineOptions {
  /** True only while a responder is actually en route to an open incident. */
  live: boolean
  /** Road geometry vs. the straight-line fallback when routing is unavailable. */
  approximate?: boolean
  weight?: number
}

export function routeLineStyle({
  live,
  approximate = false,
  weight,
}: RouteLineOptions): leaflet.PolylineOptions {
  return {
    color: live ? "var(--color-map-responder)" : "var(--color-map-route-idle)",
    // The fallback line is thinner and fainter: it is a bearing, not a route,
    // and should never read as "this is the path they will take".
    weight: weight ?? (approximate ? 2 : 3),
    opacity: live ? (approximate ? 0.6 : 0.9) : 0.45,
    dashArray: approximate ? "2 7" : "1 8",
    lineCap: "round",
    interactive: false,
  }
}

/**
 * Toggle the crawl animation on an already-added layer.
 *
 * Leaflet only creates the underlying SVG element once the layer is on a map,
 * so this must run after `addTo()`. Safe to call with `live: false` — it clears
 * the class rather than assuming a fresh element.
 */
export function applyRouteMotion(layer: leaflet.Path, live: boolean) {
  const element = layer.getElement()
  if (!element) return
  element.classList.toggle(ROUTE_LIVE_CLASS, live)
}

/** Same, for a GeoJSON layer that may wrap several path segments. */
export function applyRouteMotionAll(group: leaflet.GeoJSON, live: boolean) {
  group.getLayers().forEach((layer) => {
    applyRouteMotion(layer as leaflet.Path, live)
  })
}
