import type leaflet from "leaflet"

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
  return L.tileLayer(cartoTileUrl(tone), {
    attribution: CARTO_ATTRIBUTION,
    maxZoom: 20,
    subdomains: "abcd",
    keepBuffer: 2,
    updateWhenIdle: true,
    ...overrides,
  }).addTo(map)
}
