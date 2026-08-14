import { useEffect, useRef } from "react"
import type leaflet from "leaflet"

import type { GeoJsonPolygon } from "@/features/dashboard/api"
import { geoJsonToLines } from "@/features/dashboard/components/alerts-map/lib"
import { ADVISORY_COLOR, advisoryMarkerHtml } from "./advisory-tags"
import { polygonCentroid } from "./area-lib"

const STREET_COLOR = "#8b93a7"

/** Read-only mini-map of one affected area. Mounted lazily per row. */
export function AreaPreview({
  geometry,
  boundary,
  streets = [],
  tag = "",
  className = "",
}: {
  geometry: GeoJsonPolygon
  boundary?: { geometry?: unknown } | null
  streets?: Array<{ name: string; geometries?: unknown[] }>
  /** Advisory tag — shown as the area's icon marker. */
  tag?: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    let cancelled = false
    const created = { map: null as leaflet.Map | null }

    void (async () => {
      const L = (await import("leaflet")).default
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || created.map) return
      // Leaflet re-inits into the same node if Strict Mode remounts — clear
      // the stale `_leaflet_id` first or L.map() returns the removed map.
      if ((containerRef.current as HTMLDivElement & { _leaflet_id?: number })._leaflet_id) {
        containerRef.current.innerHTML = ""
      }

      const map = L.map(containerRef.current, {
        center: [14.6507, 121.1133],
        zoom: 15,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: false,
        touchZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        preferCanvas: true,
      })
      created.map = map
      containerRef.current.classList.add("eboses-area-preview-map")
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "",
        maxZoom: 19,
        subdomains: "abcd",
      }).addTo(map)
      mapRef.current = map
      map.invalidateSize()
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        const observer = new ResizeObserver(() => map.invalidateSize())
        observer.observe(containerRef.current)
        observerRef.current = observer
      }

      // Boundary for context (thin, faint).
      if (boundary?.geometry) {
        L.geoJSON(boundary.geometry as never, {
          style: { color: ADVISORY_COLOR, weight: 1, fillColor: ADVISORY_COLOR, fillOpacity: 0.03, opacity: 0.3 },
        }).addTo(map)
      }

      // Streets that fall inside the polygon (drawn faint).
      for (const street of streets) {
        for (const geometry of street.geometries ?? []) {
          for (const line of geoJsonToLines(geometry as never)) {
            L.polyline(line, { color: STREET_COLOR, weight: 1.1, opacity: 0.5, interactive: false }).addTo(map)
          }
        }
      }

      // The area itself: advisory-colored fill, no strong border.
      const area = L.geoJSON(geometry as never, {
        style: { color: ADVISORY_COLOR, weight: 0, fillColor: ADVISORY_COLOR, fillOpacity: 0.2, interactive: false },
      }).addTo(map)

      // Advisory icon marker at the centroid, so the type reads at a glance.
      const centroid = polygonCentroid(geometry)
      if (centroid) {
        L.marker(centroid, {
          icon: L.divIcon({
            className: "",
            html: advisoryMarkerHtml(tag),
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          interactive: false,
          keyboard: false,
        }).addTo(map)
      }
      try {
        const bounds = area.getBounds()
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [16, 16], maxZoom: 17 })
      } catch {
        /* ignore */
      }
    })()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      observerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [geometry, boundary, streets, tag])

  return (
    <div className={`pointer-events-none overflow-hidden rounded-xl border border-line-tint ${className}`}>
      <div ref={containerRef} className="h-40 w-full" />
      <style>{`
        .eboses-area-preview-map.leaflet-container {
          background: #eef0f3;
          font-family: inherit;
        }
        .eboses-area-preview-map .leaflet-control-attribution { display: none; }
      `}</style>
    </div>
  )
}
