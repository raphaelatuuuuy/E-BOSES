self.__EBOSES_CACHE = "eboses-shell-v15"
self.__EBOSES_MAP_CACHE = "eboses-map-v1"
self.__EBOSES_SHELL = ["/", "/dashboard", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]
self.__EBOSES_SOS_CONFIG = "/api/public/offline-sos-config/"
self.__EBOSES_PRECACHE = ["/assets/account-inactive-BkVrw5qw.js","/assets/account-otp-verification-CjYbqtvq.js","/assets/account-pending-BPv9MLDw.js","/assets/alerts-map-CkKRAN6s.js","/assets/announcement-summary-CXd59izC.js","/assets/announcement-summary-DZfFtSea.js","/assets/api-BN9P2esC.js","/assets/api-BlQbY2En.js","/assets/api-D4AgJkY-.js","/assets/api-DUifMPpI.js","/assets/api-errors-BPOnfggI.js","/assets/area-lib-CG2evZqp.js","/assets/assistant-widget-DgYmTxOk.js","/assets/auth-session-BtIBER0k.js","/assets/auth-side-panel-DFX0kR65.js","/assets/authenticated-media-C25sJu3B.js","/assets/authenticated-media-CuW0mEgy.js","/assets/comments-C5RgJWJ4.js","/assets/community-comments-ykYJkbJy.js","/assets/concern-description-block-g7Zt2WGJ.js","/assets/config-shell-36ujTClc.js","/assets/create-report-dialog-Dhw7tX9y.js","/assets/dist-B-mAnLoV.js","/assets/emergency-api-BHxim2QH.js","/assets/emergency-timeline-lib-BEvPFAtE.js","/assets/esm-BlYMYtf3.js","/assets/esm-CiXTFKg4.js","/assets/esm-DK3-rzLW.js","/assets/esm-Dou33PzS.js","/assets/esm-RFd9m1v6.js","/assets/feed-post-text-COFoAHQF.js","/assets/forgot-password-Dw3qNGHW.js","/assets/home-B0WNeZ63.js","/assets/index-Bkez0xWy.js","/assets/index-CIehVn8j.css","/assets/initials-Wz_LgQT4.js","/assets/leaflet-M4rVEBvM.js","/assets/leaflet-vh-t_kPv.css","/assets/lib-DTEVDwgK.js","/assets/list-controls-BrRRT89T.js","/assets/map-weather-BMr1Wdg5.js","/assets/native-help-Btfuz8Ns.js","/assets/new-password-Cy4rWkoc.js","/assets/not-found-DBX2Hf_Q.js","/assets/notifications-BL5yJT4X.js","/assets/official-categories-page-BuZfhUdC.js","/assets/official-community-content-page-CY9ZJ3PZ.js","/assets/official-configuration-hub-NfFXxAYr.js","/assets/official-coverage-area-page-DGXQ8RDT.js","/assets/official-id-proof-workspace-Bia98bX8.js","/assets/official-overview-BnFU4DH4.js","/assets/official-roles-page-ZesFYCXu.js","/assets/official-units-page-ColApFDN.js","/assets/official-users-manage-page-31kQJW__.js","/assets/offline-sos-config-Cikbfu5B.js","/assets/otp-verification-CcN9fCoj.js","/assets/password-requirements-list-90vs99Dq.js","/assets/profile-B1ADLNyQ.js","/assets/react-vendor-D_udBUjN.js","/assets/reports-DCEsP4w1.js","/assets/resident-alerts-map-c1RvFvY6.js","/assets/resident-overview-DDsUrf6v.js","/assets/responder-profile-B4otT7Sg.js","/assets/reverse-geocode-roOdU-OV.js","/assets/rolldown-runtime-QTnfLwEv.js","/assets/schemas-B7yrEZl8.js","/assets/service-status-section-CPImjIV7.js","/assets/sheet-dialog-BNaEOCmi.js","/assets/shell-G9EJVQTV.js","/assets/sign-in-DVHe1XES.js","/assets/sign-up-Bt4omL6e.js","/assets/street-view-D5jGi8Aj.js","/assets/tile-layers-Br4C5dZK.js","/assets/ui-vendor-58opRebb.js","/assets/ui-vendor-C7z84icw.css","/assets/use-page-title-BpXoQUMr.js","/assets/week-chart-B_TYskud.js","/icons/favicon.png","/icons/icon-192.png","/icons/icon-512.png","/icons/notification-announcement.svg","/icons/notification-appeal.svg","/icons/notification-assigned.svg","/icons/notification-badge.svg","/icons/notification-chat.svg","/icons/notification-crime.svg","/icons/notification-critical.svg","/icons/notification-decision.svg","/icons/notification-disaster.svg","/icons/notification-emergency.svg","/icons/notification-environment.svg","/icons/notification-fire.svg","/icons/notification-info-red.svg","/icons/notification-info.svg","/icons/notification-infrastructure.svg","/icons/notification-medical.svg","/icons/notification-moderation.svg","/icons/notification-progress.svg","/icons/notification-report.svg","/icons/notification-resolved.svg","/icons/notification-review.svg","/icons/notification-safety.svg","/icons/notification-system.svg","/tiles/10/856/469.png","/tiles/11/1712/939.png","/tiles/11/1713/939.png","/tiles/12/3425/1879.png","/tiles/12/3426/1879.png","/tiles/13/6851/3758.png","/tiles/13/6851/3759.png","/tiles/13/6852/3758.png","/tiles/13/6852/3759.png","/tiles/14/13703/7516.png","/tiles/14/13703/7517.png","/tiles/14/13703/7518.png","/tiles/14/13704/7516.png","/tiles/14/13704/7517.png","/tiles/14/13704/7518.png","/tiles/14/13705/7516.png","/tiles/14/13705/7517.png","/tiles/14/13705/7518.png","/tiles/15/27406/15033.png","/tiles/15/27406/15034.png","/tiles/15/27406/15035.png","/tiles/15/27406/15036.png","/tiles/15/27406/15037.png","/tiles/15/27407/15033.png","/tiles/15/27407/15034.png","/tiles/15/27407/15035.png","/tiles/15/27407/15036.png","/tiles/15/27407/15037.png","/tiles/15/27408/15033.png","/tiles/15/27408/15034.png","/tiles/15/27408/15035.png","/tiles/15/27408/15036.png","/tiles/15/27408/15037.png","/tiles/15/27409/15033.png","/tiles/15/27409/15034.png","/tiles/15/27409/15035.png","/tiles/15/27409/15036.png","/tiles/15/27409/15037.png","/tiles/15/27410/15033.png","/tiles/15/27410/15034.png","/tiles/15/27410/15035.png","/tiles/15/27410/15036.png","/tiles/15/27410/15037.png","/tiles/16/54813/30067.png","/tiles/16/54813/30068.png","/tiles/16/54813/30069.png","/tiles/16/54813/30070.png","/tiles/16/54813/30071.png","/tiles/16/54813/30072.png","/tiles/16/54813/30073.png","/tiles/16/54813/30074.png","/tiles/16/54814/30067.png","/tiles/16/54814/30068.png","/tiles/16/54814/30069.png","/tiles/16/54814/30070.png","/tiles/16/54814/30071.png","/tiles/16/54814/30072.png","/tiles/16/54814/30073.png","/tiles/16/54814/30074.png","/tiles/16/54815/30067.png","/tiles/16/54815/30068.png","/tiles/16/54815/30069.png","/tiles/16/54815/30070.png","/tiles/16/54815/30071.png","/tiles/16/54815/30072.png","/tiles/16/54815/30073.png","/tiles/16/54815/30074.png","/tiles/16/54816/30067.png","/tiles/16/54816/30068.png","/tiles/16/54816/30069.png","/tiles/16/54816/30070.png","/tiles/16/54816/30071.png","/tiles/16/54816/30072.png","/tiles/16/54816/30073.png","/tiles/16/54816/30074.png","/tiles/16/54817/30067.png","/tiles/16/54817/30068.png","/tiles/16/54817/30069.png","/tiles/16/54817/30070.png","/tiles/16/54817/30071.png","/tiles/16/54817/30072.png","/tiles/16/54817/30073.png","/tiles/16/54817/30074.png","/tiles/16/54818/30067.png","/tiles/16/54818/30068.png","/tiles/16/54818/30069.png","/tiles/16/54818/30070.png","/tiles/16/54818/30071.png","/tiles/16/54818/30072.png","/tiles/16/54818/30073.png","/tiles/16/54818/30074.png","/tiles/16/54819/30067.png","/tiles/16/54819/30068.png","/tiles/16/54819/30069.png","/tiles/16/54819/30070.png","/tiles/16/54819/30071.png","/tiles/16/54819/30072.png","/tiles/16/54819/30073.png","/tiles/16/54819/30074.png","/tiles/16/54820/30067.png","/tiles/16/54820/30068.png","/tiles/16/54820/30069.png","/tiles/16/54820/30070.png","/tiles/16/54820/30071.png","/tiles/16/54820/30072.png","/tiles/16/54820/30073.png","/tiles/16/54820/30074.png","/tiles/16/54821/30067.png","/tiles/16/54821/30068.png","/tiles/16/54821/30069.png","/tiles/16/54821/30070.png","/tiles/16/54821/30071.png","/tiles/16/54821/30072.png","/tiles/16/54821/30073.png","/tiles/16/54821/30074.png"]

