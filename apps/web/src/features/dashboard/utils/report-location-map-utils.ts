/** Values that are not a real street line for residents. */
function looksLikeCoordOrPlaceholder(value?: string | null) {
  if (!value?.trim()) return true
  const v = value.trim().toLowerCase()
  if (v === "pending") return true
  if (v === "marikina heights" || v === "marikina" || v === "marikina city") return true
  if (v === "pinned location" || v === "selected location" || v === "street unavailable") return true
  if (/^lat\b/.test(v) || /\blng\b/.test(v)) return true
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(v)) return true
  return false
}

export function isUsableReportAddress(value?: string | null) {
  return !looksLikeCoordOrPlaceholder(value)
}

/** Street line from DB address (first segment before comma). */
export function streetFromStoredAddress(address?: string | null) {
  if (!isUsableReportAddress(address)) return null
  return address!.split(",")[0]?.trim() || address!.trim()
}
