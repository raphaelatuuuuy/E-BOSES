import { useEffect, useRef, useState } from "react"
import { websocketTicket, websocketUrl } from "@/lib/api"
import { getEmergencyRoute, type EmergencyAlert, type EmergencyChatMessage, type EmergencyRoute } from "@/features/dashboard/emergency-api"

function createRealtimeSocket(url: string) {
  return new WebSocket(url)
}

export function useEmergencyTrackingSocket({
  open,
  alertId,
  alertStatus,
  onAlert,
  onChatMessage,
}: {
  open: boolean
  alertId: number | undefined
  alertStatus: EmergencyAlert["status"] | undefined
  onAlert: (alert: EmergencyAlert) => void
  onChatMessage: (message: EmergencyChatMessage) => void
}) {
  const [localConnectionState, setLocalConnectionState] = useState<"connecting" | "live" | "degraded">("connecting")
  const onAlertRef = useRef(onAlert)
  const onChatMessageRef = useRef(onChatMessage)
  useEffect(() => { onAlertRef.current = onAlert })
  useEffect(() => { onChatMessageRef.current = onChatMessage })

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"].includes(alertStatus)) {
      return
    }
    let socket: WebSocket | null = null
    const sockets = new Set<WebSocket>()
    let reconnectTimer: ReturnType<typeof window.setTimeout> | undefined
    let closedByComponent = false
    let reconnectAttempts = 0

    function scheduleReconnect() {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** reconnectAttempts))
    }

    async function connect() {
      if (closedByComponent) return
      setLocalConnectionState("connecting")
      try {
        const ticket = await websocketTicket()
        socket = createRealtimeSocket(websocketUrl(`/ws/emergencies/${alertId}/tracking/?ticket=${encodeURIComponent(ticket)}`))
        sockets.add(socket)
      } catch {
        if (closedByComponent) return
        setLocalConnectionState("degraded")
        reconnectAttempts += 1
        scheduleReconnect()
        return
      }
      socket.onopen = () => {
        reconnectAttempts = 0
        setLocalConnectionState("live")
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as {
            type?: string
            payload?: (EmergencyAlert & { current_route?: EmergencyRoute | null }) | EmergencyChatMessage
          }
          if (message.type === "emergency.chat" && message.payload) {
            onChatMessageRef.current(message.payload as EmergencyChatMessage)
            return
          }
          if (message.type !== "emergency.update" || !message.payload) return
          const nextAlert = message.payload as EmergencyAlert & { current_route?: EmergencyRoute | null }
          onAlertRef.current(nextAlert)
        } catch {
          /* ignore */
        }
      }
      socket.onclose = () => {
        if (socket) sockets.delete(socket)
        setLocalConnectionState("degraded")
        if (!closedByComponent) {
          reconnectAttempts += 1
          scheduleReconnect()
        }
      }
      socket.onerror = () => socket?.close()
    }

    void connect()
    return () => {
      closedByComponent = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (socket) socket.close()
      sockets.forEach((item) => item.close())
      sockets.clear()
    }
  }, [open, alertId, alertStatus])

  return localConnectionState
}

const activeStatuses: ReadonlySet<string> = new Set(["submitted", "routed", "acknowledged", "en_route", "nearby", "arrived"])

export function useEmergencyPolling({
  open,
  alertId,
  alertStatus,
  connectionState,
  onAlert,
}: {
  open: boolean
  alertId: number | undefined
  alertStatus: EmergencyAlert["status"] | undefined
  connectionState: "connecting" | "live" | "degraded"
  onAlert: (alert: EmergencyAlert) => void
}) {
  const onAlertRef = useRef(onAlert)
  useEffect(() => { onAlertRef.current = onAlert })

  useEffect(() => {
    if (!open || !alertId || !alertStatus || !activeStatuses.has(alertStatus) || connectionState !== "degraded") return
    const interval = window.setInterval(async () => {
      try {
        const nextAlert = await import("@/features/dashboard/emergency-api").then((m) => m.getEmergency(alertId))
        onAlertRef.current(nextAlert)
      } catch {
        /* keep last */
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [open, alertId, alertStatus, connectionState])
}

export function useEmergencyRoute({
  open,
  alertId,
  lastLocation,
}: {
  open: boolean
  alertId: number | undefined
  lastLocation: EmergencyAlert["current_assignment"] extends infer A ? A extends { last_location: infer L } ? L : null : null
}) {
  const [route, setRoute] = useState<EmergencyRoute | null>(null)

  useEffect(() => {
    if (!open || !alertId || !lastLocation) return
    let cancelled = false
    void getEmergencyRoute(alertId)
      .then((nextRoute) => { if (!cancelled) setRoute(nextRoute) })
      .catch(() => { if (!cancelled) setRoute(null) })
    return () => { cancelled = true }
  }, [open, alertId, lastLocation])

  return route
}
