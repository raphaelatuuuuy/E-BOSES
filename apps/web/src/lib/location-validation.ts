import { apiRequest } from "./api"

export type LocationClassification = {
  status: "inside" | "edge" | "far" | string
  zone: string
  accepted: boolean
  warning: string | null
  message: string
  distance_meters: number | null
  acceptance_zone?: {
    within: boolean
    distance_meters?: number
    radius_meters?: number
  }
}

const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 128

const locationCache = new Map<
  string,
  { value: LocationClassification; expiresAt: number }
>()
const pendingRequests = new Map<string, Promise<LocationClassification>>()

function locationKey(latitude: number, longitude: number) {
  // Five decimal places is roughly one metre in this area. It prevents tiny
  // Leaflet rounding changes from creating a new POST for the same pin.
  return `${latitude.toFixed(5)},${longitude.toFixed(5)}`
}

/** Share cached and in-flight validation requests across all maps. */
export function validateLocation(latitude: number, longitude: number) {
  const key = locationKey(latitude, longitude)
  const cached = locationCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value)
  if (cached) locationCache.delete(key)

  const pending = pendingRequests.get(key)
  if (pending) return pending

  const request = apiRequest<LocationClassification>(
    "/locations/validate/",
    {
      method: "POST",
      body: JSON.stringify({ latitude, longitude }),
    },
    { auth: false },
  )
    .then((value) => {
      locationCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
      while (locationCache.size > MAX_CACHE_ENTRIES) {
        const oldest = locationCache.keys().next().value
        if (oldest) locationCache.delete(oldest)
        else break
      }
      return value
    })
    .finally(() => pendingRequests.delete(key))

  pendingRequests.set(key, request)
  return request
}
