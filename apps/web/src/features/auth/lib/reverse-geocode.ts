import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"

export interface ReverseGeocodeResult {
  ok: boolean
  street: string | null
  displayName: string
  message: string
  houseNumber?: string
}

interface NominatimAddress {
  road?: string
  pedestrian?: string
  path?: string
  residential?: string
  suburb?: string
  neighbourhood?: string
  village?: string
  city?: string
  municipality?: string
  town?: string
  county?: string
  state?: string
  house_number?: string
}

interface NominatimResponse {
  display_name?: string
  address?: NominatimAddress
}

function isInMarikinaArea(address: NominatimAddress | undefined, displayName: string) {
  const blob = [
    address?.suburb,
    address?.neighbourhood,
    address?.village,
    address?.city,
    address?.municipality,
    address?.town,
    address?.county,
    address?.state,
    displayName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return blob.includes("marikina")
}

/**
 * Reverse-geocode lat/lng via OpenStreetMap Nominatim and match to
 * curated Marikina Heights streets.
 */
export async function reverseGeocodeToMarikinaStreet(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(latitude),
    lon: String(longitude),
    zoom: "18",
    addressdetails: "1",
  })

  let response: Response
  try {
    response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    })
  } catch {
    return {
      ok: false,
      street: null,
      displayName: "",
      message:
        "Could not look up your location. Check your connection and pick your street from the list.",
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      street: null,
      displayName: "",
      message: "Location lookup failed. Please select your street from the list.",
    }
  }

  const data = (await response.json()) as NominatimResponse
  const displayName = data.display_name ?? ""
  const address = data.address

  if (!isInMarikinaArea(address, displayName)) {
    return {
      ok: false,
      street: null,
      displayName,
      message:
        "Your current location is outside Marikina Heights. Please select your street from the list.",
    }
  }

  const roadCandidates = [
    address?.road,
    address?.pedestrian,
    address?.residential,
    address?.path,
  ].filter((value): value is string => Boolean(value?.trim()))

  for (const candidate of roadCandidates) {
    const matched = matchMarikinaHeightsStreet(candidate)
    if (matched) {
      return {
        ok: true,
        street: matched,
        displayName,
        houseNumber: address?.house_number,
        message: "",
      }
    }
  }

  // Fallback: try matching against full display name segments
  for (const part of displayName.split(",").map((p) => p.trim())) {
    const matched = matchMarikinaHeightsStreet(part)
    if (matched) {
      return {
        ok: true,
        street: matched,
        displayName,
        houseNumber: address?.house_number,
        message: "",
      }
    }
  }

  return {
    ok: false,
    street: null,
    displayName,
    message:
      "We couldn't match your location to a Marikina Heights street. Please pick your street from the list.",
  }
}

export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    })
  })
}
