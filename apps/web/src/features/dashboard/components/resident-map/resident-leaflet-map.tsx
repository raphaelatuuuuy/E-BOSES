import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type {
  Announcement,
  Concern,
  GeoJsonPolygon,
  ResidentAlertsMapSnapshot,
  ResidentMapEmergency,
} from "@/features/dashboard/api"
import {
  isLocalGps,
  validCoord,
} from "@/features/dashboard/lib/resident-map-utils"
import {
  ANNOUNCEMENT_ACCENT,
  advisoryGlyphHtml,
  advisoryLabel,
  advisoryMarkerHtml,
  advisoryMarkerSize,
} from "@/features/dashboard/components/community-content/advisory-tags"
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
import {
  bindHoverCard,
  closeHoverCardsOnLeave,
  makeHoverCard,
  openHoverCard,
} from "@/features/dashboard/components/map/photo-tooltip"
import {
  geoJsonToRing,
  polygonCentroid,
} from "@/features/dashboard/components/community-content/area-lib"
import {
  advisoryDoneColor,
  geoJsonToLines,
  isActiveEmergency,
  joinLineRuns,
} from "@/features/dashboard/components/alerts-map/lib"
import {
  announcementSummary,
  announcementTitle,
} from "@/features/dashboard/lib/announcement-summary"
import { concernTitleText } from "@/features/dashboard/components/feed-post-text"
import { statusGroupOf } from "@/features/dashboard/lib/status-vocabulary"
import { streetSegment } from "@/features/dashboard/lib/location-text"
import { addBaseTiles } from "@/features/dashboard/components/map/tile-layers"
import {
  StreetViewModal,
  startStreetViewPick,
  type StreetViewCoord,
  type StreetViewMapPoint,
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
  openStreetViewAtPin: () => void
}

const EMERGENCY_PIN = 28

/** Ongoing SOS — the same circle-and-glyph an official and a responder see. */
function emergencyPinHtml(selected: boolean, resolved: boolean) {
  return glyphPinHtml({
    paths: resolved ? GLYPHS.resolved : GLYPHS.emergency,
    color: resolved ? MAP_COLORS.resolved : MAP_COLORS.emergency,
    size: EMERGENCY_PIN,
    selected,
    live: false,
    tint: resolved,
    hoverGrow: true,
  })
}

const USER_PIN = 32

