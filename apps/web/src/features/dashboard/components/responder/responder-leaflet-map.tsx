import { useEffect, useRef } from "react"
import { LoaderCircleIcon, LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import { applyRouteMotion, routeLineStyle } from "@/features/dashboard/lib/route-line"
import type { Concern } from "@/features/dashboard/api"
import type { EmergencyAlert } from "@/features/dashboard/emergency-api"

import type leaflet from "leaflet"

const BARANGAY_CENTER: leaflet.LatLngTuple = [14.6507, 121.1133]

function validCoord(lat?: string | number | null, lng?: string | number | null) {
  if (lat == null || lng == null || lat === "" || lng === "") return null
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

function markerHtml(kind: "incident" | "responder", active = false) {
  const color = kind === "incident" ? "#f23b35" : "#4dc4ff"
  const glow = kind === "incident"
    ? "box-shadow:0 0 0 3px rgba(242,59,53,0.18),0 8px 22px rgba(15,23,42,.35)"
    : "box-shadow:0 0 0 3px rgba(77,196,255,0.18),0 8px 22px rgba(15,23,42,.35)"
  const size = active ? 40 : 32
  const glyph = kind === "incident" ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none"><circle cx="12" cy="12" r="7"/></svg>`
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;${glow};backdrop-filter:blur(2px)">${glyph}</div>`
}

/**
 * One segment of the joined map control stack.
 *
 * Replaces `MapControlButton` here specifically because that component carries
 * its own rounded border and glass background — three of them stacked gives
 * three floating objects, which is exactly the crowding this consolidation
 * removes. These are flat segments; the container owns the shape.
 */
function MapStackButton({
  label,
  onClick,
  loading = false,
  children,
}: {
  label: string
  onClick?: () => void
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label={label}
      title={label}
      className="flex size-11 items-center justify-center text-nav-text transition-colors hover:bg-white/5 hover:text-nav-text-active disabled:opacity-60"
    >
      {loading ? <LoaderCircleIcon className="size-5 animate-spin" /> : children}
    </button>
  )
}

function routeLine(geometry: unknown) {
  if (!geometry || typeof geometry !== "object" || !("coordinates" in geometry)) return []
  const coordinates = (geometry as { coordinates?: unknown }).coordinates
  if (!Array.isArray(coordinates)) return []
  return coordinates.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const lng = Number(point[0])
    const lat = Number(point[1])
    return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng] as leaflet.LatLngTuple] : []
  })
}

/**
 * Leaflet map core for the responder dispatch map — assigned incidents,
 * nearby community concerns, the responder's own live GPS marker, and a
 * dashed route line to the selected dispatch. Extracted from
 * `responder-map.tsx` (C1) so the page can stay focused on data/state.
 */
