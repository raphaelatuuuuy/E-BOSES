import { useEffect, useRef, useState } from "react"

import type {
  Concern,
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

function markerDotHtml(color: string, selected: boolean) {
  const size = selected ? 34 : 22
  const border = selected ? 3 : 2
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:${border}px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.28)"></div>`
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
  selectedId,
  selectedEmergencyId,
  userPos,
  onSelect,
  onSelectEmergency,
  onReady,
  onMapInteract,
}: {
  center: { latitude: number; longitude: number; zoom: number }
  boundary?: ResidentAlertsMapSnapshot["map"]["boundary"] | null
  posts: Concern[]
  emergencies?: ResidentMapEmergency[]
  selectedId: number | null
  selectedEmergencyId?: number | null
  userPos: { lat: number; lng: number } | null
  onSelect: (id: number) => void
  onSelectEmergency?: (id: number) => void
  onReady: (api: MapApi) => void
  onMapInteract?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const groupRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryLayerRef = useRef<leaflet.GeoJSON | null>(null)
  const onMapInteractRef = useRef(onMapInteract)
  useEffect(() => {
    onMapInteractRef.current = onMapInteract
  }, [onMapInteract])
  const [mapReady, setMapReady] = useState(false)

  const boundaryGeomKey = boundary?.geometry ? JSON.stringify(boundary.geometry) : ""
  const fittedGeomKeyRef = useRef("")

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

    // Only plot device GPS when near Marikina (avoids far-away user pin)
    if (userPos && isLocalGps(userPos)) {
      L.marker([userPos.lat, userPos.lng], {
        icon: L.divIcon({
          className: "",
          html: userPinHtml(),
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        zIndexOffset: 1200,
        interactive: false,
        keyboard: false,
      }).addTo(group)
    }

    for (const post of posts) {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) continue
      const color = categoryMeta[post.category]?.color ?? "#64748b"
      const selected = selectedId === post.id
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: markerDotHtml(selected ? color : "#64748b", selected),
          iconSize: [selected ? 34 : 22, selected ? 34 : 22],
          iconAnchor: [selected ? 17 : 11, selected ? 17 : 11],
        }),
        zIndexOffset: selected ? 900 : 100,
      })
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelect(post.id)
      })
      marker.addTo(group)
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
          <div style="font-weight:500;color:#475569">${escapeHtml(brief.line)}</div>
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
  }, [mapReady, posts, emergencies, selectedId, selectedEmergencyId, userPos, onSelect, onSelectEmergency])

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