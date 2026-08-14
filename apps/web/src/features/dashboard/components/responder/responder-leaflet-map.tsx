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

const INCIDENT_PIN_SIZE = { selected: 28, idle: 22 } as const

function incidentPinSize(active: boolean) {
  return active ? INCIDENT_PIN_SIZE.selected : INCIDENT_PIN_SIZE.idle
}

function incidentPinHtml(active = false) {
  const size = incidentPinSize(active)
  const glyph = Math.round(size * 0.48)
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:#f23b35;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 0 0 2px rgba(242,59,53,0.18),0 6px 16px rgba(15,23,42,.35);backdrop-filter:blur(2px)"><svg width="${glyph}" height="${glyph}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>`
}

/**
 * The responder's own GPS marker. It must read "you" and never compete with
 * the incident pins. A remembered fix drops the colour and the ping, so a
 * stale position can never be mistaken for a live one.
 */
function responderDotHtml(stale: boolean) {
  return stale
    ? `<div class="eboses-responder-dot eboses-responder-dot--stale"></div>`
    : `<div class="eboses-responder-dot"><span class="eboses-responder-halo"></span></div>`
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
      map.on("dragstart", () => setFollow(false))
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

    let origin: leaflet.LatLngTuple | null = null
    if (position) {
      origin = [position.latitude, position.longitude]
      bounds.push(origin)
      L.marker(origin, {
        icon: L.divIcon({
          html: responderDotHtml(positionStale),
          className: "",
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        zIndexOffset: 400,
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
        .responder-map-scope .eboses-responder-dot {
          position: relative;
          width: 12px;
          height: 12px;
        }
        .responder-map-scope .eboses-responder-dot::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: #3d9bff;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(15, 23, 42, 0.4);
        }
        .responder-map-scope .eboses-responder-dot--stale::after {
          background: #94a3b8;
          border-color: rgba(255, 255, 255, 0.75);
        }
        .responder-map-scope .eboses-responder-halo {
          position: absolute;
          inset: 0;
          border-radius: 999px;
          background: rgba(61, 155, 255, 0.45);
          animation: eboses-responder-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes eboses-responder-ping {
          0% { transform: scale(1); opacity: 0.7; }
          75%, 100% { transform: scale(2.6); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .responder-map-scope .eboses-responder-halo {
            animation: none;
            transform: scale(1.8);
            opacity: 0.25;
          }
        }
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
