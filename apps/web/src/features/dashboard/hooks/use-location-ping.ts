import { useEffect, useRef } from "react"

import type { AuthUser } from "@/features/auth/api"
import { sendLocationPing } from "@/features/dashboard/api"

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
  const deniedRef = useRef(false)

  useEffect(() => {
    if (!user || user.status !== "verified" || !navigator.geolocation) return

    let cancelled = false
    let timer: number | undefined

    function shouldSend(coords: GeolocationCoordinates) {
      const last = lastSentRef.current
      if (!last) return true
      if (Date.now() - last.sentAt > 120000) return true
      return metersBetween(last.coords, coords) >= 20
    }

    function ping() {
      if (cancelled || deniedRef.current || document.visibilityState === "hidden") return
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled || !shouldSend(position.coords)) return
          void sendLocationPing({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: "active_session",
          }).then(() => {
            lastSentRef.current = { coords: position.coords, sentAt: Date.now() }
          }).catch(() => {})
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) deniedRef.current = true
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 10000 },
      )
    }

    function schedule() {
      window.clearInterval(timer)
      if (document.visibilityState === "visible") {
        ping()
        timer = window.setInterval(ping, 30000)
      }
    }

    schedule()
    document.addEventListener("visibilitychange", schedule)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", schedule)
    }
  }, [user])
}
