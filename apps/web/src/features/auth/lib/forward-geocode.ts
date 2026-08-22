/** Default center of Barangay Marikina Heights when geocoding fails. */
export const MARIKINA_HEIGHTS_CENTER = {
  lat: 14.6525,
  lng: 121.1168,
} as const

export interface StreetCoordinates {
  lat: number
  lng: number
  displayName: string
}

const geocodeCache = new Map<string, StreetCoordinates | null>()
const GEOCODE_CACHE_MAX = 300

/**
 * Forward-geocode a Marikina Heights street (and optional house number)
 * via OpenStreetMap Nominatim so the map pin sits on the actual road.
 */
export async function geocodeMarikinaStreet(
  street: string,
  houseNumber?: string,
): Promise<StreetCoordinates | null> {
  const house = houseNumber?.trim()
  const streetName = street?.trim()
  if (!streetName) return null

  const cacheKey = `${house ?? ""}|${streetName.toLowerCase()}`
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null
  }

  const queries = [
    [house, streetName, "Marikina Heights", "Marikina City", "Metro Manila", "Philippines"]
      .filter(Boolean)
      .join(", "),
    [streetName, "Marikina Heights", "Marikina", "Philippines"].join(", "),
    [streetName, "Marikina City", "Philippines"].join(", "),
  ]

  for (const q of queries) {
    // Same reason as reverse-geocode.ts: proxied so Nominatim sees an
    // identified, cached, rate-paced client instead of every resident's browser.
    const params = new URLSearchParams({ q, limit: "1" })
    try {
      const response = await fetch(
        `/api/locations/geocode/search/?${params.toString()}`,
        {
          headers: { Accept: "application/json" },
        },
      )
      if (!response.ok) continue
      const envelope = (await response.json()) as {
        ok?: boolean
        results?: Array<{ lat?: string; lon?: string; display_name?: string }>
      }
      const rows = envelope.results ?? []
      const hit = rows?.[0]
      const lat = Number(hit?.lat)
      const lng = Number(hit?.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      // Stay roughly in Marikina area
      if (lat < 14.6 || lat > 14.7 || lng < 121.05 || lng > 121.2) continue
      const result = {
        lat,
        lng,
        displayName: hit?.display_name || streetName,
      }
      if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
        geocodeCache.delete(geocodeCache.keys().next().value as string)
      }
      geocodeCache.set(cacheKey, result)
      return result
    } catch {
      // try next query
    }
  }
  if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
    geocodeCache.delete(geocodeCache.keys().next().value as string)
  }
  geocodeCache.set(cacheKey, null)
  return null
}
