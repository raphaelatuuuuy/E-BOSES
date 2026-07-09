self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || "E-Boses update"
  const options = {
    body: data.body || "Open E-Boses for details.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: data.url || "/dashboard" },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "eboses.show-notification") return
  const payload = event.data.payload || {}
  event.waitUntil(self.registration.showNotification(payload.title || "E-Boses update", {
    body: payload.body || "Open E-Boses for details.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { url: payload.url || "/dashboard" },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = event.notification.data?.url || "/dashboard"
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true })
    const origin = self.location.origin
    for (const client of windows) {
      if (client.url.startsWith(origin) && "focus" in client) {
        await client.focus()
        client.postMessage({ type: "eboses.notification-click", url })
        return
      }
    }
    await clients.openWindow(url)
  })())
})
