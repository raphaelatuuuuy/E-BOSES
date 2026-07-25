import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useLocation } from "react-router-dom"
import {
  getEmergencyRoute,
  markEmergencyArrived,
  requestEmergencyBackup,
  resolveEmergency,
  sendEmergencyLocationPing,
  type EmergencyAlert,
  type EmergencyRoute,
} from "@/features/dashboard/emergency-api"
import { commentOnConcern, voteConcern, type Concern } from "@/features/dashboard/api"

export type ResponderMapDataAction =
  | { type: "REFRESH_LOAD"; alerts: EmergencyAlert[]; concerns: Concern[]; assignedConcerns: Concern[]; selectedId: number | null }
  | { type: "UPDATE_ALERTS"; updater: (prev: EmergencyAlert[]) => EmergencyAlert[] }
  | { type: "UPDATE_CONCERNS"; updater: (prev: Concern[]) => Concern[] }
  | { type: "SELECT_ID"; selectedId: number | null }
  | { type: "SET_ASSIGNED_CONCERNS"; assignedConcerns: Concern[] }

const SELECTED_DISPATCH_KEY = "eboses:responder-dispatch-id"

function requestPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(new Error("Location requires a secure HTTPS connection. Open the secure E-Boses address and try again."))
      return
    }
    if (!navigator.geolocation) {
      reject(new Error("GPS is not available on this device."))
      return
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  })
}

export function locationFailureMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0
  if (code === 1) return "Location permission was denied. Allow location for E-Boses in your browser settings, then try again."
  if (code === 2) return "Your location is unavailable. Move to an open area or turn on device location, then try again."
  if (code === 3) return "Location request timed out. Check your GPS signal and try again."
  return "Your location could not be read. Check device location access and try again."
}

export function usePreferredDispatchId(location: ReturnType<typeof useLocation>) {
  return useMemo(() => {
    const queryId = Number(new URLSearchParams(location.search).get("alert"))
    const storedId = Number(window.localStorage.getItem(SELECTED_DISPATCH_KEY))
    return Number.isInteger(queryId) && queryId > 0 ? queryId : Number.isInteger(storedId) && storedId > 0 ? storedId : null
  }, [location.search])
}

export function useResponderSelectedRoute(selected: EmergencyAlert | null) {
  const [route, setRoute] = useState<EmergencyRoute | null>(null)

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    void getEmergencyRoute(selected.id)
      .then((nextRoute) => { if (!cancelled) { setRoute(nextRoute) } })
      .catch(() => { if (!cancelled) { setRoute(null) } })
    return () => { cancelled = true }
  }, [selected])

  return { route, routeLoading: selected !== null && route === null }
}