export function ResponderLeafletMap({
  alerts,
  concerns,
  selectedId,
  selectedConcernId,
  userPos,
  routeGeometry,
  onSelect,
  onSelectConcern,
  onLocateMe,
  locating = false,
  className,
  overlay,
}: {
  alerts: EmergencyAlert[]
  concerns: Concern[]
  selectedId: number | null
  selectedConcernId: number | null
  userPos: GeolocationPosition | null
  routeGeometry?: unknown
  onSelect: (id: number) => void
  onSelectConcern: (id: number) => void
  onLocateMe: () => void
  locating?: boolean
  /** Lets the caller round the map off when it renders inside a card. */
  className?: string
  /** Rendered above the map, right edge — the dispatch page's control rail. */
  overlay?: React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layerRef = useRef<leaflet.LayerGroup | null>(null)
  const routeRef = useRef<leaflet.Polyline | null>(null)
  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      LRef.current = L
      map = L.map(containerRef.current, {
        center: BARANGAY_CENTER,
        zoom: 15,
        zoomControl: false,
        // Every other map in the app suppresses the credit strip; this one was
        // the outlier, and it sat under the dispatch panel on phones.
        attributionControl: false,
      })
      mapRef.current = map
      // Matches the Alert Map: staff maps share one dark basemap so the
      // official side does not switch visual language between screens.
      containerRef.current?.classList.add("eboses-map-dark")

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
    }

    void init()
    return () => {
      cancelled = true
      if (map) map.remove()
      mapRef.current = null
      LRef.current = null
      layerRef.current = null
      routeRef.current = null
    }
  }, [])

  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return

    layer.clearLayers()
    if (routeRef.current) {
      routeRef.current.remove()
      routeRef.current = null
    }

    const bounds: leaflet.LatLngTuple[] = []
    const selected = alerts.find((alert) => alert.id === selectedId) ?? alerts[0] ?? null

    for (const alert of alerts) {
      const coord = validCoord(alert.latitude, alert.longitude)
      if (!coord) continue
      bounds.push(coord)
      // The marker's div grows when selected (40px vs 32px), and the icon
      // geometry must match that exact size — the old call hard-coded
      // 38px/19px, so the selected pin's 40px div overflowed its hit-box and
      // anchored 1px off-centre, which pushed the pin's tip onto the wrong
      // point on the map.
      const selectedPin = alert.id === selected?.id
      const pinSize = selectedPin ? 40 : 32
      const icon = L.divIcon({
        html: markerHtml("incident", selectedPin),
        className: "",
        iconSize: [pinSize, pinSize],
        iconAnchor: [pinSize / 2, pinSize / 2],
      })
      L.marker(coord, { icon })
        .addTo(layer)
        .on("click", () => onSelect(alert.id))
        .bindTooltip(`${alert.type} emergency`, { direction: "top" })
    }

    for (const concern of concerns) {
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      bounds.push(coord)
      L.circleMarker(coord, {
        radius: concern.id === selectedConcernId ? 11 : 8,
        color: "#07145f",
        weight: 3,
        fillColor: "#ff8133",
        fillOpacity: 1,
      })
        .addTo(layer)
        .on("click", () => onSelectConcern(concern.id))
        .bindTooltip(`${concern.title} · community concern`, { direction: "top" })
    }

    if (userPos) {
      const coord: leaflet.LatLngTuple = [
        userPos.coords.latitude,
        userPos.coords.longitude,
      ]
      bounds.push(coord)
      L.marker(coord, {
        icon: L.divIcon({
          // markerHtml("responder", true) renders a 40px dot, so the icon
          // geometry must match — it used to declare 34px/17px and the dot
          // overflowed its hit-box and anchored off-centre.
          html: markerHtml("responder", true),
          className: "",
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        }),
      })
        .addTo(layer)
        .bindTooltip("Your location", { direction: "top" })

      // Live whenever the responder is looking at an incident that is still
      // open. A responder's own map is the one place the crawl matters most:
      // it is the confirmation that they are the unit currently moving.
      const routeIsLive = selected ? isActiveEmergency(selected) : false
      const roadRoute = routeLine(routeGeometry)
      if (roadRoute.length > 1) {
        const line = L.polyline(roadRoute, routeLineStyle({ live: routeIsLive, weight: 4 })).addTo(map)
        applyRouteMotion(line, routeIsLive)
        routeRef.current = line
      } else {
        const selectedCoord = selected ? validCoord(selected.latitude, selected.longitude) : null
        if (selectedCoord) {
          const line = L.polyline(
            [coord, selectedCoord],
            routeLineStyle({ live: routeIsLive, approximate: true, weight: 3 }),
          ).addTo(map)
          applyRouteMotion(line, routeIsLive)
          routeRef.current = line
        }
      }
    }

    if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [42, 42], maxZoom: 17 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 16)
    } else {
      map.setView(BARANGAY_CENTER, 15)
    }
  }, [alerts, concerns, onSelect, onSelectConcern, routeGeometry, selectedConcernId, selectedId, userPos])

  return (
    <div className={cn("responder-map-scope relative isolate z-0 h-full min-h-0 overflow-hidden bg-ink", className)}>
      <div ref={containerRef} className="absolute inset-0" aria-label="Responder assignment map" />

      {/* One control object, not three.
          Locate, zoom-in and zoom-out used to float as a lone pill plus a
          two-up grid, which together with the queue rail put four separate
          clusters over a map that is often only 360px tall — the crowding the
          user reported. They are now a single joined stack with hairline
          dividers: same three actions, one thing to look at.

          Bottom-right below `sm`: on a phone held one-handed the top corners
          are the hardest place to reach, and these are the controls a
          responder uses while moving. */}
      <div className="absolute bottom-3 right-3 z-[600] flex flex-col items-end gap-2 sm:bottom-auto sm:right-4 sm:top-4">
        <div className="flex flex-col overflow-hidden rounded-2xl border border-rail-line bg-nav-glass backdrop-blur">
          <MapStackButton
            label="My location"
            onClick={onLocateMe}
            loading={locating}
          >
            <LocateFixedIcon className="size-5" />
          </MapStackButton>
          <span aria-hidden className="h-px bg-rail-line" />
          <MapStackButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <PlusIcon className="size-5" />
          </MapStackButton>
          <span aria-hidden className="h-px bg-rail-line" />
          <MapStackButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <MinusIcon className="size-5" />
          </MapStackButton>
        </div>
      </div>

      {overlay ? (
        <div className="absolute right-3 top-3 z-[600] sm:right-4 sm:top-auto sm:bottom-4">{overlay}</div>
      ) : null}
    </div>
  )
}
