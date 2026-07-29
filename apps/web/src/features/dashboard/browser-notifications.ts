import { apiRequest } from "@/lib/api"
import type { NotificationItem } from "@/features/dashboard/components/notification-context"
import {
  ensureServiceWorkerActive,
  getLastServiceWorkerError,
  registerAppServiceWorker,
  unregisterStaleServiceWorker,
} from "@/lib/pwa"

function urlBase64ToUint8Array(value: string) {
  const cleaned = value.trim().replace(/^["']|["']$/g, "")
  if (!cleaned || cleaned.includes("BEGIN PUBLIC KEY") || cleaned.includes("\n")) {
    throw new Error("Invalid Web Push public key. Use only the one-line Public Key from npx web-push generate-vapid-keys.")
  }
  try {
    const padding = "=".repeat((4 - cleaned.length % 4) % 4)
    const base64 = (cleaned + padding).replace(/-/g, "+").replace(/_/g, "/")
    const raw = window.atob(base64)
    const bytes = Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
    if (bytes.length !== 65 || bytes[0] !== 4) {
      throw new Error(
        `Public key must decode to a 65-byte uncompressed VAPID key. Current decoded length: ${bytes.length}, first byte: ${bytes[0] ?? "none"}.`,
      )
    }
    return bytes
  } catch (error) {
    if (error instanceof Error && error.message.includes("65-byte")) throw error
    // `cause` preserves the underlying failure (usually an atob DOMException on
    // malformed base64). Without it the real reason was discarded and every
    // decode failure looked identical in logs.
    throw new Error(
      "Invalid Web Push public key. Regenerate keys with npx web-push generate-vapid-keys and restart Django.",
      { cause: error },
    )
  }
}

function buffersMatch(left: ArrayBuffer | null, right: Uint8Array) {
  if (!left) return false
  const leftBytes = new Uint8Array(left)
  if (leftBytes.length !== right.length) return false
  return leftBytes.every((value, index) => value === right[index])
}

export function browserNotificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
}

export interface BrowserNotificationState {
  supported: boolean
  permission: NotificationPermission | "unsupported"
  serverConfigured: boolean
  subscribed: boolean
  config?: {
    public_key_length?: number
    public_key_decoded_length?: number | null
    public_key_first_byte?: number | null
    public_key_format_valid?: boolean | null
    key_pair_valid?: boolean | null
    subject_valid?: boolean
    error?: string
  }
}

export async function registerNotificationWorker() {
  if (!browserNotificationsSupported()) return null
  return registerAppServiceWorker()
}

async function getPublicKey() {
  const { public_key } = await apiRequest<{ public_key: string }>("/notifications/browser-push/public-key/")
  return (public_key || "").trim().replace(/^["']|["']$/g, "")
}

async function getPublicKeyResponse() {
  const response = await apiRequest<{ public_key: string; config?: BrowserNotificationState["config"] }>("/notifications/browser-push/public-key/")
  return {
    publicKey: (response.public_key || "").trim().replace(/^["']|["']$/g, ""),
    config: response.config,
  }
}

export async function getBrowserNotificationState(): Promise<BrowserNotificationState> {
  if (!browserNotificationsSupported()) {
    return { supported: false, permission: "unsupported", serverConfigured: false, subscribed: false }
  }
  const registration = await registerNotificationWorker()
  const subscription = await registration?.pushManager.getSubscription()
  let publicKey = ""
  let config: BrowserNotificationState["config"] | undefined
  try {
    const response = await getPublicKeyResponse()
    publicKey = response.publicKey
    config = response.config
  } catch {
    // Leave publicKey as its initial "" — the server has no key configured, or
    // the request failed. Re-assigning it here made the initialiser dead code.
  }
  return {
    supported: true,
    permission: Notification.permission,
    serverConfigured: Boolean(publicKey),
    subscribed: Boolean(subscription),
    config,
  }
}

export async function enableBrowserNotifications() {
  if (!browserNotificationsSupported()) {
    throw new Error("Browser notifications are not supported on this device.")
  }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Change site permissions to Allow, then try Enable push again."
        : "Notification permission was dismissed. Click Enable push again and choose Allow.",
    )
  }
  const registration = await registerNotificationWorker()
  if (!registration) {
    const detail = getLastServiceWorkerError()
    throw new Error(detail ? `Service worker could not register: ${detail}` : "Service worker could not register. Reload the page, then try Enable push again.")
  }
  if (!("PushManager" in window)) {
    throw new Error("PushManager is not available in this browser.")
  }

  const public_key = await getPublicKey()
  if (!public_key) {
    throw new Error("Server push is not configured yet. In-app notifications will still work.")
  }

  const applicationServerKey = urlBase64ToUint8Array(public_key)
  const existingSubscription = await registration.pushManager.getSubscription()
  if (
    existingSubscription
    && !buffersMatch(existingSubscription.options.applicationServerKey, applicationServerKey)
  ) {
    await apiRequest("/notifications/browser-push/subscriptions/", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: existingSubscription.endpoint }),
    }).catch(() => undefined)
    await existingSubscription.unsubscribe().catch(() => undefined)
  }

  const subscribe = async (serviceWorker: ServiceWorkerRegistration) => serviceWorker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey,
  })

  const recoverPushState = async () => {
    await existingSubscription?.unsubscribe().catch(() => undefined)
    await unregisterStaleServiceWorker().catch(() => undefined)
    const freshRegistration = await registerNotificationWorker()
    if (!freshRegistration) return null
    return subscribe(freshRegistration)
  }

  const subscription = await registration.pushManager.getSubscription()
    ?? await (async () => {
      try {
        const serviceWorker = await ensureServiceWorkerActive()
        if (!serviceWorker) return null
        return await subscribe(serviceWorker)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const isPushServiceError = detail.toLowerCase().includes("push service") || (error instanceof DOMException && error.name === "AbortError")
        if (isPushServiceError) {
          try {
            const recovered = await recoverPushState()
            if (recovered) return recovered
          } catch {
            // Fall through to the original browser-facing error below.
          }
          throw new Error(
            "Browser push service registration failed. The app tried to recover stale push state, but the browser still rejected push registration. On this machine, check Edge notification permission, disable adblock/VPN/privacy tools temporarily, and retry on a fresh tab.",
            { cause: error },
          )
        }
        throw new Error(
          `Browser push subscription failed: ${detail || "unknown error"}. Reload the page and try again on a trusted HTTPS origin.`,
          { cause: error },
        )
      }
    })()
  if (!subscription) {
    throw new Error("Could not subscribe to push notifications. Reload the page and try Enable push again.")
  }
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
  const url = item.action_url || (item.emergency_id
    ? `/dashboard/emergency-history?alert=${item.emergency_public_id || item.emergency_id}`
    : item.concern_id
      ? `/dashboard/reports/${item.concern_public_id || item.concern_id}`
      : "/dashboard/home")
  const rawBody = (item.display_body || item.body || "Open E-Boses for details.").replace(/\s+/g, " ").trim()
  const body =
    rawBody.length > 90
      ? `${(rawBody.slice(0, 90).replace(/\s+\S*$/, "").trim() || rawBody.slice(0, 90)).trim()}...`
      : rawBody

  registration?.active?.postMessage({
    type: "eboses.show-notification",
    payload: {
      title: item.display_title || item.title || "E-Boses update",
      body,
      url,
      tag: item.tag,
      category: item.category,
      priority: item.priority,
      icon: item.icon_url || "/contents/logo.png",
      badge: "/contents/logo.png",
      image: item.image_url || undefined,
      actions: item.actions?.length ? item.actions : item.action_label ? [{ action: "open", title: item.action_label, url }] : undefined,
      requireInteraction: item.priority === "urgent",
      renotify: item.priority === "urgent" || item.priority === "important",
      timestamp: item.created_at,
      notification: item,
      data: {
        notification_id: item.id,
        type: item.type,
        concern_id: item.concern_id,
        emergency_id: item.emergency_id,
      },
    },
  })
}
