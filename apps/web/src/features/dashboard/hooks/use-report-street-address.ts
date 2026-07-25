"use client"

import { useGeocodeStreet } from "@/features/dashboard/hooks/use-geocode-street"
import { streetFromStoredAddress } from "@/features/dashboard/utils/report-location-map-utils"

export function useReportStreetAddress(opts: {
  address?: string | null
  barangay?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
}) {
  const lat = Number(opts.latitude)
  const lng = Number(opts.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const fromDb = streetFromStoredAddress(opts.address)

  const geocodeStreet = useGeocodeStreet(lat, lng, hasCoords && !fromDb)

  if (fromDb) return fromDb
  if (!hasCoords) return "No address on file"
  return geocodeStreet
}