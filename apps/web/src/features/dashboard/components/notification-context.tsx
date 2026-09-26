import * as React from "react"
import { apiRequest, websocketTicket, websocketUrl } from "@/lib/api"
import type { Concern } from "@/features/dashboard/api"
import { registerNotificationWorker, showBrowserNotification } from "@/features/dashboard/browser-notifications"
import { shouldSkipPoll } from "@/features/dashboard/lib/visible-poll"
import { registerNativePush } from "@/features/dashboard/native-push"

export interface NotificationItem {
  id: number
  type: string
  title: string
  body: string
  is_read: boolean
  is_archived?: boolean
  created_at: string
  concern_id: number | null
  concern_public_id: string | null
  concern_title: string | null
  concern_status: string | null
  emergency_id: number | null
  emergency_public_id: string | null
  emergency_status: string | null
  safety_limited?: boolean
  safety_guidance?: string | null
  action_url?: string
  display_title?: string
  display_body?: string
  category?: "announcement" | "emergency" | "appeal" | "chat" | "report" | string
  priority?: "normal" | "important" | "urgent" | string
  action_label?: string
  tag?: string
  icon_url?: string
  badge_url?: string
  image_url?: string | null
  images?: Array<{
    url: string
    filename: string
    mime_type?: string | null
  }>
  actions?: Array<{ action: string; title: string; url: string; icon?: string }>
  context?: {
    community?: { id: number | null; name: string; code?: string | null } | null
    department?: { id: number | null; name: string; short_name?: string | null; code?: string | null } | null
    reference?: string | null
    subject?: string | null
    status?: string | null
    location?: { barangay?: string | null; address?: string | null; confidence?: string | null } | null
    response?: {
      assignment_status?: string | null
      assigned_unit?: { id: number | null; name: string; short_name?: string | null; code?: string | null } | null
      responding_community?: { id: number | null; name: string; code?: string | null } | null
      is_cross_community?: boolean
      assignee_name?: string | null
    } | null
  }
}

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  loading: boolean
  /** Set when the list could not be fetched; empty list must not read as "no
   * news" when the request itself failed. */
  loadError: string
  connectionState: "connecting" | "live" | "degraded"
  markAsRead: (id: number) => Promise<void>
  markAllAsRead: () => Promise<void>
  archiveAllRead: () => Promise<void>
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
  const [loadError, setLoadError] = React.useState("")
  const [connectionState, setConnectionState] = React.useState<"connecting" | "live" | "degraded">("connecting")
  const socketLiveRef = React.useRef(false)
  const lastBrowserNotifRef = React.useRef(0)
  const seenIdsRef = React.useRef(new Set<number>())
  const notificationsHydratedRef = React.useRef(false)

  async function fetchAll() {
    try {
      const [list, countRes] = await Promise.all([
        apiRequest<NotificationItem[]>("/notifications/?include_archived=true"),
        apiRequest<{ count: number }>("/notifications/unread-count/"),
      ])
      const nextList = list ?? []
      const newlyFetched = notificationsHydratedRef.current
        ? nextList.filter((item) => !seenIdsRef.current.has(item.id))
        : []
      setNotifications(nextList)
      for (const item of nextList) seenIdsRef.current.add(item.id)
      notificationsHydratedRef.current = true
      setUnreadCount(countRes?.count ?? 0)
      setLoadError("")
      for (const item of newlyFetched) {
        window.dispatchEvent(
          new CustomEvent("eboses:notification-created", { detail: item }),
        )
      }
    } catch {
      // Notifications are not critical, but a silent empty list reads as "no
      // news" — surface the failure instead of pretending the inbox is empty.
      setLoadError("Notifications could not be loaded. Check your connection.")
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

  async function archiveAllRead() {
    await apiRequest("/notifications/archive-all/", { method: "POST" })
    setNotifications((prev) =>
      prev.map((n) => (n.is_read && !n.is_archived ? { ...n, is_archived: true } : n)),
    )
  }

  React.useEffect(() => {
    // Defer the first fetch one macrotask so the mount render settles first;
    // the setStates inside fetchAll are all async continuations.
    window.setTimeout(() => void fetchAll(), 0)
    void registerNotificationWorker().catch(() => null)
    void registerNativePush().catch(() => undefined)
    const interval = setInterval(() => {
      if (!socketLiveRef.current && !shouldSkipPoll()) void fetchAll()
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
    let reconnectTimer: number | undefined
    let heartbeatTimer: number | undefined
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
        socket?.send(JSON.stringify({ type: "presence.heartbeat" }))
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "presence.heartbeat" }))
          }
        }, 3000)
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: NotificationItem }
          if (message.type !== "notification.created" || !message.payload) return
          const payload = message.payload
          if (seenIdsRef.current.has(payload.id)) return
          seenIdsRef.current.add(payload.id)
          window.dispatchEvent(
            new CustomEvent("eboses:notification-created", { detail: payload }),
          )
          setNotifications((prev) => [payload, ...prev].slice(0, 20))
          if (!payload.is_read) {
            setUnreadCount((prev) => prev + 1)
            const nowTs = Date.now()
            if (nowTs - lastBrowserNotifRef.current >= 1000) {
              lastBrowserNotifRef.current = nowTs
              void showBrowserNotification(payload)
            }
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
        window.clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
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

    const connectTimer = window.setTimeout(() => void connect(), 0)
    return () => {
      closedByComponent = true
      socketLiveRef.current = false
      if (connectTimer) window.clearTimeout(connectTimer)
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (heartbeatTimer) window.clearInterval(heartbeatTimer)
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
        loadError,
        connectionState,
        markAsRead,
        markAllAsRead,
        archiveAllRead,
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
