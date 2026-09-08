self.__EBOSES_CACHE = "eboses-shell-v13"
self.__EBOSES_MAP_CACHE = "eboses-map-v1"
self.__EBOSES_SHELL = ["/", "/dashboard", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]
self.__EBOSES_SOS_CONFIG = "/api/public/offline-sos-config/"

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(self.__EBOSES_CACHE)
    await cache.addAll(self.__EBOSES_SHELL)
    try {
      const config = await fetch(self.__EBOSES_SOS_CONFIG, { cache: "no-store" })
      if (config.ok) await cache.put(self.__EBOSES_SOS_CONFIG, config)
    } catch {
      // The build-shipped baseline remains available if the API is unavailable.
    }
    await self.skipWaiting()
  })())
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith("eboses-") && name !== self.__EBOSES_CACHE && name !== self.__EBOSES_MAP_CACHE).map((name) => caches.delete(name)))
    await self.clients.claim()
  })())
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)
  const isTile = /^([a-d]\.)?basemaps\.cartocdn\.com$/.test(url.hostname) && url.protocol === "https:"
  const isAddress = url.origin === self.location.origin && url.pathname === "/api/locations/geocode/reverse/"
  if (isTile || isAddress) {
    event.respondWith((async () => {
      const cache = await caches.open(self.__EBOSES_MAP_CACHE)
      const cached = await cache.match(request)
      const savedAt = Number(cached?.headers.get("x-eboses-cached-at") || 0)
      if (cached && Date.now() - savedAt < 30 * 24 * 60 * 60 * 1000) return cached
      if (cached) await cache.delete(request)
      try {
        const response = await fetch(request)
        const usable = response.ok && (isTile || (await response.clone().json()).ok)
        if (usable) {
          const headers = new Headers(response.headers)
          headers.set("x-eboses-cached-at", String(Date.now()))
          await cache.put(request, new Response(await response.clone().blob(), {
            status: response.status,
            statusText: response.statusText,
            headers,
          }))
          const keys = await cache.keys()
          await Promise.all(keys.slice(0, Math.max(0, keys.length - 300)).map((key) => cache.delete(key)))
        }
        return response
      } catch {
        return Response.error()
      }
    })())
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname === self.__EBOSES_SOS_CONFIG) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" })
        if (response.ok) {
          const cache = await caches.open(self.__EBOSES_CACHE)
          await cache.put(self.__EBOSES_SOS_CONFIG, response.clone())
        }
        return response
      } catch {
        return (await caches.match(self.__EBOSES_SOS_CONFIG)) || Response.error()
      }
    })())
    return
  }
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

  if (url.pathname.startsWith("/contents/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    const revalidate = (async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(self.__EBOSES_CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        return null
      }
    })()

    event.respondWith((async () => {
      const cached = await caches.match(request)
      if (cached) {
        event.waitUntil(revalidate)
        return cached
      }
      return (await revalidate) || Response.error()
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
  return {
    body: cleanNotificationText(data.body, "Open E-Boses for details."),
    tag: data.tag || `eboses-${data.category || "update"}`,
    data: {
      url,
      actionUrls: {},
      notification: data.notification || null,
      meta: data.data || null,
    },
    renotify: Boolean(data.renotify),
    timestamp: Number.isFinite(Date.parse(data.timestamp)) ? Date.parse(data.timestamp) : Date.now(),
    silent: false,
  }
}

async function showEbosesNotification(data) {
  const title = cleanNotificationText(data.title, "E-Boses update")
  const payload = data || {}
  try {
    await self.registration.showNotification(title, buildNotificationOptions(payload))
  } catch {
    // Some Windows/browser combinations reject an otherwise valid rich option
    // (most often image, actions, or vibration). A push event must still result
    // in a visible notification while no E-Boses window is open, so retry with
    // the smallest universally supported option set.
    const url = safeNotificationUrl(payload.url)
    await self.registration.showNotification(title, {
      body: cleanNotificationText(payload.body, "Open E-Boses for details."),
      tag: payload.tag || `eboses-background-${Date.now()}`,
      data: {
        url,
        actionUrls: {},
        notification: null,
        meta: payload.data || null,
      },
      renotify: true,
      timestamp: Number.isFinite(Date.parse(payload.timestamp)) ? Date.parse(payload.timestamp) : Date.now(),
      silent: false,
    })
  }
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
