import { useCallback, useEffect, useRef, useState } from "react"

import type {
  Announcement,
  Concern,
  GeoJsonPolygon,
  ResidentAlertsMapSnapshot,
  ResidentMapEmergency,
} from "@/features/dashboard/api"
import {
  isLocalGps,
  MAP_BOUNDS,
  validCoord,
} from "@/features/dashboard/lib/resident-map-utils"
import {
  advisoryMeta,
  advisoryMarkerHtml,
  advisoryMarkerSize,
} from "@/features/dashboard/components/community-content/advisory-tags"
import {
  concernMarkerHtml,
  concernMarkerSize,
} from "@/features/dashboard/components/map/concern-marker"
import {
  glyphPinHtml,
  glyphPinSize,
  GLYPHS,
  MAP_COLORS,
} from "@/features/dashboard/components/map/markers"
import {
  photoTooltipHtml,
  photoTooltipOptions,
} from "@/features/dashboard/components/map/photo-tooltip"
import { geoJsonToRing, polygonCentroid } from "@/features/dashboard/components/community-content/area-lib"
import { geoJsonToLines, isActiveEmergency } from "@/features/dashboard/components/alerts-map/lib"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  StreetViewModal,
  startStreetViewPick,
  type StreetViewCoord,
} from "@/features/dashboard/components/map/street-view"

import type leaflet from "leaflet"

export type MapApi = {
  flyTo: (lat: number, lng: number, zoom?: number) => void
  panTo: (lat: number, lng: number) => void
  invalidateSize: () => void
  /** Fit the whole barangay boundary (Home). */
  fitBoundary: (paddingBottom?: number) => void
  zoomIn: () => void
  zoomOut: () => void
  toggleStreetViewPick: () => void
}

const EMERGENCY_PIN = 28

/** Ongoing SOS — the same circle-and-glyph an official and a responder see. */
function emergencyPinHtml(selected: boolean, resolved: boolean) {
  return glyphPinHtml({
    paths: GLYPHS.emergency,
    color: resolved ? MAP_COLORS.resolved : MAP_COLORS.emergency,
    size: EMERGENCY_PIN,
    selected,
    live: false,
    tint: resolved,
  })
}

const USER_PIN = 24

