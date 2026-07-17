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

export interface BrowserNotificationState {
  supported: boolean
  permission: NotificationPermission | "unsupported"
  serverConfigured: boolean
  subscribed: boolean
}

export async function registerNotificationWorker() {
  if (!browserNotificationsSupported()) return null
  return navigator.serviceWorker.register("/eboses-sw.js")
}

async function getPublicKey() {
  const { public_key } = await apiRequest<{ public_key: string }>("/notifications/browser-push/public-key/")
  return public_key
}

export async function getBrowserNotificationState(): Promise<BrowserNotificationState> {
  if (!browserNotificationsSupported()) {
    return { supported: false, permission: "unsupported", serverConfigured: false, subscribed: false }
  }
  const registration = await registerNotificationWorker()
  const subscription = await registration?.pushManager.getSubscription()
  let publicKey = ""
  try {
    publicKey = await getPublicKey()
  } catch {
    publicKey = ""
  }
  return {
    supported: true,
    permission: Notification.permission,
    serverConfigured: Boolean(publicKey),
    subscribed: Boolean(subscription),
  }
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

  const public_key = await getPublicKey()
  if (!public_key) {
    throw new Error("Server push is not configured yet. In-app notifications will still work.")
  }

  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    })
  await apiRequest("/notifications/browser-push/subscriptions/", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  })
  return permission
}

export async function disableBrowserNotifications() {
  const registration = await registerNotificationWorker()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await apiRequest("/notifications/browser-push/subscriptions/", {
    method: "DELETE",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  })
  await subscription.unsubscribe()
}

export async function showBrowserNotification(item: NotificationItem) {
  if (!browserNotificationsSupported() || Notification.permission !== "granted") return
  const registration = await registerNotificationWorker()
  const url = item.emergency_id
    ? `/dashboard/emergency-history?alert=${item.emergency_public_id || item.emergency_id}`
    : item.concern_id
      ? `/dashboard/reports/${item.concern_public_id || item.concern_id}`
      : "/dashboard/home"
  registration?.active?.postMessage({
    type: "eboses.show-notification",
    payload: {
      title: item.title || "E-Boses update",
      body: item.body || "Open E-Boses for details.",
      url,
    },
  })
}
