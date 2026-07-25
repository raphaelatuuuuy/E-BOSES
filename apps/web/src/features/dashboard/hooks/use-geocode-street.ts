"use client"

import useSWR from "swr"

import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"
import { reverseGeocodeToMarikinaStreet } from "@/features/auth/lib/reverse-geocode"

type NamedRoad = { name: string; lat: number; lng: number; distance: number }

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

async function nearestNamedRoads(lat: number, lng: number, radiusM = 150, signal?: AbortSignal): Promise<NamedRoad[]> {
  const query = `
    [out:json][timeout:12];
    way["highway"]["name"](around:${radiusM},${lat},${lng});
    out tags center 20;
  `
  try {
    if (signal?.aborted) return []
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      elements?: Array<{
        tags?: { name?: string }
        center?: { lat: number; lon: number }
        lat?: number
        lon?: number
      }>
    }
    const roads: NamedRoad[] = []
    for (const el of data.elements ?? []) {
      const name = el.tags?.name?.trim()
      if (!name) continue
      const rLat = el.center?.lat ?? el.lat
      const rLng = el.center?.lon ?? el.lon
      if (rLat == null || rLng == null) continue
      roads.push({
        name,
        lat: rLat,
        lng: rLng,
        distance: haversineMeters(lat, lng, rLat, rLng),
      })
    }
    roads.sort((a, b) => a.distance - b.distance)
    return roads
  } catch {
    return []
  }
}

async function reverseGeocodeStreet(lat: number, lng: number, signal?: AbortSignal): Promise<string> {
  try {
    const matched = await reverseGeocodeToMarikinaStreet(lat, lng)
    if (signal?.aborted) return "Street unavailable"
    if (matched.ok && matched.street) {
      if (matched.houseNumber) return `${matched.houseNumber} ${matched.street}`
      return matched.street
    }
  } catch {
    /* continue */
  }

  let nominatimRoad: string
  let house: string
  try {
    if (signal?.aborted) return "Street unavailable"
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=18`
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "E-Boses/1.0 (barangay-concern-reports)",
      },
    })
    if (res.ok) {
      const data = (await res.json()) as {
        name?: string
        address?: Record<string, string>
      }
      if (signal?.aborted) return "Street unavailable"
      const a = data.address ?? {}
      house = a.house_number?.trim() || ""
      nominatimRoad = (
        data.name ||
        a.road ||
        a.pedestrian ||
        a.path ||
        a.residential ||
        ""
      ).trim()
      if (nominatimRoad) {
        const curated = matchMarikinaHeightsStreet(nominatimRoad)
        const label = curated || nominatimRoad
        return house ? `${house} ${label}` : label
      }
    }
  } catch {
    /* continue */
  }

  if (signal?.aborted) return "Street unavailable"
  const nearby = await nearestNamedRoads(lat, lng, 150, signal)
  for (const road of nearby) {
    const curated = matchMarikinaHeightsStreet(road.name)
    if (curated) return curated
  }
  if (nearby[0]?.name) return nearby[0].name

  return "Street unavailable"
}

function useStreetGeocode(lat: number, lng: number, enabled: boolean) {
  const key = enabled ? [lat, lng] : null
  const { data: street } = useSWR(
    key,
    ([l, g]) => reverseGeocodeStreet(l, g),
    { fallbackData: "Finding street…" },
  )

  return street ?? "Finding street…"
}

export function useGeocodeStreet(lat: number, lng: number, enabled: boolean) {
  return useStreetGeocode(lat, lng, enabled)
}