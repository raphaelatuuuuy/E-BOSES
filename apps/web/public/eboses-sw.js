self.__EBOSES_CACHE = "eboses-shell-v3"
self.__EBOSES_SHELL = ["/", "/dashboard", "/manifest.webmanifest", "/contents/logo.png"]

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(self.__EBOSES_CACHE)
    await cache.addAll(self.__EBOSES_SHELL)
    await self.skipWaiting()
  })())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith("eboses-") && name !== self.__EBOSES_CACHE).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) return

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        const cache = await caches.open(self.__EBOSES_CACHE)
        cache.put("/dashboard", response.clone())
        return response
      } catch {
        return (await caches.match("/dashboard")) || (await caches.match("/")) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.endsWith(".webmanifest")) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" })
        const type = response.headers.get("content-type") || ""
        if (response.ok && (type.includes("manifest") || type.includes("json"))) {
          const cache = await caches.open(self.__EBOSES_CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        return (await caches.match(request)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith("/contents/") || url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cached = await caches.match(request)
      const network = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(self.__EBOSES_CACHE)
          await cache.put(request, response.clone())
        }
        return response
      }).catch(() => cached)
      return cached || network
    })())
  }
})

function safeNotificationUrl(value) {
  try {
    return new URL(value || "/dashboard", self.location.origin).href
  } catch {
    return new URL("/dashboard", self.location.origin).href
  }
}

function cleanNotificationText(value, fallback) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  return text || fallback
}

function notificationActions(rawActions, fallbackUrl) {
  const actions = []
  const actionUrls = {}
  const maxActions = Math.max(0, Math.min(Number(Notification.maxActions || 2), 2))
  if (!Array.isArray(rawActions) || maxActions === 0) return { actions, actionUrls }
  for (const item of rawActions.slice(0, maxActions)) {
    if (!item || typeof item !== "object") continue
    const action = cleanNotificationText(item.action, "open").slice(0, 32)
    const title = cleanNotificationText(item.title, "Open").slice(0, 32)
    const url = safeNotificationUrl(item.url || fallbackUrl)
    actionUrls[action] = url
    const entry = { action, title }
    if (item.icon) entry.icon = item.icon
    actions.push(entry)
  }
  return { actions, actionUrls }
}

function buildNotificationOptions(data) {
  const url = safeNotificationUrl(data.url)
  const { actions, actionUrls } = notificationActions(data.actions, url)
  const options = {
    body: cleanNotificationText(data.body, "Open E-Boses for details."),
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    tag: data.tag || `eboses-${data.category || "update"}`,
    data: {
      url,
      actionUrls,
      notification: data.notification || null,
      meta: data.data || null,
    },
    actions,
    renotify: Boolean(data.renotify),
    requireInteraction: Boolean(data.requireInteraction || data.require_interaction),
    timestamp: Number.isFinite(Date.parse(data.timestamp)) ? Date.parse(data.timestamp) : Date.now(),
    silent: false,
  }
  if (data.image) options.image = data.image
  if (data.priority === "urgent" || data.category === "emergency") options.vibrate = [220, 90, 220]
  return options
}

function showEbosesNotification(data) {
  const title = cleanNotificationText(data.title, "E-Boses update")
  return self.registration.showNotification(title, buildNotificationOptions(data || {}))
}

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  event.waitUntil(showEbosesNotification(data))
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "eboses.show-notification") return
  const payload = event.data.payload || {}
  event.waitUntil(showEbosesNotification(payload))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const actionUrls = event.notification.data?.actionUrls || {}
  const url = (event.action && actionUrls[event.action]) || event.notification.data?.url || "/dashboard"
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

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "eboses-location-ping") return
  // ponytail: browsers do not expose reliable background GPS to service workers; active tabs send real pings.
})
