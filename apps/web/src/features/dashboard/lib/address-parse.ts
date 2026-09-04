// apps/web/src/features/dashboard/lib/address-parse.ts

/** Split stored "123 Street, community, city" into street + house. */
export function parseStoredAddress(address: string): {
  street: string
  houseNumber: string
} {
  const raw = address.trim()
  if (!raw || raw.toLowerCase() === "pending") {
    return { street: "", houseNumber: "" }
  }

  const primary = raw.split(",")[0]?.trim() || raw
  const match = primary.match(/^(\d+[A-Za-z]?(?:\s*[-/]\s*[\dA-Za-z]+)?)\s+(.+)$/)
  return match
    ? { street: match[2]!.trim(), houseNumber: match[1]!.trim() }
    : { street: primary, houseNumber: "" }
}
