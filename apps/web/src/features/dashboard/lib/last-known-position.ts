/**
 * The last GPS fix this device produced, kept across a signal drop and across
 * a reload.
 *
 * A responder who walks into a covered car park used to lose their pin and
 * their route entirely — the map went blank at exactly the moment it mattered.
 * Holding the last fix keeps both on screen; `isPositionStale` is what stops
 * that from becoming a lie, by letting the surface mark a remembered position
 * as remembered rather than drawing it as live.
 */

const STORAGE_PREFIX = "eboses:last-known-position"

/**
 * Namespaced per account. Responders share devices, and an unnamespaced key
 * meant the next person to sign in was seeded with the last one's position.
 */
function storageKey(userId: number | null | undefined) {
  return userId == null ? `${STORAGE_PREFIX}:anon` : `${STORAGE_PREFIX}:${userId}`
}

/** Past this, a stored fix describes where you were, not where you are. */
export const POSITION_STALE_AFTER_MS = 60_000

export interface KnownPosition {
  latitude: number
  longitude: number
  accuracy: number | null
  /** Epoch ms of the fix itself, not of when it was stored. */
  at: number
}

export const GPS_FIX_MAX_AGE_MS = 60_000
export const GPS_FIX_MAX_ACCURACY_METERS = 1_000

export function isFreshGeolocationPosition(
  position: GeolocationPosition,
  now = Date.now(),
) {
  const timestamp = Number(position.timestamp)
  const age = timestamp > 0 ? now - timestamp : 0
  const accuracy = Number(position.coords.accuracy)
  return (
    age >= -5_000 &&
    age <= GPS_FIX_MAX_AGE_MS &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= GPS_FIX_MAX_ACCURACY_METERS
  )
}

function isUsable(value: unknown): value is KnownPosition {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<KnownPosition>
  return (
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude) &&
    Number.isFinite(candidate.at)
  )
}

export function toKnownPosition(position: GeolocationPosition): KnownPosition {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    at: position.timestamp || Date.now(),
  }
}

export function readLastKnownPosition(userId: number | null | undefined): KnownPosition | null {
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isUsable(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeLastKnownPosition(
  position: GeolocationPosition,
  userId: number | null | undefined,
): KnownPosition {
  const known = toKnownPosition(position)
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(known))
  } catch {
    // Private mode or a full quota. The in-memory value still works for this
    // session; only surviving a reload is lost.
  }
  return known
}

/** Called on sign-out: a position must not outlive the session that made it. */
export function clearLastKnownPositions() {
  try {
    const stale: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && key.startsWith(STORAGE_PREFIX)) stale.push(key)
    }
    stale.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function isPositionStale(position: KnownPosition | null, now = Date.now()) {
  if (!position) return false
  return now - position.at > POSITION_STALE_AFTER_MS
}

/** "10:13 AM". */
export function formatFixTime(at: number) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(at))
}

/** "Last found: 10:13 AM", or today's date too once it is no longer today. */
export function lastFoundLabel(at: number, now = Date.now()) {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString()
  if (sameDay) return `Last found: ${formatFixTime(at)}`
  return `Last found: ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(at))}, ${formatFixTime(at)}`
}
