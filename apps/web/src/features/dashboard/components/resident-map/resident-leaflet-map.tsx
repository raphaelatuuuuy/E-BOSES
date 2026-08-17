import { useCallback, useEffect, useRef, useState } from "react"

import type {
  Announcement,
  Concern,
  GeoJsonPolygon,
  ResidentAlertsMapSnapshot,
  ResidentMapEmergency,
} from "@/features/dashboard/api"
import {
  categoryMeta,
  emergencyBrief,
  isLocalGps,
  MAP_BOUNDS,
  validCoord,
} from "@/features/dashboard/lib/resident-map-utils"
import { timeAgo } from "@/features/dashboard/lib/format"
import { formatFixTime } from "@/features/dashboard/lib/last-known-position"
import { advisoryMeta, advisoryMarkerHtml } from "@/features/dashboard/components/community-content/advisory-tags"
import { MAP_COLORS } from "@/features/dashboard/components/alerts-map/lib"
import {
  concernMarkerHtml,
  concernMarkerSize,
  isResolvedStatus,
} from "@/features/dashboard/components/map/concern-marker"
import { geoJsonToRing, polygonCentroid } from "@/features/dashboard/components/community-content/area-lib"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"

import type leaflet from "leaflet"

export type MapApi = {
  flyTo: (lat: number, lng: number, zoom?: number) => void
  panTo: (lat: number, lng: number) => void
  invalidateSize: () => void
  /** Fit the whole barangay boundary (Home). */
  fitBoundary: (paddingBottom?: number) => void
  zoomIn: () => void
  zoomOut: () => void
}

/** Ongoing SOS pin — red pulse-style dot */
function emergencyDotHtml() {
  return `<div style="position:relative;width:26px;height:26px">
    <div style="position:absolute;inset:0;border-radius:999px;background:rgba(220,38,38,.28)"></div>
    <div style="position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);border-radius:999px;background:#dc2626;border:2.5px solid #fff;box-shadow:0 2px 10px rgba(220,38,38,.45)"></div>
  </div>`
}

