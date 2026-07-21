const SMS_RECIPIENT_PATTERN = /^\+?\d{7,15}$/

export function buildEmergencySmsHref(
  configuredRecipient: string,
  message: string
) {
  const recipient = configuredRecipient.trim().replace(/[\s().-]/g, "")
  const body = message.trim()

  if (!SMS_RECIPIENT_PATTERN.test(recipient) || !body) return ""

  return `sms:${recipient}?body=${encodeURIComponent(body)}`
}

export function buildPinnedCoordinateAddress(lat: number, lng: number) {
  const coordinates = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
  return {
    primary: "Pinned coordinates",
    full: `Pinned coordinates: ${coordinates}`,
  }
}

export function isSosLocationReady(
  value: {
    lat: number
    lng: number
    address?: string
    addressPrimary?: string
  } | null
) {
  if (!value) return false
  const primary = (value.addressPrimary || value.address || "").trim()
  if (!primary || primary === "Move pin to a street") return false
  if (/^lat\b/i.test(primary)) return false
  return Number.isFinite(value.lat) && Number.isFinite(value.lng)
}