function userPinHtml(isResponder = false) {
  return glyphPinHtml({
    paths: isResponder ? GLYPHS.userResponder : GLYPHS.userResident,
    color: MAP_COLORS.you,
    size: 32,
    label: "You",
    className: "is-you",
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
  viewerIsResponder = false,
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
  viewerIsResponder?: boolean
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
    Map<
      number,
      {
        roads: Array<{ flow: leaflet.Polyline }>
        wide: string | null
      }
    >
  >(new Map())
  const advisoryFallbackAnchorsRef = useRef(
    new Map<number, leaflet.LatLngTuple>()
  )
  const highlightGroupRef = useRef<leaflet.LayerGroup | null>(null)
  const coverageGroupRef = useRef<leaflet.LayerGroup | null>(null)
  const focusIdRef = useRef<number | null>(null)
  const onMapInteractRef = useRef(onMapInteract)
  useEffect(() => {
    onMapInteractRef.current = onMapInteract
  }, [onMapInteract])
  const [mapReady, setMapReady] = useState(false)
  const [svPick, setSvPick] = useState(false)
  const [svCoord, setSvCoord] = useState<StreetViewCoord | null>(null)
  const streetViewWasOpenRef = useRef(false)

  useEffect(() => {
    if (svCoord) {
      streetViewWasOpenRef.current = true
      return
    }
    if (!streetViewWasOpenRef.current) return
    streetViewWasOpenRef.current = false

    let firstFrame = 0
    let secondFrame = 0
    const repaintMap = () => {
      const map = mapRef.current
      if (!map) return
      map.invalidateSize({ animate: false })
      map.setZoom(map.getZoom(), { animate: false })
    }
    firstFrame = requestAnimationFrame(() => {
      repaintMap()
      secondFrame = requestAnimationFrame(repaintMap)
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
    }
  }, [svCoord])

  const onStreetViewPickChangeRef = useRef(onStreetViewPickChange)
  useEffect(() => {
    onStreetViewPickChangeRef.current = onStreetViewPickChange
  }, [onStreetViewPickChange])
  const svPinSourceRef = useRef({
    posts,
    emergencies,
    announcements,
    selectedId,
    selectedEmergencyId,
    selectedAnnouncementId,
  })
  useEffect(() => {
    svPinSourceRef.current = {
      posts,
      emergencies,
      announcements,
      selectedId,
      selectedEmergencyId,
      selectedAnnouncementId,
    }
  }, [
    posts,
    emergencies,
    announcements,
    selectedId,
    selectedEmergencyId,
    selectedAnnouncementId,
  ])

  const svPoints = useMemo<StreetViewMapPoint[]>(() => {
    const points: StreetViewMapPoint[] = []
    if (userPos && isLocalGps(userPos, boundary?.geometry)) {
      points.push({
        id: "you",
        lat: userPos.lat,
        lng: userPos.lng,
        html: userPinHtml(viewerIsResponder),
        size: USER_PIN,
        title: "You are here",
      })
    }
    for (const post of posts) {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) continue
      const severity = post.severity ?? null
      points.push({
        id: `c${post.id}`,
        lat: pos[0],
        lng: pos[1],
        html: concernMarkerHtml({
          category: post.category,
          iconKey: post.category_ref?.icon_key,
          imageUrl: post.category_ref?.icon_image_url,
          customLabel: post.category_ref?.custom_icon_label,
          status: post.status,
          severity,
          selected: false,
        }),
        size: concernMarkerSize(false),
        title: concernTitleText(post),
        excerpt: post.summary || post.description,
        image: post.media?.[0]?.preview_url ?? null,
      })
    }
    for (const announcement of announcements) {
      let pos = validCoord(announcement.latitude, announcement.longitude)
      if (!pos && announcement.area_geometry)
        pos = polygonCentroid(announcement.area_geometry)
      if (!pos) continue
      points.push({
        id: `a${announcement.id}`,
        lat: pos[0],
        lng: pos[1],
        html: advisoryMarkerHtml(announcement.tag, 26, "light", false),
        size: advisoryMarkerSize(26, false),
        title: announcementTitle(announcement),
        meta: announcement.place_label || "Barangay advisory",
        excerpt: announcement.body,
        image: announcement.image_url,
      })
    }
    for (const emergency of emergencies) {
      const pos = validCoord(emergency.latitude, emergency.longitude)
      if (!pos) continue
      const settled = !isActiveEmergency(emergency)
      points.push({
        id: `e${emergency.id}`,
        lat: pos[0],
        lng: pos[1],
        html: emergencyPinHtml(false, settled),
        size: EMERGENCY_PIN,
        title: emergency.type_label,
        meta: emergency.address,
        excerpt: emergency.note,
        image: emergency.preview_url,
      })
    }
    return points
  }, [
    posts,
    emergencies,
    announcements,
    userPos,
    boundary?.geometry,
    viewerIsResponder,
  ])

  function toggleStreetViewPick() {
    setSvPick((value) => {
      const next = !value
      onStreetViewPickChangeRef.current?.(next)
      return next
    })
  }

  function openStreetViewAtPin() {
    const map = mapRef.current
    if (!map) return
    const {
      posts: currentPosts,
      emergencies: currentEmergencies,
      announcements: currentAnnouncements,
      selectedId: currentSelectedId,
      selectedEmergencyId: currentSelectedEmergencyId,
      selectedAnnouncementId: currentSelectedAnnouncementId,
    } = svPinSourceRef.current
    const center = map.getCenter()
    let lat = center.lat
    let lng = center.lng
    const selectedPost =
      currentSelectedId != null
        ? currentPosts.find((p) => p.id === currentSelectedId)
        : null
    const selectedPostCoord = selectedPost
      ? validCoord(selectedPost.latitude, selectedPost.longitude)
      : null
    const selectedEmergency =
      currentSelectedEmergencyId != null
        ? currentEmergencies?.find((e) => e.id === currentSelectedEmergencyId)
        : null
    const selectedEmergencyCoord = selectedEmergency
      ? validCoord(selectedEmergency.latitude, selectedEmergency.longitude)
      : null
    const selectedAnnouncement =
      currentSelectedAnnouncementId != null
        ? currentAnnouncements?.find(
            (a) => a.id === currentSelectedAnnouncementId
          )
        : null
    const selectedAnnouncementCoord = selectedAnnouncement
      ? validCoord(
          selectedAnnouncement.latitude,
          selectedAnnouncement.longitude
        )
      : null
    const coord =
      selectedPostCoord ?? selectedEmergencyCoord ?? selectedAnnouncementCoord
    if (coord) [lat, lng] = coord
    setSvCoord({ lat, lng })
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

  const boundaryGeomKey = boundary?.geometry
    ? JSON.stringify(boundary.geometry)
    : ""
  const fittedGeomKeyRef = useRef("")

  // Advisory areas show on selection only: hovering a pin opens its tip,
  // clicking it highlights the streets and boundary it covers.
  const applyAdvisoryFocus = useCallback(
    (id: number | null) => {
      const L = LRef.current
      const highlight = highlightGroupRef.current
      if (!L || !highlight) return
      highlight.clearLayers()
      for (const [key, entry] of advisoryRoadsRef.current) {
        const strong = id != null && key === id
        for (const { flow } of entry.roads) {
          flow.setStyle({ opacity: strong ? 1 : 0.9 })
        }
      }
      const entry = id != null ? advisoryRoadsRef.current.get(id) : null
      if (entry?.wide && boundary?.geometry) {
        const ring = geoJsonToRing(boundary.geometry as GeoJsonPolygon)
        if (ring.length >= 3) {
          L.polygon(ring, {
            // Keep the wide-advisory tint without drawing a second barangay
            // outline over the map.
            stroke: false,
            fillColor: entry.wide,
            fillOpacity: 0.15,
            interactive: false,
          }).addTo(highlight)
        }
      }
    },
    [boundary]
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
      if (
        (containerRef.current as HTMLDivElement & { _leaflet_id?: number })
          ._leaflet_id
      ) {
        containerRef.current.innerHTML = ""
      }
      LRef.current = L

      map = L.map(containerRef.current, {
        center: [center.latitude, center.longitude],
        zoom: Math.min(Math.max(center.zoom || 15, 13), 17),
        minZoom: 12,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        preferCanvas: false,
        fadeAnimation: false,
        zoomAnimation: true,
        markerZoomAnimation: false,
      })

      /**
       * Product basemap: CARTO light (clean grey streets — original E-Boses look).
       * Tailwind img max-width is overridden via .eboses-alerts-map CSS so
       * tiles stay visible.
       */
      addBaseTiles(L, map, "light", {
        maxZoom: 19,
        keepBuffer: 6,
        className: "eboses-map-tiles",
      })

      // Hover-only barangay fill: sits beneath every advisory road/marker.
      highlightGroupRef.current = L.layerGroup().addTo(map)
      coverageGroupRef.current = L.layerGroup().addTo(map)
      groupRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      closeHoverCardsOnLeave(map)

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
          openStreetViewAtPin: () => openStreetViewAtPin(),
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
    if (boundaryLayerRef.current) {
      try {
        map.removeLayer(boundaryLayerRef.current)
      } catch {
        /* ignore */
      }
      boundaryLayerRef.current = null
    }
    if (!boundaryGeomKey || !boundary?.geometry) {
      fittedGeomKeyRef.current = ""
      return
    }
    if (fittedGeomKeyRef.current === boundaryGeomKey) return

    // The selected community geometry is used for framing only. Its outline
    // and fill stay hidden so the map does not become a boundary diagram.
    boundaryLayerRef.current = L.geoJSON(
      boundary.geometry as Parameters<typeof L.geoJSON>[0],
      {
        style: {
          // Keep the geometry for framing, but hide the barangay boundary
          // visual from the alert map.
          stroke: false,
          fillOpacity: 0,
        },
        interactive: false,
      }
    ).addTo(map)
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
    const map = mapRef.current
    const group = groupRef.current
    if (!L || !map || !group) return
    group.clearLayers()
    advisoryRoadsRef.current.clear()
    highlightGroupRef.current?.clearLayers()

    // Only plot device GPS when near Marikina (avoids far-away user pin)
    if (userPos && isLocalGps(userPos, boundary?.geometry)) {
      const userMarker = L.marker([userPos.lat, userPos.lng], {
        icon: L.divIcon({
          className: "",
          html: dotPinHtml({
            color: MAP_COLORS.you,
            size: 14,
            live: true,
          }),
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        zIndexOffset: 1200,
        keyboard: false,
      })
      userMarker.addTo(group)
    }

    for (const post of posts) {
      const pos = validCoord(post.latitude, post.longitude)
      if (!pos) continue
      const severity = post.severity ?? null
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
            severity,
            selected,
            hoverGrow: true,
          }),
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        zIndexOffset: selected ? 900 : 100,
      })
      bindHoverCard(
        L,
        map,
        marker,
        {
          image: post.media?.[0]?.preview_url ?? null,
          resolutionImage:
            post.resolution_evidence?.find((item) =>
              item.mime_type.startsWith("image/")
            )?.preview_url ?? null,
          resolutionCount: post.resolution_evidence?.filter((item) =>
            item.mime_type.startsWith("image/")
          ).length,
          resolved:
            post.status === "resolved" || post.status === "partially_resolved",
          resolvedAt:
            [...(post.status_events ?? [])]
              .filter((event) => statusGroupOf(event.status) === "closed")
              .sort(
                (a, b) =>
                  new Date(b.created_at).getTime() -
                  new Date(a.created_at).getTime()
              )[0]?.created_at ?? post.updated_at,
          title: concernTitleText(post),
          reporterName: post.reporter?.full_name,
          meta:
            streetSegment(post.address) ||
            streetSegment(post.barangay) ||
            undefined,
          description: post.description,
          summary: post.summary,
          severity,
          date: post.created_at,
        },
        pinSize
      )
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
    const addAdvisoryMarker = (
      announcement: Announcement,
      at: leaflet.LatLngTuple
    ) => {
      const id = announcement.id
      const selected = selectedAnnouncementId === id
      const pinSize = advisoryMarkerSize(26, selected)
      const doneColor = advisoryDoneColor(
        announcement,
        ANNOUNCEMENT_ACCENT.color
      )
      const marker = L.marker(at, {
        icon: L.divIcon({
          className: "",
          html: advisoryMarkerHtml(
            announcement.tag,
            26,
            "light",
            selected,
            doneColor
          ),
          iconSize: [pinSize, pinSize],
          iconAnchor: [pinSize / 2, pinSize / 2],
        }),
        zIndexOffset: selected ? 700 : 600,
        keyboard: true,
      })
      const card = makeHoverCard(
        L,
        {
          image: announcement.image_url,
          eyebrow: advisoryLabel(announcement.tag),
          eyebrowColor: ANNOUNCEMENT_ACCENT.color,
          badgeSvg: advisoryGlyphHtml(announcement.tag, 18),
          title: announcementTitle(announcement),
          meta: announcement.place_label || announcement.barangay,
          excerpt: announcement.body,
          summary: announcementSummary(announcement),
          date:
            announcement.starts_at ??
            announcement.published_at ??
            announcement.created_at,
        },
        pinSize
      )
      marker.on("mouseover", () => {
        if (card) openHoverCard(map, card, marker)
      })
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectAnnouncement?.(id)
      })
      marker.addTo(group)
    }

    for (const announcement of announcements) {
      const geometry = announcement.area_geometry
      const point = validCoord(announcement.latitude, announcement.longitude)
      const tagColor = advisoryDoneColor(
        announcement,
        ANNOUNCEMENT_ACCENT.color
      )
      const roads: Array<{ flow: leaflet.Polyline }> = []
      const streetRuns = joinLineRuns(
        (announcement.street_geometries ?? []).flatMap(geoJsonToLines)
      )

      // An explicit point wins: the official pinned that exact place.
      if (point) addAdvisoryMarker(announcement, point)

      if (streetRuns.length > 0) {
        const drawRoad = (run: leaflet.LatLngTuple[]) => {
          const flow = L.polyline(run, {
            color: tagColor,
            weight: 4,
            opacity: 0.9,
            lineCap: "round",
            lineJoin: "round",
            dashArray: "7 7",
            className: "eboses-alerts-corridor-flow",
            interactive: false,
          }).addTo(group)
          roads.push({ flow })
        }
        let anchor: leaflet.LatLngTuple | null = null
        let anchorLat = 0
        let anchorLng = 0
        let anchorPointCount = 0
        for (const run of streetRuns) {
          drawRoad(run)
          for (const point of run) {
            anchorLat += point[0]
            anchorLng += point[1]
            anchorPointCount += 1
          }
        }
        if (anchorPointCount > 0) {
          anchor = [anchorLat / anchorPointCount, anchorLng / anchorPointCount]
        }
        if (!point && anchor) {
          addAdvisoryMarker(announcement, anchor)
        }
        if (roads.length > 0)
          advisoryRoadsRef.current.set(announcement.id, { roads, wide: null })
        continue
      }
      if (!geometry) {
        const fallback =
          advisoryFallbackAnchorsRef.current.get(announcement.id) ?? null
        if (!point && !fallback) {
          const slot = Math.abs(announcement.id) % 8
          const angle = (slot * Math.PI) / 4
          const jittered: leaflet.LatLngTuple = [
            center.latitude + Math.sin(angle) * 0.00012,
            center.longitude + Math.cos(angle) * 0.00012,
          ]
          advisoryFallbackAnchorsRef.current.set(announcement.id, jittered)
        }
        const fallbackAnchor =
          advisoryFallbackAnchorsRef.current.get(announcement.id) ?? null
        if (!point && fallbackAnchor)
          addAdvisoryMarker(announcement, fallbackAnchor)
        if (!point)
          advisoryRoadsRef.current.set(announcement.id, {
            roads: [],
            wide: tagColor,
          })
        continue
      }
      try {
        const areaLayer = L.geoJSON(
          geometry as Parameters<typeof L.geoJSON>[0],
          {
            style: {
              stroke: false,
              fillColor: tagColor,
              fillOpacity: 0.16,
              interactive: false,
            },
          }
        )
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
      bindHoverCard(
        L,
        map,
        marker,
        {
          title: `There is an ongoing ${em.type_label.toLowerCase()} around ${
            em.address?.trim() || em.barangay?.trim() || "the reported area"
          }`,
          excerpt: em.display_description || em.ai_summary || em.note,
          excerptLabel:
            em.display_description || em.ai_summary
              ? null
              : em.note
                ? "Resident report"
                : null,
          severity: "critical",
          date: em.created_at,
        },
        box
      )
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectEmergency?.(em.id)
      })
      marker.addTo(group)
    }
    // Re-apply after a rebuild: a selection survives while a hover does not.
    applyAdvisoryFocus(focusIdRef.current)
  }, [
    mapReady,
    posts,
    emergencies,
    announcements,
    selectedId,
    selectedEmergencyId,
    selectedAnnouncementId,
    userPos,
    userPosAt,
    viewerIsResponder,
    onSelect,
    onSelectEmergency,
    onSelectAnnouncement,
    boundary?.geometry,
    center.latitude,
    center.longitude,
    applyAdvisoryFocus,
  ])

  useEffect(() => {
    if (!mapReady || selectedId == null || !mapRef.current) return
    const post = posts.find((p) => p.id === selectedId)
    const pos = post ? validCoord(post.latitude, post.longitude) : null
    mapRef.current.closePopup()
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedId, posts])

  useEffect(() => {
    if (!mapReady || selectedEmergencyId == null || !mapRef.current) return
    const em = emergencies.find((e) => e.id === selectedEmergencyId)
    const pos = em ? validCoord(em.latitude, em.longitude) : null
    mapRef.current.closePopup()
    if (pos) mapRef.current.panTo(pos, { animate: true })
  }, [mapReady, selectedEmergencyId, emergencies])

  // Opening an advisory highlights its covered area while the panel is open;
  // closing the panel clears it back to pins only.
  useEffect(() => {
    if (!mapReady) return
    if (selectedAnnouncementId == null) {
      if (focusIdRef.current != null) {
        focusIdRef.current = null
        applyAdvisoryFocus(null)
      }
    } else {
      mapRef.current?.closePopup()
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
          background: #e8f5f0;
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
        .eboses-alerts-map .eboses-pin--glyph.is-alert .eboses-pin__disc {
          background: #fef2f2;
          color: #dc2626;
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
        .eboses-alerts-corridor-flow {
          animation: eboses-corridor-flow 1.1s linear infinite;
        }
        @keyframes eboses-corridor-flow {
          to {
            stroke-dashoffset: -14;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .eboses-alerts-corridor-flow {
            animation: none;
          }
        }
      `}</style>
      <div
        ref={containerRef}
        className="eboses-alerts-map absolute inset-0 z-0 h-full w-full bg-tint"
        style={{ minHeight: "100%" }}
      />
      {svCoord ? (
        <StreetViewModal
          coord={svCoord}
          points={svPoints}
          onMove={(next) => setSvCoord(next)}
          onClose={() => {
            setSvCoord(null)
          }}
        />
      ) : null}
    </>
  )
}
