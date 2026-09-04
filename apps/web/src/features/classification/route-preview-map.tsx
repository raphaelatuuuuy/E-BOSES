"use client"

import { useEffect, useRef } from "react"
import type leaflet from "leaflet"

import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  GLYPHS,
  MAP_COLORS,
  glyphPinHtml,
} from "@/features/dashboard/components/map/markers"
import {
  drawRoute,
  routeRenderGeometry,
} from "@/features/dashboard/lib/route-line"

import type { LocationResolution, RoutePreview } from "./api"
import { routePreviewState } from "./route-preview-map-state"

type RoutingMapData = {
  scope: "local" | "cross_community" | "manual_dispatch"
  responder: { latitude: number | null; longitude: number | null } | null
  route: RoutePreview
}

const INCIDENT_PIN = 26
const RESPONDER_PIN = 24

export function RoutePreviewMap({
  location,
  routing,
}: {
  location: LocationResolution
  routing: RoutingMapData
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)

  useEffect(() => {
    let cancelled = false
    let observer: ResizeObserver | null = null
    let styleEl: HTMLStyleElement | null = null
    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      styleEl = document.createElement("style")
      styleEl.textContent = `
        .route-preview-map-scope .leaflet-container { width: 100%; height: 100%; font-family: inherit; }
        .route-preview-map-scope .leaflet-tile-pane { isolation: isolate; }
        .route-preview-map-scope img.leaflet-tile,
        .route-preview-map-scope .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
      `
      document.head.appendChild(styleEl)

      const map = L.map(containerRef.current, {
        center:
          location.latitude != null && location.longitude != null
            ? [location.latitude, location.longitude]
            : [14.5995, 120.9842],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
      })
      mapRef.current = map
      addBaseTiles(L, map, "dark", { keepBuffer: 6 })

      const state = routePreviewState(location, routing.route)
      const bounds = L.latLngBounds([])

      const destination: leaflet.LatLngTuple | null =
        state.showIncident &&
        location.latitude != null &&
        location.longitude != null
          ? [location.latitude, location.longitude]
          : null
      const origin: leaflet.LatLngTuple | null =
        state.showResponder &&
        routing.responder?.latitude != null &&
        routing.responder.longitude != null
          ? [routing.responder.latitude, routing.responder.longitude]
          : null

      if (destination) {
        const icon = L.divIcon({
          className: "",
          html: glyphPinHtml({
            paths: GLYPHS.emergency,
            color: MAP_COLORS.emergency,
            size: INCIDENT_PIN,
            live: true,
            tone: "dark",
          }),
          iconSize: [INCIDENT_PIN, INCIDENT_PIN],
          iconAnchor: [INCIDENT_PIN / 2, INCIDENT_PIN / 2],
        })
        L.marker(destination, { icon, zIndexOffset: 800 })
          .addTo(map)
          .bindTooltip("Incident", { direction: "top" })
        bounds.extend(destination)
      }

      if (origin) {
        const icon = L.divIcon({
          className: "",
          html: glyphPinHtml({
            paths: GLYPHS.userResponder,
            color: "#0a0a0a",
            size: RESPONDER_PIN,
            tone: "dark",
            className: "is-you",
          }),
          iconSize: [RESPONDER_PIN, RESPONDER_PIN],
          iconAnchor: [RESPONDER_PIN / 2, RESPONDER_PIN / 2],
        })
        L.marker(origin, { icon, zIndexOffset: 1000 })
          .addTo(map)
          .bindTooltip("Responder", { direction: "top" })
        bounds.extend(origin)
      }

      if (state.showRoute) {
        const geometry = routeRenderGeometry(routing.route, {
          origin,
          destination,
        })
        const route = drawRoute(L, map, { ...geometry, live: true, weight: 6 })
        for (const point of route?.points ?? []) bounds.extend(point)
      }

      if (bounds.isValid())
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 })

      observer = new ResizeObserver(() =>
        map.invalidateSize({ animate: false })
      )
      observer.observe(containerRef.current)
      requestAnimationFrame(() => map.invalidateSize({ animate: false }))
    })()
    return () => {
      cancelled = true
      observer?.disconnect()
      mapRef.current?.remove()
      mapRef.current = null
      styleEl?.remove()
    }
  }, [location, routing])

  return (
    <div className="route-preview-map-scope relative isolate h-72 overflow-hidden rounded-[14px] bg-ink">
      <div
        ref={containerRef}
        className="eboses-map-dark absolute inset-0"
        aria-label="Dispatch route map"
      />
      <style>{`
        .route-preview-map-scope .eboses-map-dark .eboses-pin--glyph .eboses-pin__disc {
          background: ${MAP_COLORS.emergency};
          border-color: rgb(255 255 255 / 0.28);
          color: #ffffff;
        }
        .route-preview-map-scope .eboses-map-dark .eboses-pin--glyph.is-you .eboses-pin__disc {
          background: #0a0a0a;
          color: #ffffff;
        }
        .route-preview-map-scope .eboses-map-dark .eboses-pin__halo { display: block; }
      `}</style>
    </div>
  )
}
