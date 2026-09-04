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
  if (
    !cleaned ||
    cleaned.includes("BEGIN PUBLIC KEY") ||
    cleaned.includes("\n")
  ) {
    throw new Error(
      "Invalid Web Push public key. Use only the one-line Public Key from npx web-push generate-vapid-keys."
    )
  }
  try {
    const padding = "=".repeat((4 - (cleaned.length % 4)) % 4)
    const base64 = (cleaned + padding).replace(/-/g, "+").replace(/_/g, "/")
    const raw = window.atob(base64)
    const bytes = Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
    if (bytes.length !== 65 || bytes[0] !== 4) {
      throw new Error(
        `Public key must decode to a 65-byte uncompressed VAPID key. Current decoded length: ${bytes.length}, first byte: ${bytes[0] ?? "none"}.`
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
      { cause: error }
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
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  )
}

export interface BrowserNotificationState {
  supported: boolean
  permission: NotificationPermission | "unsupported"
  serverConfigured: boolean
  subscribed: boolean
  config?: {
    configured?: boolean
    public_key_length?: number
    public_key_decoded_length?: number | null
    public_key_first_byte?: number | null
    public_key_format_valid?: boolean | null
    key_pair_valid?: boolean | null
    subject_valid?: boolean
    error?: string
  }
}

function browserClockGreeting(lastName?: string) {
  const hour =
    Number(
      new Intl.DateTimeFormat("en-PH", {
        hour: "numeric",
        hour12: false,
        timeZone: "Asia/Manila",
      }).format(new Date())
    ) % 24
  const salutation =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const name = lastName?.trim()
  return name ? `${salutation}, ${name}.` : `${salutation}.`
}

export function browserNotificationErrorMessage(
  error: unknown,
  action = "enable"
) {
  const detail = error instanceof Error ? error.message.trim() : ""
  const lower = detail.toLowerCase()
  const permission =
    typeof Notification === "undefined" ? "unknown" : Notification.permission
  const pushFailure =
    lower.includes("push service") ||
    lower.includes("push subscription") ||
    lower.includes("pushmanager") ||
    lower.includes("subscription") ||
    (permission === "granted" && lower.includes("notallowed"))
  if (pushFailure) {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      return "Browser push requires a trusted HTTPS E-Boses address. Open the secure site, then try again."
    }
    if (permission !== "granted") {
      return "This browser has not granted notification permission for this E-Boses address. Open the browser site settings, choose Allow for notifications, reload, and try again."
    }
    if (lower.includes("after one recovery attempt")) {
      return "Browser notifications are allowed, but this browser's Push service could not create a subscription. This can happen even with one tab when browser push is restricted by a privacy setting, extension, or browser policy. Try a normal Chrome or Edge window, allow notifications for this exact address, reload, and try again."
    }
    return detail
      ? `Browser notifications are allowed, but this browser's Push service rejected registration: ${detail}`
      : "Browser notifications are allowed, but this browser's Push service rejected registration. Try a normal Chrome or Edge window, allow notifications for this exact address, reload, and try again."
  }
  if (
    permission === "denied" ||
    lower.includes("blocked") ||
    lower.includes("permission denied")
  ) {
    return "Browser notifications are blocked for this site. Open the browser site settings, choose Allow for E-Boses, reload, and try again."
  }
  if (permission === "default" && lower.includes("permission")) {
    return "The browser did not grant notification permission. Click Enable again and choose Allow when prompted."
  }
  if (
    lower.includes("vapid") ||
    lower.includes("public key") ||
    lower.includes("key pair")
  ) {
    return "Browser notifications are not configured correctly on the server. Please contact the administrator."
  }
  if (lower.includes("not configured") || lower.includes("server push")) {
    return "Browser notifications are not configured on the server yet. In-app notifications will still work."
  }
  if (lower.includes("service worker")) {
    return "E-Boses could not start its notification worker. Reload the page and try again."
  }
  if (
    lower.includes("push service") ||
    lower.includes("push subscription") ||
    lower.includes("subscription")
  ) {
    return "The browser rejected push registration. Close duplicate E-Boses tabs, reload, and try again."
  }
  if (detail) return detail
  return `Could not ${action} browser notifications. Reload the page and try again.`
}

