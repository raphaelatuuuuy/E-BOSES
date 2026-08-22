import { useEffect, useRef, useState } from "react"
import { LocateFixedIcon, MinusIcon, NavigationIcon, PlusIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import {
  drawRoute,
  routeRenderGeometry,
  type RouteLayers,
} from "@/features/dashboard/lib/route-line"
import {
  lastFoundLabel,
  type KnownPosition,
} from "@/features/dashboard/lib/last-known-position"
import {
  MapControlStack,
  MapStackButton,
  MapStackDivider,
} from "@/features/dashboard/components/map-control-stack"
import {
  concernMarkerHtml,
  concernMarkerSize,
} from "@/features/dashboard/components/map/concern-marker"
import {
  dotPinHtml,
  glyphPinHtml,
  glyphPinSize,
  GLYPHS,
  MAP_COLORS,
} from "@/features/dashboard/components/map/markers"
import { drawCoverage } from "@/features/dashboard/components/map/coverage-layer"
import { useCoverageContext } from "@/features/dashboard/lib/use-coverage"
import type { Concern } from "@/features/dashboard/api"
import type { EmergencyAlert, EmergencyRoute } from "@/features/dashboard/emergency-api"

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

const INCIDENT_PIN = 26

function incidentPinSize(active: boolean) {
  return glyphPinSize(INCIDENT_PIN, active)
}

function incidentPinHtml(active = false) {
  return glyphPinHtml({
    paths: GLYPHS.emergency,
    color: MAP_COLORS.emergency,
    size: INCIDENT_PIN,
    selected: active,
    live: true,
  })
}

/**
 * The responder's own GPS marker. It must read "you" and never compete with
 * the incident pins. A remembered fix drops the colour and the ping, so a
 * stale position can never be mistaken for a live one.
 */
function responderDotHtml(stale: boolean) {
  return dotPinHtml({
    color: stale ? MAP_COLORS.responderOffDuty : MAP_COLORS.you,
    size: 13,
    live: !stale,
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
  position,
  positionStale = false,
  route,
  onSelect,
  onSelectConcern,
  onLocateMe,
  locating = false,
  className,
}: {
  alerts: EmergencyAlert[]
  concerns: Concern[]
  selectedId: number | null
  selectedConcernId: number | null
  /** Live or remembered — the map draws both, and labels the difference. */
  position: KnownPosition | null
  positionStale?: boolean
  route?: EmergencyRoute | null
  onSelect: (id: number) => void
  onSelectConcern: (id: number) => void
  onLocateMe: () => void
  locating?: boolean
  /** Lets the caller round the map off when it renders inside a card. */
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layerRef = useRef<leaflet.LayerGroup | null>(null)
  const routeRef = useRef<RouteLayers | null>(null)
  // The view must recentre when what is being shown changes (alert, concern,
  // route, selection) — and must NOT recentre on every GPS tick, which is what
  // kept yanking the map back to the responder after a manual zoom/pan.
  const lastFitRef = useRef<string | null>(null)
  // Off by default: a map that recentres on its own fights every pan, which is
  // why the auto-fit was keyed away from position ticks in the first place.
  // Dragging turns it back off, so it never wins an argument with a thumb.
  const [follow, setFollow] = useState(false)
  const coverage = useCoverageContext()
  const coverageRef = useRef<leaflet.LayerGroup | null>(null)
  const resizeRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null
    let styleEl: HTMLStyleElement | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      LRef.current = L

      // Same fix as the AreaPicker/pin maps: the tile-size override has to
      // exist in <head> before Leaflet lays out its tile pane, or the 256px
      // tiles collapse under Tailwind Preflight's `img { max-width: 100% }`
      // and the map paints blank.
      styleEl = document.createElement("style")
      styleEl.textContent = `
        .responder-map-scope .leaflet-container {
          width: 100%;
          height: 100%;
          font-family: inherit;
        }
        .responder-map-scope .leaflet-tile-pane { isolation: isolate; }
        .responder-map-scope img.leaflet-tile,
        .responder-map-scope .leaflet-tile {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
      `
      document.head.appendChild(styleEl)

      map = L.map(containerRef.current, {
        center: BARANGAY_CENTER,
        zoom: 15,
        zoomControl: false,
        // Every other map in the app suppresses the credit strip; this one was
        // the outlier, and it sat under the dispatch panel on phones.
        attributionControl: false,
      })
      mapRef.current = map

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
        keepBuffer: 6,
        updateWhenIdle: true,
      }).addTo(map)

      // Leaflet measures its container once, at construction. This map mounts
      // inside a panel that is still resolving its height, so without a
      // re-measure it was built against a 0px box and painted no tiles at all.
      const observer = new ResizeObserver(() => {
        const box = containerRef.current?.getBoundingClientRect()
        if (!box?.width || !box.height) return
        mapRef.current?.invalidateSize({ animate: false })
      })
      if (containerRef.current) observer.observe(containerRef.current)
      resizeRef.current = observer
      requestAnimationFrame(() => map?.invalidateSize({ animate: false }))
      // Below the incident layer on purpose: coverage is context, not a record.
      coverageRef.current = L.layerGroup().addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      map.on("dragstart", () => setFollow(false))
    }

    void init()
    return () => {
      cancelled = true
      resizeRef.current?.disconnect()
      resizeRef.current = null
      styleEl?.remove()
      if (map) map.remove()
      mapRef.current = null
      LRef.current = null
      layerRef.current = null
      coverageRef.current = null
      routeRef.current = null
    }
  }, [])

  // The barangay edge and the acceptance zone, so a crew can see the limit
  // they are dispatched inside without opening the official's screen.
  useEffect(() => {
    const L = LRef.current
    const group = coverageRef.current
    if (!L || !group || !coverage) return
    group.clearLayers()
    drawCoverage(L, group, {
      boundary: coverage.boundary?.geometry ?? null,
      policy: coverage.dispatch_policy,
    })
  }, [coverage])

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
      // The icon geometry must match the div's exact size, or the pin
      // overflows its hit-box and anchors off-centre — which puts its tip on
      // the wrong point on the map. Both read from incidentPinSize.
      const selectedPin = alert.id === selected?.id
      const pinSize = incidentPinSize(selectedPin)
      const icon = L.divIcon({
        html: incidentPinHtml(selectedPin),
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
      const picked = concern.id === selectedConcernId
      const box = concernMarkerSize(picked)
      L.marker(coord, {
        icon: L.divIcon({
          className: "",
          html: concernMarkerHtml({
            category: concern.category,
            iconKey: concern.category_ref?.icon_key,
            status: concern.status,
            selected: picked,
          }),
          iconSize: [box, box],
          iconAnchor: [box / 2, box / 2],
        }),
        zIndexOffset: picked ? 600 : 200,
      })
        .addTo(layer)
        .on("click", () => onSelectConcern(concern.id))
        .bindTooltip(`${concern.title} · community concern`, { direction: "top" })
    }

    let origin: leaflet.LatLngTuple | null = null
    if (position) {
      origin = [position.latitude, position.longitude]
      bounds.push(origin)
      L.marker(origin, {
        icon: L.divIcon({
          html: responderDotHtml(positionStale),
          className: "",
          iconSize: [13, 13],
          iconAnchor: [6.5, 6.5],
        }),
        zIndexOffset: 1200,
      })
        .addTo(layer)
        .bindTooltip(
          positionStale
            ? `Your location<br><span class="eboses-tip-sub">${lastFoundLabel(position.at)}</span>`
            : "Your location",
          { direction: "top", permanent: positionStale, className: "eboses-responder-tip" },
        )
    }

    // Outside the position block on purpose: losing GPS must not take the
    // planned leg off the screen with it. The route starts at the last ping
    // the server received, so the dash to the dot closes whatever gap is left.
    const routeIsLive = selected ? isActiveEmergency(selected) : false
    const destination = selected ? validCoord(selected.latitude, selected.longitude) : null
    const { road, approach, connectors } = routeRenderGeometry(route, { origin, destination })
    routeRef.current = drawRoute(L, map, {
      road,
      approach,
      connectors,
      live: routeIsLive,
      weight: 6,
    })

    // A GPS fix arrives every few seconds, so the fit must be keyed on what
    // the map is *showing*, not how often the marker moved. Without this the
    // view snapped back to the responder on every tick, which is what made
    // zooming out "keep going focus" — the user zooms, a position update
    // lands, and the map re-fits. userPos deliberately stays out of the key.
    const fitKey = JSON.stringify([
      alerts.map((alert) => alert.id),
      selectedId,
      selectedConcernId,
      concerns.map((concern) => concern.id),
      route?.geometry ? "route" : null,
      position ? "position" : null,
    ])
    // Follow owns the viewport while it is on; auto-fit stands down.
    if (follow) {
      lastFitRef.current = fitKey
    } else if (lastFitRef.current !== fitKey) {
      if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds), { padding: [42, 42], maxZoom: 17 })
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 16)
      } else {
        map.setView(BARANGAY_CENTER, 15)
      }
      lastFitRef.current = fitKey
    }
  }, [
    alerts,
    concerns,
    onSelect,
    onSelectConcern,
    route,
    selectedConcernId,
    selectedId,
    position,
    positionStale,
    follow,
  ])

  useEffect(() => {
    const map = mapRef.current
    if (!follow || !position || !map) return
    map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 16), {
      animate: true,
    })
  }, [follow, position])

  return (
    <div className={cn("responder-map-scope relative isolate z-0 h-full min-h-0 overflow-hidden bg-ink", className)}>
      <div ref={containerRef} className="absolute inset-0" aria-label="Responder assignment map" />

      {/* Scoped to this map's classes only, so the marker stays self-contained
          and can never colour anything on other Leaflet maps. */}
      <style>{`
        .responder-map-scope .eboses-responder-tip {
          padding: 4px 8px;
          border-radius: 8px;
          border: none;
          background: rgba(15, 23, 42, 0.92);
          color: #e2e8f0;
          font-size: 11px;
          font-weight: 600;
          line-height: 1.35;
          text-align: center;
          box-shadow: 0 4px 14px rgba(2, 6, 23, 0.45);
        }
        .responder-map-scope .eboses-responder-tip::before {
          border-top-color: rgba(15, 23, 42, 0.92);
        }
        .responder-map-scope .eboses-tip-sub {
          color: #94a3b8;
          font-weight: 500;
        }
      `}</style>

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
        <MapControlStack>
          <MapStackButton label="My location" onClick={onLocateMe} loading={locating}>
            <LocateFixedIcon className="size-5" />
          </MapStackButton>
          <MapStackDivider />
          <MapStackButton
            label={follow ? "Stop following your location" : "Follow your location"}
            active={follow}
            onClick={() => setFollow((current) => !current)}
          >
            <NavigationIcon className="size-5" />
          </MapStackButton>
          <MapStackDivider />
          <MapStackButton label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
            <PlusIcon className="size-5" />
          </MapStackButton>
          <MapStackDivider />
          <MapStackButton label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
            <MinusIcon className="size-5" />
          </MapStackButton>
        </MapControlStack>
      </div>
    </div>
  )
}