// One URL per add, never addAll: a single 404 used to reject the whole promise,
// which silently aborted the install and left the device with no offline shell,
// no saved tiles and therefore no offline map at all.
async function cacheAll(cache, urls) {
  await Promise.allSettled((urls || []).map((url) => cache.add(url)))
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(self.__EBOSES_CACHE)
    await cacheAll(cache, self.__EBOSES_SHELL)
    // The offline map's tiles and the app's own chunks: without these a
    // completely offline launch renders a shell with no map and no imagery.
    await cacheAll(cache, self.__EBOSES_PRECACHE)
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
    // Retired build artifacts are dropped once the build-injected list exists:
    // hashed chunks and tiles this deployment did not ship. The keep list holds
    // every asset of the current build, so nothing still referenced can be
    // deleted, and nothing outside /assets and /tiles (navigations, the config,
    // on-demand /contents imagery, icons) is ever pruned. Skipped when the
    // build injected no list at all (dev).
    const keep = new Set(self.__EBOSES_PRECACHE || [])
    if (keep.size) {
      const cache = await caches.open(self.__EBOSES_CACHE)
      const retired = (await cache.keys())
        .map((request) => new URL(request.url).pathname)
        .filter(
          (path) =>
            (path.startsWith("/assets/") || path.startsWith("/tiles/")) &&
            !keep.has(path)
        )
      await Promise.all(retired.map((path) => cache.delete(path)))
    }
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
        return cached || Response.error()
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

  if (url.pathname.startsWith("/contents/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/tiles/")) {
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