function userPinHtml() {
  return `<div style="position:relative;width:28px;height:28px">
    <div style="position:absolute;inset:0;border-radius:999px;background:rgba(59,130,246,.25)"></div>
    <div style="position:absolute;left:50%;top:50%;width:14px;height:14px;transform:translate(-50%,-50%);border-radius:999px;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 10px rgba(37,99,235,.45)"></div>
  </div>`
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Resident alerts map — Leaflet + Carto light basemap, feed-post + ongoing-
 * emergency markers, plus the (optional) device-GPS pin. Extracted from
 * `pages/resident-alerts-map.tsx` (was `AlertsLeafletMap`); renamed to avoid
 * confusion with the responder `components/alerts-map/leaflet-map.tsx`
 * component of the same historical name.
 */
export function ResidentLeafletMap({
  center,
  boundary,
  posts,
  emergencies = [],
  announcements = [],
  selectedId,
  selectedEmergencyId,
  selectedAnnouncementId,
  userPos,
  userPosAt,
  onSelect,
  onSelectEmergency,
  onSelectAnnouncement,
  onReady,
  onMapInteract,
}: {
  center: { latitude: number; longitude: number; zoom: number }
  boundary?: ResidentAlertsMapSnapshot["map"]["boundary"] | null
  posts: Concern[]
  emergencies?: ResidentMapEmergency[]
  /** Published barangay advisories that carry a drawn affected area. */
  announcements?: Announcement[]
  selectedId: number | null
  selectedEmergencyId?: number | null
  /** Advisories keep their barangay highlight while their panel is open. */
  selectedAnnouncementId?: number | null
  userPos: { lat: number; lng: number } | null
  /** Epoch ms of the last GPS fix (shown under the user pin tooltip). */
  userPosAt?: number | null
  onSelect: (id: number) => void
  onSelectEmergency?: (id: number) => void
  onSelectAnnouncement?: (id: number) => void
  onReady: (api: MapApi) => void
  onMapInteract?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const groupRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryLayerRef = useRef<leaflet.GeoJSON | null>(null)
  const advisoryRoadsRef = useRef<
    Map<number, { roads: Array<{ casing: leaflet.Polyline; core: leaflet.Polyline }>; wide: string | null }>
  >(new Map())
  const highlightGroupRef = useRef<leaflet.LayerGroup | null>(null)
  const hoverIdRef = useRef<number | null>(null)
  const focusIdRef = useRef<number | null>(null)
  const onMapInteractRef = useRef(onMapInteract)
  useEffect(() => {
    onMapInteractRef.current = onMapInteract
  }, [onMapInteract])
  const [mapReady, setMapReady] = useState(false)

  const boundaryGeomKey = boundary?.geometry ? JSON.stringify(boundary.geometry) : ""
  const fittedGeomKeyRef = useRef("")

  // Advisory pin hover/focus: dimmed roads at rest; on focus the advisory's
  // roads go full-strength and a barangay-wide advisory fills the boundary.
  const applyAdvisoryFocus = useCallback(
    (id: number | null) => {
      const L = LRef.current
      const highlight = highlightGroupRef.current
      if (!L || !highlight) return
      highlight.clearLayers()
      for (const [key, entry] of advisoryRoadsRef.current) {
        const strong = id != null && key === id
        for (const { casing, core } of entry.roads) {
          casing.setStyle({ opacity: strong ? 0.95 : 0.55 })
          core.setStyle({ opacity: strong ? 0.95 : 0.4 })
        }
      }
      const entry = id != null ? advisoryRoadsRef.current.get(id) : null
      if (entry?.wide && boundary?.geometry) {
        const ring = geoJsonToRing(boundary.geometry as GeoJsonPolygon)
        if (ring.length >= 3) {
          L.polygon(ring, {
            color: entry.wide,
            weight: 2,
            opacity: 0.9,
            fillColor: entry.wide,
            fillOpacity: 0.15,
            interactive: false,
          }).addTo(highlight)
        }
      }
    },
    [boundary],
  )

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null
    let ro: ResizeObserver | null = null
    const sizeTimers: number[] = []

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      // Leaflet re-inits into the same node if Strict Mode remounts
      if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        containerRef.current.innerHTML = ""
      }
      LRef.current = L

      // Keep the map inside greater Marikina so tiles stay meaningful
      const maxBounds = L.latLngBounds(
        [MAP_BOUNDS.minLat - 0.02, MAP_BOUNDS.minLng - 0.02],
        [MAP_BOUNDS.maxLat + 0.02, MAP_BOUNDS.maxLng + 0.02],
      )

      map = L.map(containerRef.current, {
        center: [center.latitude, center.longitude],
        zoom: Math.min(Math.max(center.zoom || 15, 13), 17),
        minZoom: 12,
        maxZoom: 19,
        maxBounds,
        maxBoundsViscosity: 0.85,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: false,
        fadeAnimation: false,
        zoomAnimation: true,
        markerZoomAnimation: false,
      })

      /**
       * Product basemap: Carto light (clean grey streets — original E-Boses look).
       * Tailwind img max-width is overridden via .eboses-alerts-map CSS so
       * tiles stay visible.
       */
      const carto = L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
          attribution: "&copy; OpenStreetMap &copy; CARTO",
          maxZoom: 19,
          subdomains: "abcd",
          keepBuffer: 6,
          updateWhenIdle: true,
          className: "eboses-map-tiles",
        },
      )
      carto.addTo(map)

      // Hover-only barangay fill: sits beneath every advisory road/marker.
      highlightGroupRef.current = L.layerGroup().addTo(map)
      groupRef.current = L.layerGroup().addTo(map)
      mapRef.current = map

      const forcePaint = () => {
        if (!map || cancelled) return
        map.invalidateSize({ animate: false })
        // Nudge tile reload after layout settles (fixes grey pane)
        const z = map.getZoom()
        map.setZoom(z, { animate: false })
      }

      // Keep tiles painted when sheet / layout resizes the container
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        let resizeTimer: number | undefined
        ro = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(forcePaint, 60)
        })
        ro.observe(containerRef.current)
      }

      const notifyInteract = () => onMapInteractRef.current?.()
      map.on("dragstart", notifyInteract)
      map.on("zoomstart", notifyInteract)
      map.on("click", notifyInteract)

      const goTo = (lat: number, lng: number, zoom = 17) => {
        if (!map) return
        forcePaint()
        map.setView([lat, lng], Math.min(zoom, 18), { animate: true })
      }

      const fitBoundary = (paddingBottom = 24) => {
        if (!map) return
        forcePaint()
        const layer = boundaryLayerRef.current
        if (layer) {
          const bounds = layer.getBounds()
          if (bounds.isValid()) {
            map.fitBounds(bounds, {
              paddingTopLeft: [28, 28],
              paddingBottomRight: [28, Math.max(28, paddingBottom)],
              maxZoom: 16,
              animate: false,
            })
            forcePaint()
            return
          }
        }
        map.setView([center.latitude, center.longitude], 15, { animate: false })
        forcePaint()
      }

      if (!cancelled) {
        setMapReady(true)
        onReady({
          flyTo: goTo,
          panTo: (lat, lng) => {
            forcePaint()
            map?.panTo([lat, lng], { animate: true })
          },
          invalidateSize: () => forcePaint(),
          fitBoundary,
          zoomIn: () => map?.zoomIn(),
          zoomOut: () => map?.zoomOut(),
        })
        // Multiple paints: container often still settling after route mount
        requestAnimationFrame(forcePaint)
        sizeTimers.push(window.setTimeout(forcePaint, 50))
        sizeTimers.push(window.setTimeout(forcePaint, 200))
        sizeTimers.push(window.setTimeout(() => fitBoundary(48), 120))
      }
    }

    void init()
    return () => {
      cancelled = true
      ro?.disconnect()
      for (const t of sizeTimers) window.clearTimeout(t)
      try {
        map?.off()
        map?.remove()
      } catch {
        /* Leaflet may already have detached the pane */
      }
      mapRef.current = null
      LRef.current = null
      groupRef.current = null
      boundaryLayerRef.current = null
      fittedGeomKeyRef.current = ""
      highlightGroupRef.current = null
      hoverIdRef.current = null
      focusIdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply boundary when geometry first arrives / actually changes (not every soft reload)
  useEffect(() => {
    if (!mapReady) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (!boundaryGeomKey || !boundary?.geometry) return
    if (fittedGeomKeyRef.current === boundaryGeomKey) return

    if (boundaryLayerRef.current) {
      try {
        map.removeLayer(boundaryLayerRef.current)
      } catch {
        /* ignore */
      }
      boundaryLayerRef.current = null
    }
    boundaryLayerRef.current = L.geoJSON(boundary.geometry as Parameters<typeof L.geoJSON>[0], {
      style: {
        color: "#64748b",
        weight: 2,
        fillColor: "#94a3b8",
        fillOpacity: 0.08,
        opacity: 0.75,
        dashArray: "4 4",
      },
    }).addTo(map)
    try {
      const bounds = boundaryLayerRef.current.getBounds()
      if (bounds.isValid()) {
        map.invalidateSize({ animate: false })
        map.fitBounds(bounds, {
          paddingTopLeft: [28, 28],
          paddingBottomRight: [28, 48],
          maxZoom: 16,
          animate: false,
        })
        fittedGeomKeyRef.current = boundaryGeomKey
      }
    } catch {
      /* ignore invalid geometry */
    }
  }, [mapReady, boundaryGeomKey, boundary?.geometry])

  useEffect(() => {
    if (!mapReady) return
    const L = LRef.current
    const group = groupRef.current
    if (!L || !group) return
    group.clearLayers()
    advisoryRoadsRef.current.clear()
    highlightGroupRef.current?.clearLayers()
    hoverIdRef.current = null

    // Only plot device GPS when near Marikina (avoids far-away user pin)
    if (userPos && isLocalGps(userPos)) {
      const userMarker = L.marker([userPos.lat, userPos.lng], {
        icon: L.divIcon({
          className: "",
          html: userPinHtml(),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 1200,
        keyboard: false,
      })
      userMarker.bindTooltip(
        `<div style="font:600 12px/1.5 system-ui,sans-serif;color:#0f172a;max-width:200px">
          <div style="font-weight:800;color:#1d4ed8;margin-bottom:1px">You</div>
          ${
            userPosAt != null && Number.isFinite(userPosAt)
              ? `<div style="font-weight:500;color:#64748b">Last known: ${escapeHtml(formatFixTime(userPosAt))}</div>`
              : ""
          }
        </div>`,
        {
          direction: "top",
          offset: [0, -10],
          opacity: 1,
          className: "eboses-em-tip",
          permanent: false,
        },
      )
      userMarker.addTo(group)
    }

    for (const post of posts) {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) continue
      const selected = selectedId === post.id
      const pinSize = concernMarkerSize(selected)
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: concernMarkerHtml({
            category: post.category,
            status: post.status,
            selected,
          }),
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        zIndexOffset: selected ? 900 : 100,
      })
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelect(post.id)
      })
      const meta = categoryMeta[post.category]
      const catLabel = meta?.label ?? post.category.replace(/_/g, " ")
      marker.bindTooltip(
        `<div style="font:600 11px/1.45 system-ui,sans-serif;color:#0f172a;max-width:200px">
          <div style="font-weight:800;color:${meta?.color ?? "#475569"}">${escapeHtml(catLabel)}</div>
          ${
            isResolvedStatus(post.status)
              ? `<div style="font-weight:700;color:${MAP_COLORS.resolved}">Resolved</div>`
              : ""
          }
          ${
            post.created_at
              ? `<div style="font-weight:500;color:#64748b">Posted ${escapeHtml(timeAgo(post.created_at))} ago</div>`
              : ""
          }
        </div>`,
        {
          direction: "top",
          offset: [0, -8],
          opacity: 1,
          className: "eboses-em-tip",
          permanent: false,
        },
      )
      marker.addTo(group)
    }

    // Barangay advisories — the affected-area outline plus a tag icon at its
    // centroid. Officials pick the tag (water, electric, road, flooding,
    // general), so each advisory reads as its icon + color on the map.
    /** One advisory marker, wherever the advisory's anchor turns out to be. */
    const addAdvisoryMarker = (announcement: Announcement, at: leaflet.LatLngTuple) => {
      const id = announcement.id
      const tagColor = advisoryMeta(announcement.tag).color
      const marker = L.marker(at, {
        icon: L.divIcon({
          className: "",
          html: advisoryMarkerHtml(announcement.tag),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        zIndexOffset: 600,
        keyboard: true,
      })
      marker.on("mouseover", () => {
        hoverIdRef.current = id
        applyAdvisoryFocus(id)
      })
      marker.on("mouseout", () => {
        hoverIdRef.current = null
        applyAdvisoryFocus(focusIdRef.current)
      })
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectAnnouncement?.(id)
      })
      const icon = marker.getElement()
      if (icon) {
        icon.addEventListener("focus", () => {
          focusIdRef.current = id
          applyAdvisoryFocus(id)
        })
        icon.addEventListener("blur", () => {
          focusIdRef.current = null
          applyAdvisoryFocus(hoverIdRef.current)
        })
      }
      marker.bindTooltip(
        `<div style="font:600 11px/1.45 system-ui,sans-serif;color:#0f172a;max-width:220px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="font-weight:800;color:${tagColor}">${escapeHtml(announcement.tag || "Announcement")}</span>
            ${
              announcement.is_pinned
                ? `<span style="font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:${tagColor};border-radius:999px;padding:1px 6px">PINNED</span>`
                : ""
            }
          </div>
          <div style="font-weight:800;color:#0f172a;margin-bottom:2px">${escapeHtml(announcement.title)}</div>
          ${
            announcement.place_label
              ? `<div style="font-weight:600;color:#475569">${escapeHtml(announcement.place_label)}</div>`
              : ""
          }
          ${
            announcement.created_at
              ? `<div style="font-weight:500;color:#64748b">Posted ${escapeHtml(timeAgo(announcement.created_at))} ago</div>`
              : ""
          }
        </div>`,
        {
          direction: "top",
          offset: [0, -14],
          opacity: 1,
          className: "eboses-em-tip",
          permanent: false,
        },
      )
      marker.addTo(group)
    }

    for (const announcement of announcements) {
      const geometry = announcement.area_geometry
      const point = validCoord(announcement.latitude, announcement.longitude)
      const tagColor = advisoryMeta(announcement.tag).color
      const roads: Array<{ casing: leaflet.Polyline; core: leaflet.Polyline }> = []

      // An explicit point wins: the official pinned that exact place.
      if (point) addAdvisoryMarker(announcement, point)

      if (!geometry) {
        const drawRoad = (run: leaflet.LatLngTuple[]) => {
          const casing = L.polyline(run, {
            color: "#ffffff",
            weight: 8,
            opacity: 0.55,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(group)
          const core = L.polyline(run, {
            color: tagColor,
            weight: 3,
            opacity: 0.4,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }).addTo(group)
          roads.push({ casing, core })
        }
        let anchor: leaflet.LatLngTuple | null = null
        for (const line of announcement.street_geometries ?? []) {
          const points = geoJsonToLines(line)
          for (const run of points) {
            drawRoad(run)
            if (!anchor && run.length > 0) anchor = run[Math.floor(run.length / 2)] ?? null
          }
        }
        if (!point && !anchor) {
          const bGeometry = boundary?.geometry as GeoJsonPolygon | null
          const ring = bGeometry ? geoJsonToRing(bGeometry) : []
          const centroid = ring.length > 2 ? polygonCentroid(bGeometry) : null
          addAdvisoryMarker(announcement, centroid ?? [center.latitude, center.longitude])
          advisoryRoadsRef.current.set(announcement.id, { roads: [], wide: tagColor })
        } else if (!point && anchor) {
          addAdvisoryMarker(announcement, anchor)
        }
        if (roads.length > 0) advisoryRoadsRef.current.set(announcement.id, { roads, wide: null })
        continue
      }
      try {
        const areaLayer = L.geoJSON(geometry as Parameters<typeof L.geoJSON>[0], {
          style: {
            color: tagColor,
            weight: 1.5,
            opacity: 0.55,
            fillColor: tagColor,
            fillOpacity: 0.18,
            interactive: false,
          },
        })
        areaLayer.addTo(group)

        // Without an explicit point, the corridor's centroid carries the icon.
        const centroid = point ? null : polygonCentroid(geometry)
        if (centroid) addAdvisoryMarker(announcement, centroid)
      } catch {
        /* skip a malformed geometry */
      }
    }

    // Ongoing emergencies — red dots + brief label
    for (const em of emergencies) {
      const pos = validCoord(em.latitude, em.longitude)
      if (!pos) continue
      const selected = selectedEmergencyId === em.id
      const brief = emergencyBrief(em)
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: emergencyDotHtml(),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        zIndexOffset: selected ? 1100 : 800,
      })
      marker.bindTooltip(
        `<div style="font:600 11px/1.25 system-ui,sans-serif;color:#0f172a;max-width:180px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <span style="color:#dc2626;font-weight:800">${escapeHtml(brief.title)}</span>
            ${
              brief.status.live
                ? `<span style="font-size:9px;font-weight:800;letter-spacing:.04em;color:#fff;background:#dc2626;border-radius:999px;padding:1px 6px">LIVE</span>`
                : ""
            }
          </div>
          <div style="font-weight:600;color:#b91c1c;margin-bottom:2px">${escapeHtml(brief.status.label)}</div>
          ${
            em.created_at
              ? `<div style="font-weight:500;color:#64748b">Posted ${escapeHtml(timeAgo(em.created_at))} ago</div>`
              : ""
          }
        </div>`,
        {
          direction: "top",
          offset: [0, -12],
          opacity: 1,
          className: "eboses-em-tip",
          permanent: false,
        },
      )
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectEmergency?.(em.id)
      })
      marker.addTo(group)
    }
    // Re-apply after a rebuild: a selection survives while a hover does not.
    applyAdvisoryFocus(focusIdRef.current)
  }, [mapReady, posts, emergencies, announcements, selectedId, selectedEmergencyId, userPos, userPosAt, onSelect, onSelectEmergency, onSelectAnnouncement, boundary?.geometry, center.latitude, center.longitude, applyAdvisoryFocus])

  useEffect(() => {
    if (!mapReady || selectedId == null || !mapRef.current) return
    const post = posts.find((p) => p.id === selectedId)
    const pos = post ? validCoord(post.latitude, post.longitude) : null
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedId, posts])

  useEffect(() => {
    if (!mapReady || selectedEmergencyId == null || !mapRef.current) return
    const em = emergencies.find((e) => e.id === selectedEmergencyId)
    const pos = em ? validCoord(em.latitude, em.longitude) : null
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedEmergencyId, emergencies])

  // Opening an advisory keeps its barangay highlight while the panel is open;
  // closing the panel drops it back to hover-only.
  useEffect(() => {
    if (!mapReady) return
    if (selectedAnnouncementId == null) {
      if (focusIdRef.current != null) {
        focusIdRef.current = null
        applyAdvisoryFocus(hoverIdRef.current)
      }
    } else {
      focusIdRef.current = selectedAnnouncementId
      applyAdvisoryFocus(selectedAnnouncementId)
    }
  }, [mapReady, selectedAnnouncementId, applyAdvisoryFocus])

  return (
    <>
      {/*
        Tailwind Preflight sets img { max-width: 100% }, which collapses Leaflet
        tiles into a blank grey map. Override inside our map container only.
      */}
      <style>{`
        .eboses-alerts-map.leaflet-container {
          width: 100%;
          height: 100%;
          background: #e8eef5;
          font: inherit;
        }
        .eboses-alerts-map .leaflet-tile-pane,
        .eboses-alerts-map .leaflet-overlay-pane,
        .eboses-alerts-map .leaflet-shadow-pane,
        .eboses-alerts-map .leaflet-marker-pane,
        .eboses-alerts-map .leaflet-tooltip-pane,
        .eboses-alerts-map .leaflet-popup-pane {
          z-index: auto;
        }
        .eboses-em-tip {
          background: #fff !important;
          border: 1px solid #e5e7eb !important;
          border-radius: 10px !important;
          box-shadow: 0 6px 18px rgba(15,23,42,.14) !important;
          padding: 6px 8px !important;
        }
        .eboses-em-tip::before { border-top-color: #fff !important; }
        .eboses-alerts-map img.leaflet-tile,
        .eboses-alerts-map .leaflet-tile,
        .eboses-alerts-map .eboses-map-tiles {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
        }
        .eboses-alerts-map .leaflet-container img {
          max-width: none !important;
        }
      `}</style>
      <div
        ref={containerRef}
        className="eboses-alerts-map absolute inset-0 z-0 h-full w-full bg-tint"
        style={{ minHeight: "100%" }}
      />
    </>
  )
}