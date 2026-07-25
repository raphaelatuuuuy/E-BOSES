import { useEffect, useRef, useState } from "react"
import { websocketTicket, websocketUrl } from "@/lib/api"
import type { LiveMapSnapshot, LiveMapUpdate } from "@/features/dashboard/api"

function mergeUpdate(snapshot: LiveMapSnapshot, message: LiveMapUpdate): LiveMapSnapshot {
  const activeEmergencyStatuses = new Set(["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"])

  if (message.type === "location.updated") {
    const person = message.payload.person
    const people = snapshot.people.some((item) => item.id === person.id)
      ? snapshot.people.map((item) => item.id === person.id ? person : item)
      : [...snapshot.people, person]
    return { ...snapshot, people }
  }
  if (message.type === "concern.created" || message.type === "concern.updated") {
    const concern = message.payload.concern
    const concerns = snapshot.concerns.some((item) => item.id === concern.id)
      ? snapshot.concerns.map((item) => item.id === concern.id ? concern : item)
      : [concern, ...snapshot.concerns]
    return { ...snapshot, concerns }
  }
  if (message.type === "emergency.created" || message.type === "emergency.updated") {
    const emergency = message.payload.emergency
    const emergencies = activeEmergencyStatuses.has(emergency.status)
      ? snapshot.emergencies.some((item) => item.id === emergency.id)
        ? snapshot.emergencies.map((item) => item.id === emergency.id ? emergency : item)
        : [emergency, ...snapshot.emergencies]
      : snapshot.emergencies.filter((item) => item.id !== emergency.id)
    const route = message.payload.route
    const routes = route
      ? snapshot.routes.some((item) => item.alert_id === route.alert_id)
        ? snapshot.routes.map((item) => item.alert_id === route.alert_id ? route : item)
        : [...snapshot.routes, route]
      : snapshot.routes
    return { ...snapshot, emergencies, routes }
  }
  if (message.type === "route.updated") {
    const route = message.payload.route
    const routes = snapshot.routes.some((item) => item.alert_id === route.alert_id)
      ? snapshot.routes.map((item) => item.alert_id === route.alert_id ? route : item)
      : [...snapshot.routes, route]
    return { ...snapshot, routes }
  }
  return snapshot
}

export function useLiveMapWebSocket(
  _userId: number | undefined,
  setConnectionState: (state: "connecting" | "live" | "degraded") => void,
  setSnapshot: (updater: LiveMapSnapshot | ((prev: LiveMapSnapshot | null) => LiveMapSnapshot | null)) => void,
  load: () => Promise<void>,
) {
  const closedRef = useRef(false)
  const hasConnectedRef = useRef(false)
  const loadRef = useRef(load)
  const loadUpdateRef = useRef<typeof setSnapshot>(() => {})
  const [ticket, setTicket] = useState<string | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    loadUpdateRef.current = setSnapshot
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof window.setTimeout> | undefined
    function fetchTicket() {
      websocketTicket().then((t) => {
        if (!cancelled) setTicket(t)
      }).catch(() => {
        if (!cancelled) { timer = window.setTimeout(fetchTicket, 5000) }
      })
    }
    fetchTicket()
    return () => { cancelled = true; if (timer) window.clearTimeout(timer) }
  }, [])

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (!ticket) return
    const activeTicket = ticket
    const closed = closedRef
    const hasConnected = hasConnectedRef
    closed.current = false
    hasConnected.current = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof window.setTimeout> | undefined

    function connect() {
      setConnectionState("connecting")
      const socket = new WebSocket(
        websocketUrl(`/ws/dashboard/live-map/?ticket=${encodeURIComponent(activeTicket)}`),
      )
      socket.onopen = () => {
        const reconnected = hasConnected.current
        hasConnected.current = true
        setConnectionState("live")
        if (reconnected) void loadRef.current()
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as LiveMapUpdate
          if (message.type === "concern.ai_assessment.updated") {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", {
                detail: { concernId: message.payload.concern_id, source: "ai_assessment" },
              }),
            )
          }
          loadUpdateRef.current((current) => current ? mergeUpdate(current, message) : current)
        } catch {
        }
      }
      socket.onclose = () => {
        ws = null
        setConnectionState("degraded")
        if (!closed.current) scheduleReconnect()
      }
      socket.onerror = () => socket.close()
      ws = socket
    }

    function scheduleReconnect() {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(() => { if (!closed.current) connect() }, 5000)
    }

    connect()

    return () => {
      closed.current = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.close()
        ws = null
      }
    }
  }, [ticket, setConnectionState])
}