export async function registerNotificationWorker() {
  if (!browserNotificationsSupported()) return null
  return registerAppServiceWorker()
}

async function getPublicKeyResponse() {
  const response = await apiRequest<{
    public_key: string
    config?: BrowserNotificationState["config"]
  }>("/notifications/browser-push/public-key/")
  return {
    publicKey: (response.public_key || "").trim().replace(/^["']|["']$/g, ""),
    config: response.config,
  }
}

export async function getBrowserNotificationState(): Promise<BrowserNotificationState> {
  if (!browserNotificationsSupported()) {
    return {
      supported: false,
      permission: "unsupported",
      serverConfigured: false,
      subscribed: false,
    }
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
  let subscribed = false
  if (subscription && publicKey) {
    try {
      subscribed = buffersMatch(
        subscription.options.applicationServerKey,
        urlBase64ToUint8Array(publicKey)
      )
    } catch {
      subscribed = false
    }
  }
  return {
    supported: true,
    permission: Notification.permission,
    serverConfigured: Boolean(publicKey),
    subscribed,
    config,
  }
}

export async function enableBrowserNotifications() {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("Browser push requires a trusted HTTPS E-Boses address.")
  }
  if (!browserNotificationsSupported()) {
    throw new Error("Browser notifications are not supported on this device.")
  }
  const permission = await Notification.requestPermission()
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Change site permissions to Allow, then try Enable push again."
        : "Notification permission was dismissed. Click Enable push again and choose Allow."
    )
  }
  const registration = await registerNotificationWorker()
  if (!registration) {
    const detail = getLastServiceWorkerError()
    throw new Error(
      detail
        ? `Service worker could not register: ${detail}`
        : "Service worker could not register. Reload the page, then try Enable push again."
    )
  }
  if (!("PushManager" in window)) {
    throw new Error("PushManager is not available in this browser.")
  }

  const keyResponse = await getPublicKeyResponse()
  const public_key = keyResponse.publicKey
  if (!public_key) {
    throw new Error(
      "Server push is not configured yet. In-app notifications will still work."
    )
  }
  const keyConfig = keyResponse.config
  if (
    keyConfig?.configured === false ||
    keyConfig?.public_key_format_valid === false ||
    keyConfig?.key_pair_valid === false ||
    keyConfig?.subject_valid === false
  ) {
    throw new Error(
      "VAPID browser push configuration is invalid. Please contact the administrator."
    )
  }

  const applicationServerKey = urlBase64ToUint8Array(public_key)
  const existingSubscription = await registration.pushManager.getSubscription()
  if (
    existingSubscription &&
    !buffersMatch(
      existingSubscription.options.applicationServerKey,
      applicationServerKey
    )
  ) {
    await apiRequest("/notifications/browser-push/subscriptions/", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: existingSubscription.endpoint }),
    }).catch(() => undefined)
    await existingSubscription.unsubscribe().catch(() => undefined)
  }

  const subscribe = async (serviceWorker: ServiceWorkerRegistration) =>
    serviceWorker.pushManager.subscribe({
      userVisibleOnly: true,
      // Edge is more reliable when the VAPID key is passed as an ArrayBuffer
      // instead of a typed-array view, even though both are valid BufferSource
      // values according to the Push API.
      applicationServerKey: applicationServerKey.buffer,
    })

  const recoverPushState = async () => {
    await existingSubscription?.unsubscribe().catch(() => undefined)
    await unregisterStaleServiceWorker().catch(() => undefined)
    const freshRegistration = await registerNotificationWorker()
    if (!freshRegistration) return null
    await freshRegistration.update().catch(() => undefined)
    const activeWorker =
      freshRegistration.active ?? (await ensureServiceWorkerActive())?.active
    if (!activeWorker) return null
    return subscribe(freshRegistration)
  }

  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await (async () => {
      try {
        const serviceWorker = await ensureServiceWorkerActive()
        if (!serviceWorker) return null
        return await subscribe(serviceWorker)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        const isPushServiceError =
          detail.toLowerCase().includes("push service") ||
          (error instanceof DOMException &&
            ["AbortError", "InvalidStateError", "NotAllowedError"].includes(
              error.name
            ) &&
            Notification.permission === "granted")
        if (isPushServiceError) {
          try {
            const recovered = await recoverPushState()
            if (recovered) return recovered
          } catch {
            // Fall through to the original browser-facing error below.
          }
          throw new Error(
            "Browser push service registration failed after one recovery attempt. Close duplicate E-Boses tabs, reload, and retry. If it continues, check browser notification permission and privacy extensions.",
            { cause: error }
          )
        }
        throw new Error(
          `Browser push subscription failed (${error instanceof DOMException ? error.name : "browser error"}): ${detail || "unknown error"}. Reload the page and try again on a trusted HTTPS origin.`,
          { cause: error }
        )
      }
    })())
  if (!subscription) {
    throw new Error(
      "Could not subscribe to push notifications. Reload the page and try Enable push again."
    )
  }
  await apiRequest("/notifications/browser-push/subscriptions/", {
    method: "POST",
    body: JSON.stringify(subscription.toJSON()),
  })
  return permission
}

