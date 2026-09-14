/**
 * Turns an API failure into something a resident can act on.
 *
 * The server sends a machine `code` for logs and support plus a human `detail`.
 * This is the safety net for the case where a code slips through without one —
 * nobody should ever read "ip_blocked" on screen.
 */

export const ERROR_MESSAGES: Record<string, string> = {
  // Connection checks
  ip_blocked:
    "We could not verify your internet connection. Please turn off any VPN and try your home Wi-Fi or mobile data.",
  outside_philippines:
    "This service is only available inside the Philippines. If you are using a VPN, turn it off and try again.",
  vpn_or_proxy: "Please turn off your VPN or proxy and try again.",
  datacenter_or_hosting:
    "This connection looks like a server rather than a home or mobile network. Please use your home Wi-Fi or mobile data.",
  unknown_isp:
    "We could not recognise this network. Please try your home Wi-Fi or mobile data.",
  suspicious_network:
    "This connection was flagged as unsafe. Please try your home Wi-Fi or mobile data.",

  // Sign-in
  invalid_credentials:
    "That email or password did not match. Please try again.",
  account_rejected:
    "This account was not approved. Please contact your barangay office.",
  maintenance:
    "E-Boses is briefly unavailable while the barangay updates the system. Please try again shortly.",

  // Operations
  emergency_in_progress:
    "This cannot be done while an emergency is still active. Please try again once it is closed.",
  throttle: "You're doing that too often. Please wait a moment and try again.",
  too_many_attempts:
    "Too many attempts. Please wait a moment before trying again.",
  session_expired: "Your session expired. Please sign in again.",
  not_found: "The page you're looking for doesn't exist.",
  server_error: "Something went wrong on our end. Please try again.",
  sign_in_required: "Please sign in to continue.",

  // Report media validation
  automated_photo_mismatch:
    "The photo does not show the issue described in the report. Please submit a photo that clearly shows the reported issue.",

  // Identity verification
  ocr_name_mismatch:
    "The name on your ID does not match the name you entered. Please check the spelling and try again.",
  ocr_name_missing:
    "We could not read the name on your ID. Please retake the photo in good light, with the whole ID inside the frame.",
  document_number_required:
    "We could not read the ID number. Please retake the photo so the number is sharp and fully visible.",
  expiry_date_required:
    "We could not read the expiry date. Please retake the photo showing the whole ID.",
  expiry_date_not_expired: "That ID has expired. Please use a valid one.",
  full_name_required:
    "We could not read the full name on the document. Please retake the photo in good light.",
  place_of_birth_required:
    "We could not read the place of birth on the document. Please retake the photo.",
  barangay_issue_date_required:
    "We could not read the issue date on the barangay certificate. Please retake the photo.",
  barangay_civil_status_required:
    "We could not read the civil status on the barangay certificate. Please retake the photo.",
}

const FALLBACK = "Something went wrong. Please try again."

function looksLikeACode(text: string) {
  // "ip_blocked", "ocr_name_mismatch" — lowercase, underscores, no spaces.
  return /^[a-z][a-z0-9_]*$/.test(text.trim())
}

const DRF_DETAIL_MAP: Record<string, string> = {
  "Request was throttled. Expected available in":
    "You're doing that too often. Please wait a moment and try again.",
  "Authentication credentials were not provided.":
    "Please sign in to continue.",
  "Given token not valid for any token type.":
    "Your session expired. Please sign in again.",
  "Not found.": "The page you're looking for doesn't exist.",
  "Internal server error.":
    "Something went wrong on our end. Please try again.",
}

function friendlyDrfDetail(detail: string): string {
  const trimmed = detail.trim()
  for (const [needle, friendly] of Object.entries(DRF_DETAIL_MAP)) {
    if (trimmed.startsWith(needle) || trimmed === needle) return friendly
  }
  return trimmed
}

/**
 * Best human message for an API error payload.
 * Order: an explicit `detail` from the server, then a mapped `code`, then the
 * caller's fallback. A raw code is never returned.
 */
export function humanError(data: unknown, fallback = FALLBACK): string {
  if (!data || typeof data !== "object") return fallback

  const payload = data as Record<string, unknown>
  const detail = payload.detail
  if (typeof detail === "string" && detail.trim() && !looksLikeACode(detail)) {
    return friendlyDrfDetail(detail)
  }

  for (const key of ["code", "reason"]) {
    const value = payload[key]
    if (typeof value === "string" && ERROR_MESSAGES[value]) {
      return ERROR_MESSAGES[value]
    }
  }

  if (typeof detail === "string" && detail.trim()) {
    return ERROR_MESSAGES[detail.trim()] ?? friendlyDrfDetail(detail)
  }

  return fallback
}

/** Hotlines the server attaches when a block could hide an emergency. */
export function errorHotlines(
  data: unknown
): { label: string; number: string }[] {
  if (!data || typeof data !== "object") return []
  const hotlines = (data as { hotlines?: unknown }).hotlines
  if (!Array.isArray(hotlines)) return []
  return hotlines.filter(
    (item): item is { label: string; number: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { label?: unknown }).label === "string" &&
      typeof (item as { number?: unknown }).number === "string"
  )
}
