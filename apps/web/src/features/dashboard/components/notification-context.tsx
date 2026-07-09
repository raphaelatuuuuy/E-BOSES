import * as React from "react"
import { apiRequest, getAccessToken, websocketUrl } from "@/lib/api"
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
  concern_title: string | null
  concern_status: string | null
  emergency_id: number | null
  emergency_status: string | null
}

interface NotificationContextValue {
  notifications: NotificationItem[]
  unreadCount: number
  loading: boolean
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
    void registerNotificationWorker()
    const interval = setInterval(fetchAll, 30_000)
    function handleWorkerClick(event: MessageEvent) {
      if (event.data?.type === "eboses.notification-click" && typeof event.data.url === "string") {
        window.location.assign(event.data.url)
      }
    }
    window.addEventListener("eboses:notifications-refresh", fetchAll)
    navigator.serviceWorker?.addEventListener("message", handleWorkerClick)
    return () => {
      clearInterval(interval)
      window.removeEventListener("eboses:notifications-refresh", fetchAll)
      navigator.serviceWorker?.removeEventListener("message", handleWorkerClick)
    }
  }, [])

  React.useEffect(() => {
    const token = getAccessToken()
    if (!token) return

    let socket: WebSocket | null = null
    let connectTimer: number | undefined
    let reconnectTimer: number | undefined
    let closedByComponent = false
    let opened = false
    let reconnectAttempts = 0
    const maxReconnectAttempts = 2

    function connect() {
      socket = new WebSocket(websocketUrl(`/ws/notifications/?token=${encodeURIComponent(token)}`))
      socket.onopen = () => {
        opened = true
        reconnectAttempts = 0
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: NotificationItem }
          if (message.type !== "notification.created" || !message.payload) return
          setNotifications((prev) => {
            if (prev.some((item) => item.id === message.payload?.id)) return prev
            return [message.payload, ...prev].slice(0, 20)
          })
          if (!message.payload.is_read) {
            setUnreadCount((prev) => prev + 1)
            void showBrowserNotification(message.payload)
          }
        } catch {
          // Ignore malformed realtime events; polling remains the fallback.
        }
      }
      socket.onclose = () => {
        void fetchAll()
        if (closedByComponent) return
        if (!opened || reconnectAttempts >= maxReconnectAttempts) return
        reconnectAttempts += 1
        reconnectTimer = window.setTimeout(connect, 5000)
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    connectTimer = window.setTimeout(connect, 0)
    return () => {
      closedByComponent = true
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