export function useResponderActions(
  dispatchMapData: React.Dispatch<ResponderMapDataAction>,
  selected: EmergencyAlert | null,
  userPos: GeolocationPosition | null,
  setUserPos: (pos: GeolocationPosition) => void,
  setError: (err: string) => void,
  setBusy: (busy: string) => void,
  refreshSelectedRoute: (id: number) => void,
) {
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [concernBusy, setConcernBusy] = useState<number | null>(null)
  const autoPingInFlightRef = useRef(false)
  const lastAutoPingRef = useRef<Record<number, number>>({})

  async function likeConcern(concern: Concern) {
    setConcernBusy(concern.id)
    try {
      const result = await voteConcern(concern.id, concern.user_vote === 1 ? 0 : 1)
      dispatchMapData({ type: "UPDATE_CONCERNS", updater: (current: Concern[]) => current.map((item) => item.id === concern.id ? { ...item, user_vote: result.user_vote, vote_count: result.vote_count } : item) })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update support.")
    } finally { setConcernBusy(null) }
  }

  async function replyToConcern(concern: Concern) {
    const body = replyDraft.trim()
    if (!body) return
    setConcernBusy(concern.id)
    try {
      const comment = await commentOnConcern(concern.id, { body })
      dispatchMapData({ type: "UPDATE_CONCERNS", updater: (current: Concern[]) => current.map((item) => item.id === concern.id ? { ...item, comments: [...item.comments, comment], comment_count: item.comment_count + 1 } : item) })
      setReplyDraft(""); setReplyOpenId(null)
      toast.success("Response posted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post response.")
    } finally { setConcernBusy(null) }
  }

  async function locateMe() {
    setBusy("locate")
    try {
      const pos = await requestPosition(); setUserPos(pos); toast.success("Location updated")
    } catch (positionError) {
      const message = locationFailureMessage(positionError)
      setError(message); toast.error(message)
    } finally { setBusy("") }
  }

  async function pingSelected() {
    if (!selected) return
    setBusy("ping")
    let pos: GeolocationPosition
    try { pos = await requestPosition(); setUserPos(pos) } catch (positionError) {
      const message = locationFailureMessage(positionError)
      setError(message); toast.error(message); setBusy(""); return
    }
    try {
      const next = await sendEmergencyLocationPing(selected.id, { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy })
      lastAutoPingRef.current[selected.id] = Date.now()
      dispatchMapData({ type: "UPDATE_ALERTS", updater: (current: EmergencyAlert[]) => current.map((alert) => alert.id === next.id ? next : alert) })
      void refreshSelectedRoute(selected.id)
      setError(""); toast.success("GPS sent to dispatch")
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
      setError(`GPS was found, but dispatch could not receive the update. Check your connection and try again.${detail}`)
      toast.error(`GPS was found, but dispatch could not receive the update. Check your connection and try again.${detail}`)
    } finally { setBusy("") }
  }

  async function arrivedSelected() {
    if (!selected) return
    setBusy("arrived")
    try {
      const next = await markEmergencyArrived(selected.id)
      dispatchMapData({ type: "UPDATE_ALERTS", updater: (current: EmergencyAlert[]) => current.map((alert) => alert.id === next.id ? next : alert) })
      toast.success("Marked arrived on scene")
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not update arrival.") }
    finally { setBusy("") }
  }

  async function resolveSelected(responseNote: string) {
    if (!selected || responseNote.trim().length < 3) return
    setBusy("resolve")
    try {
      const next = await resolveEmergency(selected.id, responseNote.trim())
      dispatchMapData({ type: "UPDATE_ALERTS", updater: (current: EmergencyAlert[]) => current.map((alert) => alert.id === next.id ? next : alert) })
      toast.success("Incident resolved and response details saved")
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not resolve this incident.") }
    finally { setBusy("") }
  }

  async function requestBackup() {
    if (!selected) return
    setBusy("backup")
    try {
      const next = await requestEmergencyBackup(selected.id)
      dispatchMapData({ type: "UPDATE_ALERTS", updater: (current: EmergencyAlert[]) => current.map((alert) => alert.id === next.id ? next : alert) })
      const teamSize = next.assignments?.length ?? 0
      toast.success(teamSize > 1 ? `Backup responder routed. ${teamSize} responders are now assigned.` : "Backup request recorded.")
    } catch (err) { toast.error(err instanceof Error ? err.message : "Could not request backup.") }
    finally { setBusy("") }
  }

  useEffect(() => {
    if (!selected || !userPos || !["routed", "acknowledged", "en_route", "nearby", "arrived"].includes(selected.status)) return
    let cancelled = false
    const alertId = selected.id
    const activePos = userPos
    async function publish() {
      const now = Date.now()
      if (autoPingInFlightRef.current || now - (lastAutoPingRef.current[alertId] ?? 0) < 15_000) return
      autoPingInFlightRef.current = true
      try {
        const next = await sendEmergencyLocationPing(alertId, { latitude: activePos.coords.latitude, longitude: activePos.coords.longitude, accuracy: activePos.coords.accuracy })
        if (cancelled) return
        lastAutoPingRef.current[alertId] = Date.now()
        dispatchMapData({ type: "UPDATE_ALERTS", updater: (current: EmergencyAlert[]) => current.map((alert) => alert.id === next.id ? next : alert) })
        void refreshSelectedRoute(alertId)
        setError("")
      } catch { if (!cancelled) setError("Live GPS could not sync to this dispatch.") }
      finally { autoPingInFlightRef.current = false }
    }
    void publish()
    const timer = window.setInterval(() => void publish(), 15_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [selected, userPos, dispatchMapData, refreshSelectedRoute, setError])

  return {
    likeConcern, replyToConcern, locateMe, pingSelected, arrivedSelected, resolveSelected, requestBackup,
    replyOpenId, setReplyOpenId, replyDraft, setReplyDraft, concernBusy,
  }
}

export function useResponderUserPosition() {
  const [userPos, setUserPos] = useState<GeolocationPosition | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!cancelled) setUserPos(position) },
      (positionError) => { if (!cancelled) setError(locationFailureMessage(positionError)) },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const watchId = navigator.geolocation.watchPosition(
      (position) => { if (!cancelled) setUserPos(position) },
      (positionError) => { if (!cancelled) setError(locationFailureMessage(positionError)) },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    )
    return () => { cancelled = true; navigator.geolocation.clearWatch(watchId) }
  }, [])

  return { userPos, setUserPos, error, setError }
}
