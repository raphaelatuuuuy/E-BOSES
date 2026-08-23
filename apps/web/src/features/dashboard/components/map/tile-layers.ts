import type leaflet from "leaflet"

export const CARTO_ATTRIBUTION = "&copy; OpenStreetMap contributors &copy; CARTO"

export const CARTO_TILE_URLS = {
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
} as const

export type MapBaseTone = keyof typeof CARTO_TILE_URLS

export function addBaseTiles(
  L: typeof leaflet,
  map: leaflet.Map,
  tone: MapBaseTone,
  overrides: Partial<leaflet.TileLayerOptions> = {},
): leaflet.TileLayer {
  return L.tileLayer(CARTO_TILE_URLS[tone], {
    attribution: CARTO_ATTRIBUTION,
    maxZoom: 20,
    subdomains: "abcd",
    keepBuffer: 2,
    updateWhenIdle: true,
    ...overrides,
  }).addTo(map)
}
