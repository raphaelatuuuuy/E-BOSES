import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { useAuthSession } from "@/features/auth/auth-session"
import {
  endResponderShift,
  getActiveResponderShift,
  startResponderShift,
  type ResponderShift,
} from "@/features/dashboard/emergency-api"
import { useResponderUnit } from "@/features/dashboard/hooks/use-responder-unit"

export function useResponderDuty() {
  const { refreshUser } = useAuthSession()
  const unit = useResponderUnit()
  const [isOnDuty, setIsOnDuty] = useState(false)
  const [activeShift, setActiveShift] = useState<ResponderShift | null>(null)
  const [busy, setBusy] = useState("")

  const refresh = useCallback(async () => {
    const shift = await getActiveResponderShift()
    setActiveShift(shift)
    setIsOnDuty(Boolean(shift))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh().catch(() => undefined), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const requestPosition = useCallback(() => {
    return new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("GPS is not available on this device."))
        return
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      })
    })
  }, [])

  const startDuty = useCallback(async () => {
    setBusy("start")
    try {
      const pos = await requestPosition()
      const shift = await startResponderShift({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      })
      setActiveShift(shift)
      setIsOnDuty(true)
      toast.success("Shift started")
      await Promise.allSettled([refreshUser(), unit.reload()])
      return shift
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not start the shift. Check GPS permission and try again.",
      )
      throw err
    } finally {
      setBusy("")
    }
  }, [refreshUser, unit, requestPosition])

  const endDuty = useCallback(async () => {
    setBusy("end")
    try {
      const pos = await requestPosition().catch(() => null)
      const shift = await endResponderShift({
        latitude: pos?.coords.latitude,
        longitude: pos?.coords.longitude,
      })
      setActiveShift(null)
      setIsOnDuty(false)
      toast.success("Shift ended")
      await Promise.allSettled([refreshUser(), unit.reload()])
      return shift
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not end the shift.",
      )
      throw err
    } finally {
      setBusy("")
    }
  }, [refreshUser, unit, requestPosition])

  return {
    unit,
    isOnDuty,
    activeShift,
    busy,
    refresh,
    startDuty,
    endDuty,
  }
}
