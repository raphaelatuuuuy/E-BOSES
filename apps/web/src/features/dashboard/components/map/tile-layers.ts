import type leaflet from "leaflet"
import { loadOfflineSosConfig } from "@/features/dashboard/components/sos/offline-sos-config"

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
export const OSM_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"

export const CARTO_TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  voyager: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
} as const

export type MapBaseTone = keyof typeof CARTO_TILE_URLS

export function cartoTileUrl(tone: MapBaseTone): string {
  const key = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim()
  const url = CARTO_TILE_URLS[tone]
  return key ? `${url}?key=${encodeURIComponent(key)}` : OSM_TILE_URL
}

function hasCartoBasemapKey() {
  return Boolean(import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim())
}

export function addBaseTiles(
  L: typeof leaflet,
  map: leaflet.Map,
  tone: MapBaseTone,
  overrides: Partial<leaflet.TileLayerOptions> = {},
): leaflet.TileLayer {
  const usingCarto = hasCartoBasemapKey()
  const tiles = L.tileLayer(cartoTileUrl(tone), {
    attribution: usingCarto ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION,
    maxZoom: 20,
    subdomains: usingCarto ? "abcd" : "abc",
    keepBuffer: 2,
    updateWhenIdle: true,
    crossOrigin: true,
    ...overrides,
  }).addTo(map)
  let fallback: leaflet.LayerGroup | null = null
  let fallbackTimer: number | null = null
  let tileHasLoaded = false
  const offlineAttribution = "Offline street map · saved service-area data"
  const removeFallback = () => {
    if (!fallback) return
    fallback.remove()
    fallback = null
    map.attributionControl?.removeAttribution(offlineAttribution)
  }
  const showFallback = () => {
    // A single transient tile error is normal while Leaflet pans or zooms.
    // Only draw the offline reference map when no tile has loaded at all.
    if (fallback || tileHasLoaded) return
    const config = loadOfflineSosConfig()
    const communities = config.communities ?? [config.community]
    if (!communities.length) return
    if (!map.getPane("offlineStreets")) {
      const pane = map.createPane("offlineStreets")
      pane.style.zIndex = "190"
      pane.style.pointerEvents = "none"
    }
    fallback = L.layerGroup().addTo(map)
    for (const community of communities) {
      for (const street of community.streets) {
        for (const path of street.paths?.length ? street.paths : [street.points]) {
          if (path.length < 2) continue
          // Keep the saved roads as a quiet fallback reference. Permanent
          // labels are intentionally omitted: several segmented roads can
          // share the same center and would pile up into cards over the pin.
          L.polyline(path, { pane: "offlineStreets", color: "#ffffff", weight: 5, interactive: false }).addTo(fallback)
        }
      }
    }
    map.attributionControl?.addAttribution(offlineAttribution)
  }
  tiles.on("tileload", () => {
    tileHasLoaded = true
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    fallbackTimer = null
    removeFallback()
  })
  tiles.on("tileerror", () => {
    if (!navigator.onLine) {
      showFallback()
      return
    }
    if (tileHasLoaded || fallbackTimer != null) return
    // Give the normal layer time to load another tile before declaring the map
    // unavailable. This is what prevents one flaky request from creating a
    // stack of permanent street labels over an otherwise healthy map.
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null
      showFallback()
    }, 1800)
  })
  if (!navigator.onLine) showFallback()

  // Leaflet can create its tile grid while the map is still hidden or has a
  // zero-sized parent (for example while a dialog/page transition settles).
  // In that state the map pane is grey until a later zoom forces Leaflet to
  // recalculate the grid. Repaint after the container gets a real size so the
  // first online render does not depend on user interaction.
  let repaintFrame: number | null = null
  let initialPaintTimer: number | null = null
  let settledPaintTimer: number | null = null
  let hasUsableSize = false
  let lastSize = ""
  const repaint = () => {
    repaintFrame = null
    const box = map.getContainer().getBoundingClientRect()
    if (!box.width || !box.height) return

    const size = `${Math.round(box.width)}x${Math.round(box.height)}`
    const sizeChanged = size !== lastSize
    const wasCollapsed = !hasUsableSize
    map.invalidateSize({ animate: false })
    if (wasCollapsed || sizeChanged) {
      tiles.redraw()
    }
    if (wasCollapsed) {
      const zoom = map.getZoom()
      map.setZoom(zoom, { animate: false })
    }
    hasUsableSize = true
    lastSize = size
  }
  const scheduleRepaint = () => {
    if (repaintFrame != null) window.cancelAnimationFrame(repaintFrame)
    repaintFrame = window.requestAnimationFrame(repaint)
  }
  const refresh = () => {
    tiles.redraw()
    scheduleRepaint()
  }
  window.addEventListener("online", refresh)
  const observer = new ResizeObserver(scheduleRepaint)
  observer.observe(map.getContainer())
  scheduleRepaint()
  initialPaintTimer = window.setTimeout(scheduleRepaint, 120)
  settledPaintTimer = window.setTimeout(scheduleRepaint, 320)
  map.once("unload", () => {
    window.removeEventListener("online", refresh)
    if (fallbackTimer != null) window.clearTimeout(fallbackTimer)
    if (repaintFrame != null) window.cancelAnimationFrame(repaintFrame)
    if (initialPaintTimer != null) window.clearTimeout(initialPaintTimer)
    if (settledPaintTimer != null) window.clearTimeout(settledPaintTimer)
    fallbackTimer = null
    repaintFrame = null
    initialPaintTimer = null
    settledPaintTimer = null
    removeFallback()
    observer.disconnect()
  })
  return tiles
}
