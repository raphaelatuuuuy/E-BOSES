import { useEffect, useRef } from "react"

import type { AuthUser } from "@/features/auth/api"
import { sendLocationPing } from "@/features/dashboard/api"
import { isFreshGeolocationPosition } from "@/features/dashboard/lib/last-known-position"

function metersBetween(a: GeolocationCoordinates, b: GeolocationCoordinates) {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLng = (b.longitude - a.longitude) * rad
  const lat1 = a.latitude * rad
  const lat2 = b.latitude * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function useLocationPing(user: AuthUser | null) {
  const lastSentRef = useRef<{ coords: GeolocationCoordinates; sentAt: number } | null>(null)

  useEffect(() => {
    lastSentRef.current = null
    if (!user || user.status !== "verified" || !navigator.geolocation) return

    let cancelled = false
    let timer: number | undefined
    let denied = false
    let inFlight = false

    function shouldSend(coords: GeolocationCoordinates) {
      const last = lastSentRef.current
      if (!last) return true
      if (Date.now() - last.sentAt > 120000) return true
      return metersBetween(last.coords, coords) >= 20
    }

    function ping(force = false) {
      if (
        cancelled ||
        denied ||
        inFlight ||
        document.visibilityState === "hidden"
      )
        return
      inFlight = true
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled || !isFreshGeolocationPosition(position)) {
            inFlight = false
            window.dispatchEvent(new CustomEvent("eboses:location-sync-failed"))
            return
          }
          if (!force && !shouldSend(position.coords)) {
            inFlight = false
            return
          }
          void sendLocationPing({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: "active_session",
            timestamp: position.timestamp,
          }).then((result) => {
            if (!result.accepted) throw new Error("The server did not accept this location.")
            lastSentRef.current = { coords: position.coords, sentAt: Date.now() }
            window.dispatchEvent(new CustomEvent("eboses:location-synced"))
          }).catch(() => {
            window.dispatchEvent(new CustomEvent("eboses:location-sync-failed"))
          }).finally(() => {
            inFlight = false
          })
        },
        (error) => {
          inFlight = false
          if (error.code === error.PERMISSION_DENIED) denied = true
        },
        { enableHighAccuracy: true, maximumAge: force ? 0 : 10000, timeout: 20000 },
      )
    }

    function schedule(force = false) {
      window.clearInterval(timer)
      if (document.visibilityState === "visible") {
        ping(force)
        timer = window.setInterval(() => ping(false), 30000)
      }
    }

    function handleFocus() {
      if (document.visibilityState === "visible") {
        denied = false
        ping(true)
      }
    }

    function handleVisibilityChange() {
      schedule(true)
    }

    schedule(true)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [user])
}
