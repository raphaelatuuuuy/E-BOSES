import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowUpRightIcon } from "lucide-react"

import { Panel, PanelHeader } from "@/features/dashboard/components/staff/panel"
import { getOfficialLiveMap, type LiveMapSnapshot } from "@/features/dashboard/api"

import type leaflet from "leaflet"

const CONCERN_COLOR = "var(--color-brand-orange)"
const EMERGENCY_COLOR = "var(--color-severity-critical)"

function validCoord(lat?: string | null, lng?: string | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

/**
 * A teardrop pin with a ring that pulses outward.
 *
 * Built as a Leaflet divIcon rather than a circleMarker so the pulse can be a
 * CSS animation: an SVG circle cannot ripple without a JS ticker, and the
 * global reduced-motion reset in globals.css already switches this off for
 * anyone who asks for it. Only emergencies pulse. If every pin moved, the
 * movement would stop meaning "someone needs help right now".
 */
function pinIcon(L: typeof leaflet, color: string, live: boolean) {
  return L.divIcon({
    className: "eboses-pin",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `
      <span class="eboses-pin__wrap">
        ${live ? `<span class="eboses-pin__pulse" style="background:${color}"></span>` : ""}
        <span class="eboses-pin__dot" style="background:${color}"></span>
      </span>
    `,
  })
}

/** Count with a colour key, printed under the map. */
function MapStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[14px] font-semibold text-brand-navy tabular-nums">{value}</span>
      <span className="text-[11.5px] font-semibold text-subtle-foreground">{label}</span>
    </span>
  )
}

/**
 * Live map preview for the overview page.
 *
 * Non-interactive on purpose: panning and zooming belong to the full workspace
 * at /dashboard/alerts-map, and a half-working map is worse than a still one.
 * The whole card is the link there.
 */
export function MiniAlertsMap() {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<LiveMapSnapshot | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getOfficialLiveMap()
      .then((next) => {
        if (!cancelled) setSnapshot(next)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!snapshot || !containerRef.current) return
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current || !snapshot) return
      map = L.map(containerRef.current, {
        center: [snapshot.map.center.latitude, snapshot.map.center.longitude],
        zoom: snapshot.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
      })

      // Voyager carries street names at barangay zoom. The dark tile did not,
      // and made this the only inverted surface on an otherwise light page.
      // Matches the Alert Map: staff maps share one dark basemap so the
      // official side does not switch visual language between screens.
      containerRef.current?.classList.add("eboses-map-dark")

      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)

      // Frame the barangay itself rather than a generic city-level view, and
      // outline it so a pin just outside Marikina Heights is obvious.
      if (snapshot.map.boundary.geometry) {
        const boundary = L.geoJSON(
          snapshot.map.boundary.geometry as Parameters<typeof L.geoJSON>[0],
          {
            style: {
              color: "var(--color-brand-navy)",
              weight: 1.5,
              opacity: 0.55,
              fillColor: "var(--color-brand-navy)",
              fillOpacity: 0.04,
            },
            interactive: false,
          },
        ).addTo(map)
        map.fitBounds(boundary.getBounds(), { padding: [14, 14] })
      }

      for (const concern of snapshot.concerns) {
        const coord = validCoord(concern.latitude, concern.longitude)
        if (!coord) continue
        L.marker(coord, { icon: pinIcon(L, CONCERN_COLOR, false), interactive: false }).addTo(map)
      }
      for (const emergency of snapshot.emergencies) {
        const coord = validCoord(emergency.latitude, emergency.longitude)
        if (!coord) continue
        L.marker(coord, { icon: pinIcon(L, EMERGENCY_COLOR, true), interactive: false }).addTo(map)
      }
      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      map?.remove()
    }
  }, [snapshot])

  return (
    <Panel className="flex flex-col">
      <PanelHeader title="Live Map">
        <button
          type="button"
          onClick={() => navigate("/dashboard/alerts-map")}
          className="group flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-[12px] font-bold text-brand-orange-strong transition-colors hover:bg-brand-orange-soft"
        >
          Open full map
          <ArrowUpRightIcon className="size-3.5 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
        </button>
      </PanelHeader>

      {failed ? (
        <div className="flex h-[420px] items-center justify-center rounded-panel bg-card-raised text-xs font-semibold text-subtle-foreground">
          The map could not load. Open the full map to try again.
        </div>
      ) : (
        // Not wrapped in a button. A Leaflet container inside a <button>
        // turns every event the map emits into a navigation, which fired the
        // moment the pointer happened to be over this card on load. The header
        // link is the only way out of here.
        <div className="h-[420px] w-full overflow-hidden rounded-panel border border-card-line bg-card-raised">
          <div ref={containerRef} className="pointer-events-none size-full" />
        </div>
      )}

      {snapshot ? (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <MapStat value={snapshot.summary.concerns} label="open concerns" color={CONCERN_COLOR} />
          <MapStat
            value={snapshot.summary.emergencies}
            label="emergencies"
            color={EMERGENCY_COLOR}
          />
        </div>
      ) : null}
    </Panel>
  )
}
