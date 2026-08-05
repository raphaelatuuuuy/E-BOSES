/**
 * Geocoding, proxied through the E-Boses API.
 *
 * Never call nominatim.openstreetmap.org from the browser:
 *
 *  - A browser cannot set User-Agent, which Nominatim's usage policy requires,
 *    so it throttles by IP. One barangay behind one public IP hits 429 quickly.
 *  - A 429 response carries no CORS headers, so the failure surfaces as a
 *    confusing "blocked by CORS policy" rather than "you are rate limited".
 *  - Setting a User-Agent header anyway makes the request non-simple and
 *    triggers a preflight that Nominatim does not answer.
 *
 * The server identifies itself properly, caches results for 30 days and paces
 * calls to one per second.
 */

export interface NominatimReverseResult {
  display_name?: string
  name?: string
  address?: Record<string, string>
}

export interface NominatimSearchRow {
  lat?: string
  lon?: string
  display_name?: string
}

/** Raw reverse-geocode payload, or null when lookup is unavailable. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  zoom = 18,
): Promise<NominatimReverseResult | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    zoom: String(zoom),
  })
  try {
    const response = await fetch(`/api/locations/geocode/reverse/?${params}`, {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return null
    const envelope = (await response.json()) as {
      ok?: boolean
      result?: NominatimReverseResult | null
    }
    return envelope.ok ? (envelope.result ?? null) : null
  } catch {
    return null
  }
}

/** Forward-geocode a place name. Empty array when unavailable. */
export async function searchGeocode(
  query: string,
  limit = 1,
): Promise<NominatimSearchRow[]> {
  const trimmed = query.trim()
  if (trimmed.length < 3) return []
  const params = new URLSearchParams({ q: trimmed, limit: String(limit) })
  try {
    const response = await fetch(`/api/locations/geocode/search/?${params}`, {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) return []
    const envelope = (await response.json()) as { results?: NominatimSearchRow[] }
    return envelope.results ?? []
  } catch {
    return []
  }
}
