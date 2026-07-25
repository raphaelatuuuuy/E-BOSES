"use client"

import { useCallback, useEffect, useRef } from "react"

import { matchMarikinaHeightsStreet } from "@/features/auth/lib/marikina-heights-streets"
import { reverseGeocodeToMarikinaStreet } from "@/features/auth/lib/reverse-geocode"
import { buildPinnedCoordinateAddress } from "@/features/dashboard/components/sos-fallback"

export async function reverseStreet(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<{ primary: string; full: string }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return buildPinnedCoordinateAddress(lat, lng)
  }
  try {
    const matched = await reverseGeocodeToMarikinaStreet(lat, lng)
    if (signal?.aborted) return { primary: "Move pin to a street", full: "" }
    if (matched.ok && matched.street) {
      const primary = matched.houseNumber
        ? `${matched.houseNumber} ${matched.street}`
        : matched.street
      return { primary, full: `${primary}, Marikina Heights` }
    }
  } catch {
    /* fall through */
  }
  try {
    if (signal?.aborted) return { primary: "Move pin to a street", full: "" }
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
    const res = await fetch(url, {
      signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "E-Boses/1.0 (sos-location)",
      },
    })
    if (!res.ok) throw new Error("reverse failed")
    const data = (await res.json()) as {
      address?: Record<string, string>
      display_name?: string
    }
    const a = data.address ?? {}
    const road = (a.road || a.pedestrian || a.residential || "").trim()
    const curated = road ? matchMarikinaHeightsStreet(road) : null
    const primary =
      curated ||
      road ||
      (data.display_name ?? "").split(",")[0]?.trim() ||
      "Pinned location"
    if (
      /^lat\b/i.test(primary) ||
      primary.toLowerCase() === "marikina heights"
    ) {
      return { primary: "Move pin to a street", full: "" }
    }
    const secondary = a.suburb || a.neighbourhood || "Marikina Heights"
    return { primary, full: `${primary}, ${secondary}` }
  } catch {
    return buildPinnedCoordinateAddress(lat, lng)
  }
}

/**
 * Hook that provides a stable geocode function with automatic
 * AbortController management. Aborts any in-flight request when a new
 * one is issued, and aborts on unmount.
 */
export function useStreetReverse() {
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const geocode = useCallback(
    async (lat: number, lng: number) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      return reverseStreet(lat, lng, controller.signal)
    },
    [],
  )

  return { geocode }
}