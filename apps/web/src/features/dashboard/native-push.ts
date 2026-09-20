import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { apiRequest } from "@/lib/api"

const TOKEN_STORAGE_KEY = "eboses:native-push-token"
let initialized = false
let currentToken = typeof localStorage === "undefined" ? "" : localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""

async function registerCurrentToken(token: string) {
  currentToken = token
  if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_STORAGE_KEY, token)
  await apiRequest("/notifications/native-push/devices/", {
    method: "POST",
    body: JSON.stringify({ token, platform: "android" }),
  })
}

export async function registerNativePush() {
  if (Capacitor.getPlatform() !== "android") return
  if (initialized) {
    if (currentToken) await registerCurrentToken(currentToken)
    return
  }
  initialized = true
  await PushNotifications.addListener("registration", ({ value: token }) => {
    void registerCurrentToken(token).catch(() => undefined)
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
