export const SOS_SMS_NUMBER = "09640746068"
export const SOS_CONFIG_VERSION = 2

export type OfflineStreet = {
  name: string
  points: Array<[number, number]>
  paths?: Array<Array<[number, number]>>
}

export type OfflineStreetEstimate = {
  name: string
  distanceMeters: number
  confidence: "high" | "medium"
  secondaryStreet: string
}

export type OfflineSosConfig = {
  version: number
  smsNumber: string
  community: {
    name: string
    bounds: {
      minLatitude: number
      maxLatitude: number
      minLongitude: number
      maxLongitude: number
    }
    boundaryPath: string
    acceptance: {
      centerLatitude: number
      centerLongitude: number
      radiusMeters: number
    }
    streets: OfflineStreet[]
  }
}

const STORAGE_KEY = "eboses:offline-sos-config:v2"

// Versioned, build-shipped fallback for the one-phone Marikina Heights pilot.
// The polygon is the locally stored simplified outline; the API refresh replaces
// it with the current active GeoJSON whenever a connection is available.
export const BASELINE_OFFLINE_SOS_CONFIG: OfflineSosConfig = {
  version: SOS_CONFIG_VERSION,
  smsNumber: SOS_SMS_NUMBER,
  community: {
    name: "Marikina Heights",
    bounds: {
      minLatitude: 14.6441,
      maxLatitude: 14.6599,
      minLongitude: 121.1104,
      maxLongitude: 121.1305,
    },
    boundaryPath:
      "M20 527.5L48.1 534.4L56.4 586.9L69.5 607.8L108.8 614.6L128.2 716.3L150.1 764.7L220 818.6L305.2 835L398.7 809.8L481.7 745.1L528 639.2L548.8 640.7L591.1 657.8L648.3 709.1L663.3 768.5L679.6 789.4L744.4 805.3L764 819.1L823.3 798.6L836.5 801.8L902.6 909.4L1003.1 613.4L1020 504.9L965.5 453.7L903.8 443.4L820 444L813.9 312.4L776.3 238.4L570.6 57L464.5 20L424.4 22.7L402.7 175.3L276.9 177.7L245 196.5L220.1 226.7L188.5 306.8L187.7 408.5L174.1 449.5L106.3 472.5L60.2 433.7L43.5 433.3L58.9 447.5L41.9 459.2L37.5 504.4L23.5 503.5Z",
    acceptance: {
      centerLatitude: 14.6507,
      centerLongitude: 121.1133,
      radiusMeters: 800,
    },
    streets: [
      {
        name: "Champaca Street",
        points: [
          [14.6502, 121.111],
          [14.6507, 121.1148],
          [14.6512, 121.119],
        ],
      },
      {
        name: "Bayan-Bayanan Avenue",
        points: [
          [14.6574, 121.1115],
          [14.6556, 121.116],
          [14.6544, 121.1218],
          [14.6535, 121.127],
        ],
      },
      {
        name: "West Drive Street",
        points: [
          [14.6506, 121.1155],
          [14.6525, 121.1161],
          [14.6542, 121.1162],
          [14.6564, 121.1147],
        ],
      },
      {
        name: "Torres Bugallon Street",
        points: [
          [14.6485, 121.1123],
          [14.6492, 121.1142],
          [14.6518, 121.1116],
        ],
      },
      {
        name: "Tanguile Street",
        points: [
          [14.6491, 121.1249],
          [14.6502, 121.1263],
          [14.6519, 121.1268],
        ],
      },
    ],
  },
}

function validConfig(value: unknown): value is OfflineSosConfig {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<OfflineSosConfig>
  return (
    candidate.version === SOS_CONFIG_VERSION &&
    candidate.smsNumber === SOS_SMS_NUMBER &&
    Boolean(candidate.community?.bounds) &&
    Array.isArray(candidate.community?.streets)
  )
}

export function loadOfflineSosConfig(): OfflineSosConfig {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (validConfig(parsed)) return parsed
    }
  } catch {
    // Storage can be disabled in private browsing; the bundled copy still works.
  }
  return BASELINE_OFFLINE_SOS_CONFIG
}

