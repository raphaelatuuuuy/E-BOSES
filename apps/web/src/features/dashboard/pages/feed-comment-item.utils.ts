import type { PublicUser } from "@/features/dashboard/api"

export function streetLabelFromAddress(address?: string | null) {
  if (!address?.trim()) return null
  const first = address.split(",")[0]?.trim()
  if (!first || first.toLowerCase() === "pending") return null
  return first
}

const BARANGAY = "Marikina Heights"

export function commentPlaceLabel(author: PublicUser) {
  const street =
    streetLabelFromAddress(author.street) ||
    (author.street && author.street.toLowerCase() !== "pending" ? author.street : null)
  if (street && street.toLowerCase() !== BARANGAY.toLowerCase()) return street
  if (author.barangay && author.barangay.toLowerCase() !== "pending") return author.barangay
  return BARANGAY
}
