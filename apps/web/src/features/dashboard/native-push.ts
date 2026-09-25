import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { apiRequest } from "@/lib/api"

const TOKEN_STORAGE_KEY = "eboses:native-push-token"
let initialized = false
let initializationPromise: Promise<void> | null = null
let currentToken = typeof localStorage === "undefined" ? "" : localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""

async function registerCurrentToken(token: string) {
  currentToken = token
  if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_STORAGE_KEY, token)
  await apiRequest("/notifications/native-push/devices/", {
    method: "POST",
    body: JSON.stringify({ token, platform: "android" }),
  })
}

export function registerNativePush() {
  if (Capacitor.getPlatform() !== "android") return Promise.resolve()
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    if (initialized) {
      if (currentToken) await registerCurrentToken(currentToken)
      return
    }
    initialized = true
    await PushNotifications.addListener("registration", ({ value: token }) => {
      void registerCurrentToken(token).catch(() => undefined)
    })
    await PushNotifications.addListener("registrationError", () => {
      // A later authenticated mount can retry registration. The native app
      // must remain usable when Google Play services are temporarily absent.
    })
    await PushNotifications.addListener("pushNotificationReceived", () => {
      // Capacitor does not automatically redraw the foreground WebView when a
      // push arrives. Reconcile the persisted inbox so the native app shows
      // the same alert even when its WebSocket missed the event.
      window.dispatchEvent(new Event("eboses:notifications-refresh"))
    })
    await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const url = notification.data?.action_url
      if (typeof url === "string" && url.startsWith("/")) window.location.assign(url)
    })
    const current = await PushNotifications.checkPermissions()
    const permission = current.receive === "prompt"
      ? (await PushNotifications.requestPermissions()).receive
      : current.receive
    if (permission === "granted") await PushNotifications.register()
    if (currentToken) await registerCurrentToken(currentToken)
  })().catch((error) => {
    // Permit a later login/app mount to retry after a transient native error.
    initialized = false
    initializationPromise = null
    throw error
  })

  return initializationPromise
}

export async function disableNativePushForCurrentAccount() {
  if (!currentToken || Capacitor.getPlatform() !== "android") return
  await apiRequest("/notifications/native-push/devices/", {
    method: "DELETE",
    body: JSON.stringify({ token: currentToken }),
  })
}

export async function unregisterNativePush() {
  return disableNativePushForCurrentAccount()
}
