import * as React from "react"
import { apiRequest, websocketTicket, websocketUrl } from "@/lib/api"
import type { Concern } from "@/features/dashboard/api"
import { registerNotificationWorker, showBrowserNotification } from "@/features/dashboard/browser-notifications"

export interface NotificationItem {
  id: number
  type: string
  title: string
  body: string
  is_read: boolean
  created_at: string
  concern_id: number | null
  concern_public_id: string | null
  concern_title: string | null
  concern_status: string | null
  emergency_id: number | null
  emergency_public_id: string | null
  emergency_status: string | null
}

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  loading: boolean
  connectionState: "connecting" | "live" | "degraded"
  markAsRead: (id: number) => Promise<void>
  markAllAsRead: () => Promise<void>
  refresh: () => Promise<void>
}

const NotificationContext = React.createContext<NotificationContextValue | null>(null)

export function useNotifications() {
  const ctx = React.useContext(NotificationContext)
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider")
  return ctx
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [connectionState, setConnectionState] = React.useState<"connecting" | "live" | "degraded">("connecting")
  const socketLiveRef = React.useRef(false)

  async function fetchAll() {
    try {
      const [list, countRes] = await Promise.all([
        apiRequest<NotificationItem[]>("/notifications/"),
        apiRequest<{ count: number }>("/notifications/unread-count/"),
      ])
      setNotifications(list ?? [])
      setUnreadCount(countRes?.count ?? 0)
    } catch {
      // silently fail — notifications aren't critical
    } finally {
      setLoading(false)
    }
  }

  async function markAsRead(id: number) {
    await apiRequest(`/notifications/${id}/read/`, { method: "PATCH" })
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    )
    setUnreadCount((prev) => Math.max(0, prev - 1))
  }

  async function markAllAsRead() {
    await apiRequest("/notifications/read-all/", { method: "POST" })
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  React.useEffect(() => {
    void fetchAll()
    void registerNotificationWorker().catch(() => null)
    const interval = setInterval(() => {
      if (!socketLiveRef.current) void fetchAll()
    }, 30_000)
    function handleWorkerClick(event: MessageEvent) {
      if (event.data?.type === "eboses.notification-click" && typeof event.data.url === "string") {
        window.location.assign(event.data.url)
      }
    }
    window.addEventListener("eboses:notifications-refresh", fetchAll)
    // Optional chaining on API is fine; registration may fail under bad local SSL
    try {
      navigator.serviceWorker?.addEventListener("message", handleWorkerClick)
    } catch {
      /* ignore insecure SW */
    }
    return () => {
      clearInterval(interval)
      window.removeEventListener("eboses:notifications-refresh", fetchAll)
      try {
        navigator.serviceWorker?.removeEventListener("message", handleWorkerClick)
      } catch {
        /* ignore */
      }
    }
  }, [])

  React.useEffect(() => {
    let socket: WebSocket | null = null
    let connectTimer: number | undefined
    let reconnectTimer: number | undefined
    let closedByComponent = false
    let reconnectAttempts = 0

    async function connect() {
      setConnectionState("connecting")
      try {
        const ticket = await websocketTicket()
        if (closedByComponent) return
        socket = new WebSocket(websocketUrl(`/ws/notifications/?ticket=${encodeURIComponent(ticket)}`))
      } catch {
        socketLiveRef.current = false
        setConnectionState("degraded")
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** reconnectAttempts))
        return
      }
      socket.onopen = () => {
        socketLiveRef.current = true
        setConnectionState("live")
        reconnectAttempts = 0
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: NotificationItem }
          if (message.type !== "notification.created" || !message.payload) return
          const payload = message.payload
          setNotifications((prev) => {
            if (prev.some((item) => item.id === payload.id)) return prev
            return [payload, ...prev].slice(0, 20)
          })
          if (!payload.is_read) {
            setUnreadCount((prev) => prev + 1)
            void showBrowserNotification(payload)
          }
          if (payload.concern_id) {
            window.dispatchEvent(
              new CustomEvent("eboses:concern-updated", { detail: { concernId: payload.concern_id } }),
            )
          }
          if (payload.emergency_id) {
            window.dispatchEvent(
              new CustomEvent("eboses:emergency-updated", { detail: { emergencyId: payload.emergency_id } }),
            )
          }
        } catch {
          // Ignore malformed realtime events; polling remains the fallback.
        }
      }
      socket.onclose = () => {
        socketLiveRef.current = false
        setConnectionState("degraded")
        void fetchAll()
        if (closedByComponent) return
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1500 * 2 ** reconnectAttempts))
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    connectTimer = window.setTimeout(() => void connect(), 0)
    return () => {
      closedByComponent = true
      socketLiveRef.current = false
      if (connectTimer) window.clearTimeout(connectTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [])

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        connectionState,
        markAsRead,
        markAllAsRead,
        refresh: fetchAll,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

// ---- fetch concerns by id for the dialog ----
export async function fetchConcern(id: number): Promise<Concern> {
  return apiRequest<Concern>(`/concerns/${id}/`)
}
