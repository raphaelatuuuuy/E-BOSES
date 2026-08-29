// A "14.648073, 121.119719" pair, or a machine sentinel stored as an address.
const COORDINATE_RE = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/
// "Pending" is a legacy DB default that leaked into location fields (barangay,
// address). It is not a place; skip it like the machine sentinels.
const LOCATION_SENTINELS = [
  "sms fallback coordinates",
  "pinned coordinates",
  "pinned location",
  "community pending confirmation",
  "pending",
]

/**
 * True when a location string is raw coordinates or a machine sentinel.
 *
 * "Pinned coordinates: 14.648073, 121.119719" and "SMS fallback coordinates"
 * are noise to a responder — they cannot drive to a number pair. Mirrors the
 * backend `is_machine_location` so the client agrees with the server.
 */
export function looksLikeCoordinates(text?: string | null): boolean {
  const value = (text || "").trim().toLowerCase()
  if (!value) return true
  if (LOCATION_SENTINELS.some((sentinel) => value === sentinel || value.startsWith(sentinel))) return true
  return COORDINATE_RE.test(value)
}

/**
 * The first candidate that reads as a real place, never a coordinate string.
 * Falls back to a plain sentence rather than leaking numbers.
 */
// Barangay names that may be stored as a suffix on a location string. The whole
// app is one barangay, so the suffix is redundant and is stripped so every
// queue row reads the same way: "2 Champaca Street", never "2 Champaca
// Street, Marikina Heights". Mirrors the backend `street_location`.
const BARANGAY_SUFFIXES = ["marikina heights", "marist village"]

/**
 * Reduce a display location to its street form, sans barangay suffix.
 *
 * The same emergency can store "2 Champaca Street", "Champaca Street,
 * Marikina Heights", or "Mansanas Street, Marist Village" depending on which
 * source wrote it. This normalizes all of them to the street part only.
 */
export function streetOnly(text?: string | null): string {
  const value = (text || "").trim()
  if (!value || looksLikeCoordinates(value)) return ""
  const lowered = value.toLowerCase()
  for (const suffix of BARANGAY_SUFFIXES) {
    if (lowered.endsWith(`, ${suffix}`)) {
      return value.slice(0, value.length - suffix.length - 2).trim().replace(/,+$/, "").trim()
    }
  }
  return value
}

// Segments that name the area rather than the street. A stored address is
// "<street>, Marikina Heights, Marikina City", and when geocoding could not
// resolve a road the street half is simply missing, leaving "Marikina Heights,
// Marikina City". Showing that as the street reads as a duplicate of the
// barangay the resident is already in.
const AREA_SEGMENTS = [...BARANGAY_SUFFIXES, "marikina city", "marikina", "metro manila"]

/**
 * The street part of a stored address, or "" when it only names the area.
 *
 * Unlike `streetOnly` this drops the area segments wherever they appear, so
 * "Marikina Heights, Marikina City" yields "" rather than echoing the barangay.
 */
export function streetSegment(text?: string | null): string {
  const value = (text || "").trim()
  if (!value || looksLikeCoordinates(value)) return ""
  for (const part of value.split(",")) {
    const segment = part.trim().replace(/,+$/, "").trim()
    if (!segment) continue
    if (AREA_SEGMENTS.includes(segment.toLowerCase())) continue
    return segment
  }
  return ""
}

/**
 * The first candidate that reads as a real place, never a coordinate string.
 * Falls back to a plain sentence rather than leaking numbers.
 */
export function readableLocation(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const value = (candidate || "").trim()
    if (value && !looksLikeCoordinates(value)) return value
  }
  return "Location pinned on the map"
}
