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

/**
 * Reverse-geocode lat/lng via OpenStreetMap Nominatim and match to
 * curated Marikina Heights streets.
 */
export async function reverseGeocodeToMarikinaStreet(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  // Routed through our own API. Calling Nominatim from the browser cannot set a
  // User-Agent, so it throttles the barangay's whole public IP to 429 - and a
  // 429 carries no CORS headers, which surfaces as a misleading CORS error.
  // The server identifies itself, caches for 30 days and paces requests.
  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
    zoom: "18",
  })

  let response: Response
  try {
    response = await fetch(`/api/locations/geocode/reverse/?${params.toString()}`, {
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

  const envelope = (await response.json()) as { ok?: boolean; result?: NominatimResponse | null }
  const data = envelope.result ?? {}
  if (!envelope.ok || !envelope.result) {
    return {
      ok: false,
      street: null,
      displayName: "",
      message: "Street lookup is unavailable. Your exact pinned coordinates can still be sent.",
    }
  }
  const displayName = data.display_name ?? ""
  const address = data.address

  const roadCandidates = [
    address?.road,
    address?.pedestrian,
    address?.residential,
    address?.path,
  ].filter((value): value is string => Boolean(value?.trim()))

  for (const candidate of roadCandidates) {
    const matched = matchMarikinaHeightsStreet(candidate)
    if (matched || candidate.trim()) {
      return {
        ok: true,
        street: matched || candidate.trim(),
        displayName,
        houseNumber: address?.house_number,
        message: "",
      }
    }
  }

  // Fallback: only match display-name segments that look like roads
  // (skip "Eastern Manila District", "Marikina Heights", etc. — those
  // used to false-match short cores like "east" → East Drive Street).
  for (const part of displayName.split(",").map((p) => p.trim())) {
    if (!/\b(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|extension|ext\.?|boulevard|blvd\.?)\b/i.test(part)) {
      continue
    }
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
      "We couldn't find a street name. Please enter your address manually.",
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
