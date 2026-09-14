import { Capacitor } from "@capacitor/core"
import { PushNotifications } from "@capacitor/push-notifications"
import { apiRequest } from "@/lib/api"

let initialized = false
let currentToken = ""

export async function registerNativePush() {
  if (initialized || Capacitor.getPlatform() !== "android") return
  initialized = true
  await PushNotifications.addListener("registration", ({ value: token }) => {
    currentToken = token
    void apiRequest("/notifications/native-push/devices/", {
      method: "POST",
      body: JSON.stringify({ token, platform: "android" }),
    })
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
}

export async function unregisterNativePush() {
  if (!currentToken || Capacitor.getPlatform() !== "android") return
  await apiRequest("/notifications/native-push/devices/", {
    method: "DELETE",
    body: JSON.stringify({ token: currentToken }),
  })
  currentToken = ""
  initialized = false
}
