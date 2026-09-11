import type leaflet from "leaflet"
import { loadOfflineSosConfig } from "@/features/dashboard/components/sos/offline-sos-config"

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'

export const CARTO_TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  voyager: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
} as const

export type MapBaseTone = keyof typeof CARTO_TILE_URLS

export function cartoTileUrl(tone: MapBaseTone): string {
  const key = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim()
  const url = CARTO_TILE_URLS[tone]
  return key ? `${url}?key=${encodeURIComponent(key)}` : url
}

export function addBaseTiles(
  L: typeof leaflet,
  map: leaflet.Map,
  tone: MapBaseTone,
  overrides: Partial<leaflet.TileLayerOptions> = {},
): leaflet.TileLayer {
  const tiles = L.tileLayer(cartoTileUrl(tone), {
    attribution: CARTO_ATTRIBUTION,
    maxZoom: 20,
    subdomains: "abcd",
    keepBuffer: 2,
    updateWhenIdle: true,
    crossOrigin: true,
    ...overrides,
  }).addTo(map)
  let fallback: leaflet.LayerGroup | null = null
  const showFallback = () => {
    if (fallback) return
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
      if (community.boundaryGeometry) {
        L.geoJSON(community.boundaryGeometry as GeoJSON.GeoJsonObject, {
          pane: "offlineStreets", interactive: false,
          style: { color: "#abb7ac", weight: 1, fillColor: "#f3f1e9", fillOpacity: 1 },
        }).addTo(fallback)
      } else {
        L.rectangle([
          [community.bounds.minLatitude, community.bounds.minLongitude],
          [community.bounds.maxLatitude, community.bounds.maxLongitude],
        ], {
          pane: "offlineStreets", interactive: false,
          color: "#abb7ac", weight: 1, fillColor: "#f3f1e9", fillOpacity: 1,
        }).addTo(fallback)
      }
      for (const street of community.streets) {
        for (const path of street.paths?.length ? street.paths : [street.points]) {
          if (path.length < 2) continue
          const road = L.polyline(path, { pane: "offlineStreets", color: "#ffffff", weight: 5, interactive: false }).addTo(fallback)
          const label = document.createElement("span")
          label.textContent = street.name
          road.bindTooltip(label, { permanent: true, direction: "center", className: "offline-street-label" })
        }
      }
    }
    map.attributionControl?.addAttribution("Offline street map · saved service-area data")
  }
  tiles.on("tileerror", showFallback)
  if (!navigator.onLine) showFallback()
  const refresh = () => tiles.redraw()
  window.addEventListener("online", refresh)
  const observer = new ResizeObserver(() => map.invalidateSize())
  observer.observe(map.getContainer())
  map.once("unload", () => {
    window.removeEventListener("online", refresh)
    observer.disconnect()
  })
  return tiles
}