export async function showBrowserNotificationFeedback(
  lastName: string | undefined,
  enabled: boolean
) {
  if (!browserNotificationsSupported() || Notification.permission !== "granted")
    return false
  const registration = await registerNotificationWorker()
  if (!registration?.active) return false
  const state = enabled ? "enabled" : "disabled"
  registration.active.postMessage({
    type: "eboses.show-notification",
    payload: {
      title: enabled
        ? "Browser notifications enabled"
        : "Browser notifications disabled",
      body: `${browserClockGreeting(lastName)} Browser notifications are now ${state} on this device.`,
      url: "/dashboard/notifications",
      tag: `eboses-browser-notifications-${state}`,
      category: "system",
      priority: "important",
      icon: "/icons/notification-system.svg",
      badge: "/icons/notification-badge.svg",
      timestamp: new Date().toISOString(),
      data: { settings_confirmation: true },
    },
  })
  return true
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
  if (!browserNotificationsSupported() || Notification.permission !== "granted")
    return
  const registration = await registerNotificationWorker()
  const url =
    item.action_url ||
    (item.emergency_id
      ? "/dashboard/home"
      : item.concern_id
        ? `/dashboard/reports/${item.concern_public_id || item.concern_id}`
        : "/dashboard/home")
  const rawBody = (
    item.display_body ||
    item.body ||
    "Open E-Boses for details."
  )
    .replace(/\s+/g, " ")
    .trim()
  const body =
    rawBody.length > 90
      ? `${(
          rawBody
            .slice(0, 90)
            .replace(/\s+\S*$/, "")
            .trim() || rawBody.slice(0, 90)
        ).trim()}...`
      : rawBody
  // Native notification renderers fetch images without the app's bearer
  // token. Public, processed media can be shown; authenticated API previews
  // stay inside the app and open after the user taps the notification.
  const notificationImage =
    item.image_url &&
    !new URL(item.image_url, window.location.origin).pathname.startsWith(
      "/api/"
    )
      ? item.image_url
      : undefined

  registration?.active?.postMessage({
    type: "eboses.show-notification",
    payload: {
      title: item.display_title || item.title || "E-Boses update",
      body,
      url,
      tag: item.tag,
      category: item.category,
      priority: item.priority,
      icon: item.icon_url || "/icons/notification-system.svg",
      badge: item.badge_url || "/icons/notification-badge.svg",
      image: notificationImage,
      actions: item.actions?.length
        ? item.actions
        : item.action_label
          ? [{ action: "open", title: item.action_label, url }]
          : undefined,
      requireInteraction: item.priority === "urgent",
      // Each server notification has a unique tag. Explicitly renotify so a
      // browser never silently replaces an earlier report/message alert.
      renotify: true,
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
