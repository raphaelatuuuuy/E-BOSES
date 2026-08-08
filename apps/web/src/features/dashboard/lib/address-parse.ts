// apps/web/src/features/dashboard/lib/address-parse.ts

import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"

/** Split stored "123 Street, Marikina Heights, Marikina City" into street + house. */
export function parseStoredAddress(address: string): {
  street: string
  houseNumber: string
} {
  const raw = address.trim()
  if (!raw || raw.toLowerCase() === "pending") {
    return { street: "", houseNumber: "" }
  }

  const primary = raw.split(",")[0]?.trim() || raw
  const matched =
    matchMarikinaHeightsStreet(primary) || matchMarikinaHeightsStreet(raw)

  if (!matched) {
    return { street: primary, houseNumber: "" }
  }

  const idx = primary.toLowerCase().indexOf(matched.toLowerCase())
  const house = idx > 0 ? primary.slice(0, idx).trim() : ""
  return { street: matched, houseNumber: house }
}