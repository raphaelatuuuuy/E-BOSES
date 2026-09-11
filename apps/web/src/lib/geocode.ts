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

const REVERSE_CACHE_TTL_MS = 30 * 60 * 1000
const REVERSE_FAILURE_CACHE_TTL_MS = 15_000
const MAX_REVERSE_CACHE_ENTRIES = 256
const reverseCache = new Map<
  string,
  { value: NominatimReverseResult | null; expiresAt: number }
>()
const reverseRequests = new Map<
  string,
  Promise<NominatimReverseResult | null>
>()

function reverseKey(lat: number, lng: number, zoom: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${zoom}`
}

/** Raw reverse-geocode payload, or null when lookup is unavailable. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  zoom = 18,
): Promise<NominatimReverseResult | null> {
  const key = reverseKey(lat, lng, zoom)
  const cached = reverseCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) reverseCache.delete(key)
  const pending = reverseRequests.get(key)
  if (pending) return pending

  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    zoom: String(zoom),
  })
  const request = (async () => {
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
  })()

  reverseRequests.set(key, request)
  try {
    const value = await request
    reverseCache.set(key, {
      value,
      expiresAt:
        Date.now() +
        (value ? REVERSE_CACHE_TTL_MS : REVERSE_FAILURE_CACHE_TTL_MS),
    })
    while (reverseCache.size > MAX_REVERSE_CACHE_ENTRIES) {
      const oldest = reverseCache.keys().next().value
      if (oldest) reverseCache.delete(oldest)
      else break
    }
    return value
  } finally {
    reverseRequests.delete(key)
  }
}

export interface AddressParts {
  primary: string
  secondary: string
  full: string
}

/** Format a raw reverse-geocode payload into display-ready address parts. */
export function formatNominatimParts(data: {
  address?: Record<string, string>
  display_name?: string
}): AddressParts {
  const a = data.address ?? {}
  const house = a.house_number
  const road = a.road || a.pedestrian || a.path || a.residential
  const primary =
    house && road
      ? `${house} ${road}`
      : road ||
        a.neighbourhood ||
        a.suburb ||
        a.village ||
        a.town ||
        a.city ||
        (data.display_name ?? "").split(",")[0]?.trim() ||
        "Selected location"

  const secondaryBits = [
    a.suburb || a.neighbourhood || a.village,
    a.city || a.town || a.municipality || a.city_district,
  ].filter(Boolean) as string[]
  const secondary = secondaryBits
    .filter((part, i, arr) => part !== primary && arr.indexOf(part) === i)
    .slice(0, 2)
    .join(", ")

  return {
    primary,
    secondary,
    full: secondary ? `${primary}, ${secondary}` : primary,
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