function userPinHtml() {
  return glyphPinHtml({
    paths: GLYPHS.userResident,
    color: MAP_COLORS.you,
    size: USER_PIN,
  })
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
  onStreetViewPickChange,
  policy,
}: {
  center: { latitude: number; longitude: number; zoom: number }
  boundary?: ResidentAlertsMapSnapshot["map"]["boundary"] | null
  /** Acceptance zone from the barangay's dispatch policy, drawn read-only. */
  policy?: ResidentAlertsMapSnapshot["map"]["dispatch_policy"]
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
  onStreetViewPickChange?: (active: boolean) => void
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
  const coverageGroupRef = useRef<leaflet.LayerGroup | null>(null)
  const hoverIdRef = useRef<number | null>(null)
  const focusIdRef = useRef<number | null>(null)
  const onMapInteractRef = useRef(onMapInteract)
  useEffect(() => {
    onMapInteractRef.current = onMapInteract
  }, [onMapInteract])
  const [mapReady, setMapReady] = useState(false)
  const [svPick, setSvPick] = useState(false)
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)
  const onStreetViewPickChangeRef = useRef(onStreetViewPickChange)
  useEffect(() => {
    onStreetViewPickChangeRef.current = onStreetViewPickChange
  }, [onStreetViewPickChange])

  function toggleStreetViewPick() {
    setSvPick((value) => {
      const next = !value
      onStreetViewPickChangeRef.current?.(next)
      return next
    })
  }

  useEffect(() => {
    if (!svPick || !mapReady) return
    const map = mapRef.current
    if (!map) return
    const cleanup = startStreetViewPick(map, {
      onPick: (coord) => {
        setSvPick(false)
        onStreetViewPickChangeRef.current?.(false)
        setSvCoord(coord)
      },
      onCancel: () => {
        setSvPick(false)
        onStreetViewPickChangeRef.current?.(false)
      },
    })
    return cleanup
  }, [svPick, mapReady])

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
            stroke: false,
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
      addBaseTiles(L, map, "light", {
        attribution: "&copy; OpenStreetMap &copy; CARTO",
        maxZoom: 19,
        keepBuffer: 6,
        className: "eboses-map-tiles",
      })

      // Hover-only barangay fill: sits beneath every advisory road/marker.
      highlightGroupRef.current = L.layerGroup().addTo(map)
      coverageGroupRef.current = L.layerGroup().addTo(map)
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
          toggleStreetViewPick: () => toggleStreetViewPick(),
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
      coverageGroupRef.current = null
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
    // Kept off the map (not `.addTo(map)`) so the dashed barangay outline stays
    // hidden — the layer only exists here to feed `fitBoundary()` its bounds.
    boundaryLayerRef.current = L.geoJSON(boundary.geometry as Parameters<typeof L.geoJSON>[0], {
      style: {
        color: "#64748b",
        weight: 2,
        fillColor: "#94a3b8",
        fillOpacity: 0.08,
        opacity: 0.75,
        dashArray: "4 4",
      },
    })
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

  // The acceptance-zone radius stays hidden on the resident map — it's an
  // internal dispatch limit, not something a resident needs drawn over the
  // barangay.
  useEffect(() => {
    if (!mapReady) return
    const group = coverageGroupRef.current
    if (!group) return
    group.clearLayers()
  }, [mapReady, policy])

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
          iconSize: [USER_PIN, USER_PIN],
          iconAnchor: [USER_PIN / 2, USER_PIN / 2],
        }),
        zIndexOffset: 1200,
        keyboard: false,
      })
      userMarker.bindTooltip("You", { direction: "top", offset: [0, -USER_PIN / 2] })
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
            iconKey: post.category_ref?.icon_key,
            imageUrl: post.category_ref?.icon_image_url,
            customLabel: post.category_ref?.custom_icon_label,
            status: post.status,
            selected,
          }),
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        zIndexOffset: selected ? 900 : 100,
      })
      // Photo tooltip on hover
      const photoUrl = post.media?.[0]?.preview_url
      if (photoUrl) {
        marker.bindTooltip(() => photoTooltipHtml(photoUrl), photoTooltipOptions(pinSize))
      }
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelect(post.id)
      })
      marker.addTo(group)
    }

    // Barangay advisories — the affected-area outline plus a tag icon at its
    // centroid. Officials pick the tag (water, electric, road, flooding,
    // general), so each advisory reads as its icon + color on the map.
    /** One advisory marker, wherever the advisory's anchor turns out to be. */
    const addAdvisoryMarker = (announcement: Announcement, at: leaflet.LatLngTuple) => {
      const id = announcement.id
      const selected = selectedAnnouncementId === id
      const pinSize = advisoryMarkerSize(26, selected)
      const marker = L.marker(at, {
        icon: L.divIcon({
          className: "",
          html: advisoryMarkerHtml(announcement.tag, 26, "light", selected),
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        zIndexOffset: selected ? 700 : 600,
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
            stroke: false,
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

    // Ongoing emergencies — red dots + brief label; settled ones (resolved,
    // closed, cancelled, false alarm, invalid) go neutral, same rule the
    // official map uses, so the two never disagree on what "done" means.
    for (const em of emergencies) {
      const pos = validCoord(em.latitude, em.longitude)
      if (!pos) continue
      const selected = selectedEmergencyId === em.id
      const settled = !isActiveEmergency(em)
      const box = glyphPinSize(EMERGENCY_PIN, selected)
      const marker = L.marker(pos, {
        icon: L.divIcon({
          className: "",
          html: emergencyPinHtml(selected, settled),
          iconSize: [box, box],
          iconAnchor: [box / 2, box / 2],
        }),
        zIndexOffset: selected ? 1100 : 800,
      })
      // Photo tooltip on hover
      if (em.preview_url) {
        marker.bindTooltip(() => photoTooltipHtml(em.preview_url!), photoTooltipOptions(box))
      }
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectEmergency?.(em.id)
      })
      marker.addTo(group)
    }
    // Re-apply after a rebuild: a selection survives while a hover does not.
    applyAdvisoryFocus(focusIdRef.current)
  }, [mapReady, posts, emergencies, announcements, selectedId, selectedEmergencyId, selectedAnnouncementId, userPos, userPosAt, onSelect, onSelectEmergency, onSelectAnnouncement, boundary?.geometry, center.latitude, center.longitude, applyAdvisoryFocus])

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
        .eboses-alerts-map .leaflet-marker-pane {
          z-index: auto;
        }
        .eboses-alerts-map img.leaflet-tile,
        .eboses-alerts-map .leaflet-tile,
        .eboses-alerts-map .eboses-map-tiles {
          max-width: none !important;
          max-height: none !important;
          width: 256px !important;
          height: 256px !important;
          mix-blend-mode: normal !important;
        }
        .eboses-alerts-map .leaflet-tile-pane {
          isolation: isolate;
        }
        .eboses-alerts-map .leaflet-container img {
          max-width: none !important;
        }
        /* Current-location pin only loses its ring; every record pin (concern,
           emergency, advisory) keeps its white border. */
        .eboses-alerts-map .eboses-pin__core {
          border: none;
        }
        .eboses-alerts-map .eboses-pin__disc,
        .eboses-alerts-map .eboses-pin__core {
          box-shadow: none;
        }
        /* Soft tint background + solid glyph colour instead of a bold filled
           disc, plus true centering for the icon inside it. */
        .eboses-alerts-map .eboses-pin__disc {
          background: color-mix(in srgb, var(--pin) 16%, white);
          color: var(--pin);
          transition: background-color 160ms ease, color 160ms ease;
        }
        .eboses-alerts-map .eboses-pin__disc svg {
          display: block;
        }
        /* Community reports: neutral grey until hovered or opened, then they
           pick up their category colour and grow slightly. */
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral {
          transition: transform 160ms ease;
          transform-origin: 50% 50%;
        }
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral .eboses-pin__disc {
          background: #e5e7eb;
          color: #6b7280;
        }
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral:hover,
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral:focus-visible {
          transform: scale(1.12);
        }
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral:hover .eboses-pin__disc,
        .eboses-alerts-map .eboses-pin--glyph.is-idle-neutral:focus-visible .eboses-pin__disc {
          background: color-mix(in srgb, var(--pin) 16%, white);
          color: var(--pin);
        }
        /* Advisory pins: same "grow slightly" affordance as reports, without
           the neutral/colour swap (advisories already show their tag colour). */
        .eboses-alerts-map .eboses-pin--glyph.is-hover-grow {
          transition: transform 160ms ease;
          transform-origin: 50% 50%;
        }
        .eboses-alerts-map .eboses-pin--glyph.is-hover-grow:hover,
        .eboses-alerts-map .eboses-pin--glyph.is-hover-grow:focus-visible {
          transform: scale(1.12);
        }
        /* Current-location dot: much quieter halo/blink than the shared
           default, since it's a constant fixture rather than a live alert. */
        .eboses-alerts-map .eboses-pin--dot .eboses-pin__halo {
          opacity: 0.22;
          animation: eboses-pin-halo-minimal 2.4s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
        @keyframes eboses-pin-halo-minimal {
          0% {
            transform: scale(1);
            opacity: 0.22;
          }
          70%,
          100% {
            transform: scale(1.5);
            opacity: 0;
          }
        }
        .eboses-alerts-map .eboses-pin--dot.is-live .eboses-pin__core {
          animation: eboses-pin-blink-minimal 2.4s ease-in-out infinite;
        }
        @keyframes eboses-pin-blink-minimal {
          0%,
          100% {
            box-shadow: 0 0 0 0 var(--pin);
          }
          50% {
            box-shadow: 0 0 3px 1px var(--pin);
          }
        }
      `}</style>
      <div
        ref={containerRef}
        className="eboses-alerts-map absolute inset-0 z-0 h-full w-full bg-tint"
        style={{ minHeight: "100%" }}
      />
      {svPick ? (
        <div className="pointer-events-none absolute right-3 top-3 z-[650] w-max max-w-[min(15rem,calc(100vw-1.5rem))] rounded-lg bg-nav-bg/90 px-2.5 py-1.5 text-[11.5px] font-semibold text-white/85 shadow-md backdrop-blur">
          Click the map to start Street View · Esc cancels
        </div>
      ) : null}
      {svCoord ? <StreetViewModal coord={svCoord} onClose={() => setSvCoord(null)} /> : null}
    </>
  )
}