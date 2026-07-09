import { apiRequest } from "@/lib/api"
import type { NotificationItem } from "@/features/dashboard/components/notification-context"

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

export function browserNotificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator
}

export async function registerNotificationWorker() {
  if (!browserNotificationsSupported()) return null
  return navigator.serviceWorker.register("/eboses-sw.js")
}

export async function enableBrowserNotifications() {
  if (!browserNotificationsSupported()) {
    throw new Error("Browser notifications are not supported on this device.")
  }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error("Allow notifications in your browser to receive alerts.")
  }
  const registration = await registerNotificationWorker()
  if (!registration || !("PushManager" in window)) return permission

  const { public_key } = await apiRequest<{ public_key: string }>("/notifications/browser-push/public-key/")
  if (!public_key) return permission

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  })
  await apiRequest("/notifications/browser-push/subscriptions/", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  })
  return permission
}

export async function showBrowserNotification(item: NotificationItem) {
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return
  const registration = await registerNotificationWorker()
  const url = item.emergency_id ? "/dashboard/emergencies" : item.concern_id ? `/dashboard/reports/${item.concern_id}` : "/dashboard"
  registration?.active?.postMessage({
    type: "eboses.show-notification",
    payload: {
      title: item.title || "E-Boses update",
      body: item.body || "Open E-Boses for details.",
      url,
    },
  })
}