export function cacheOfflineSosConfig(config: OfflineSosConfig) {
  if (!validConfig(config)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Best effort. Never block SOS because storage is full or unavailable.
  }
}

function pointToSegmentMeters(
  latitude: number,
  longitude: number,
  start: [number, number],
  end: [number, number]
) {
  const latitudeMeters = 111_320
  const longitudeMeters = 111_320 * Math.cos((latitude * Math.PI) / 180)
  const ax = (start[1] - longitude) * longitudeMeters
  const ay = (start[0] - latitude) * latitudeMeters
  const bx = (end[1] - longitude) * longitudeMeters
  const by = (end[0] - latitude) * latitudeMeters
  const abx = bx - ax
  const aby = by - ay
  const lengthSquared = abx * abx + aby * aby
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * abx + ay * aby) / lengthSquared))
  return Math.hypot(ax + abx * fraction, ay + aby * fraction)
}

function streetDistanceMeters(
  latitude: number,
  longitude: number,
  street: OfflineStreet
) {
  const paths = street.paths?.length ? street.paths : [street.points]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const path of paths) {
    if (path.length === 1) {
      bestDistance = Math.min(
        bestDistance,
        pointToSegmentMeters(latitude, longitude, path[0]!, path[0]!)
      )
      continue
    }
    for (let index = 1; index < path.length; index += 1) {
      bestDistance = Math.min(
        bestDistance,
        pointToSegmentMeters(
          latitude,
          longitude,
          path[index - 1]!,
          path[index]!
        )
      )
    }
  }
  return bestDistance
}

/**
 * Match a pin to cached road geometry without pretending the result is an
 * address. Distance is measured to the complete road segments, not just their
 * sampled vertices. Weak GPS fixes and distant/ambiguous matches are withheld.
 */
export function estimateOfflineStreet(
  latitude: number,
  longitude: number,
  accuracyMeters: number | null = null,
  config = loadOfflineSosConfig()
): OfflineStreetEstimate | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (
    accuracyMeters != null &&
    (!Number.isFinite(accuracyMeters) || accuracyMeters > 120)
  )
    return null

  const candidates = config.community.streets
    .map((street) => ({
      name: street.name.trim(),
      distanceMeters: streetDistanceMeters(latitude, longitude, street),
    }))
    .filter(
      (candidate) => candidate.name && Number.isFinite(candidate.distanceMeters)
    )
    .sort((left, right) => left.distanceMeters - right.distanceMeters)

  const first = candidates[0]
  if (!first) return null
  const reliableRadius =
    accuracyMeters == null
      ? 80
      : Math.min(90, Math.max(45, accuracyMeters + 25))
  if (first.distanceMeters > reliableRadius) return null

  const second = candidates.find((candidate) => candidate.name !== first.name)
  const intersectionTolerance = Math.max(12, Math.min(28, accuracyMeters ?? 12))
  const secondaryStreet =
    second &&
    second.distanceMeters <= reliableRadius &&
    second.distanceMeters - first.distanceMeters <= intersectionTolerance
      ? second.name
      : ""

  return {
    name: secondaryStreet ? `${first.name} / ${secondaryStreet}` : first.name,
    distanceMeters: first.distanceMeters,
    confidence:
      first.distanceMeters <= 25 &&
      (accuracyMeters == null || accuracyMeters <= 35)
        ? "high"
        : "medium",
    secondaryStreet,
  }
}

export function nearestOfflineStreet(
  latitude: number,
  longitude: number,
  config = loadOfflineSosConfig()
) {
  return estimateOfflineStreet(latitude, longitude, null, config)?.name ?? ""
}

export async function refreshOfflineSosConfig() {
  if (!navigator.onLine) return loadOfflineSosConfig()
  try {
    const response = await fetch("/api/public/offline-sos-config/", {
      credentials: "omit",
      cache: "no-store",
    })
    if (!response.ok) return loadOfflineSosConfig()
    const config: unknown = await response.json()
    if (validConfig(config)) cacheOfflineSosConfig(config)
  } catch {
    // The bundled/cached copy is the guaranteed path.
  }
  return loadOfflineSosConfig()
}
