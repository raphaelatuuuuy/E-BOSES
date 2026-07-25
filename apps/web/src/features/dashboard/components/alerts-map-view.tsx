import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  updateMapDispatchPolicy,
  type LiveMapSnapshot,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import { useMapWeather } from "@/features/dashboard/components/map-weather"
import {
  MapControls,
  MapLegend,
  StreetFilterBadge,
  AcceptanceZoneEditor,
} from "./alerts-map-view-panels"
import { useAcceptanceZone, useMapLayers } from "./alerts-map-view-hooks"

import type leaflet from "leaflet"

export type LayerKey = "boundary" | "streets" | "residents" | "officials" | "responders" | "concerns" | "emergencies" | "routes" | "acceptance_zone"
export type Selection = { kind: "person" | "concern" | "emergency"; id: number } | null
export type StreetLine = { name: string; line: leaflet.LatLngTuple[] }

function lineCoordinates(coordinates: unknown): leaflet.LatLngTuple[] {
  if (!Array.isArray(coordinates)) return []
  return coordinates.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return []
    const longitude = Number(point[0])
    const latitude = Number(point[1])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
    return [[latitude, longitude] as leaflet.LatLngTuple]
  })
}

function geoJsonToLines(geometry?: LiveMapSnapshot["map"]["boundary"]["geometry"] | null): leaflet.LatLngTuple[][] {
  if (!geometry) return []
  if (geometry.type === "LineString") {
    const line = lineCoordinates(geometry.coordinates)
    return line.length > 1 ? [line] : []
  }
  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((coordinates) => {
      const line = lineCoordinates(coordinates)
      return line.length > 1 ? [line] : []
    })
  }
  return []
}

export function AlertsLeafletMap({
  snapshot,
  layers,
  selected,
  selectedStreetNames,
  allowPolicyEditing = false,
  onSelect,
  onToggleLayer,
  onResetLayers,
  onPolicyUpdated,
  counts,
}: {
  snapshot: LiveMapSnapshot
  layers: Record<LayerKey, boolean>
  selected: Selection
  selectedStreetNames: Set<string>
  allowPolicyEditing?: boolean
  onSelect: (selection: Selection) => void
  onToggleLayer: (key: LayerKey) => void
  onResetLayers: () => void
  onPolicyUpdated?: (policy: MapDispatchPolicy) => void
  counts: { residents: number; responders: number; officials: number; emergencies: number; concerns: number; routes: number }
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const dynamicLayersRef = useRef<leaflet.LayerGroup | null>(null)
  const boundaryRef = useRef<leaflet.GeoJSON | null>(null)
  const [weatherOpen, setWeatherOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)
  const [zoneDraft, setZoneDraft] = useState<MapDispatchPolicy>(snapshot.map.dispatch_policy)
  const [zoneSaving, setZoneSaving] = useState(false)
  const weather = useMapWeather(
    snapshot.map.center.latitude,
    snapshot.map.center.longitude,
    snapshot.map.boundary.name,
  )
  const streetLines = useMemo<StreetLine[]>(() => {
    return snapshot.map.streets.streets.flatMap((street) =>
      (street.geometries ?? []).flatMap((geometry) => geoJsonToLines(geometry).map((line) => ({ name: street.name, line }))),
    )
  }, [snapshot.map.streets.streets])
  const streetKey = [...selectedStreetNames].toSorted().join("|")
  const zoneDraftKey = [zoneDraft.acceptance_center_latitude, zoneDraft.acceptance_center_longitude, zoneDraft.acceptance_radius_meters].join(":")
  const savedZoneKey = [snapshot.map.dispatch_policy.acceptance_center_latitude, snapshot.map.dispatch_policy.acceptance_center_longitude, snapshot.map.dispatch_policy.acceptance_radius_meters].join(":")
  const zoneDirty = zoneDraftKey !== savedZoneKey

  function updateZoneDraft(center: leaflet.LatLng, radius: number) {
    setZoneDraft((current) => ({
      ...current,
      acceptance_center_latitude: Number(center.lat.toFixed(7)),
      acceptance_center_longitude: Number(center.lng.toFixed(7)),
      acceptance_radius_meters: Math.max(100, Math.min(5000, Math.round(radius))),
    }))
  }

  async function saveZoneDraft() {
    setZoneSaving(true)
    try {
      const saved = await updateMapDispatchPolicy({
        acceptance_center_latitude: zoneDraft.acceptance_center_latitude,
        acceptance_center_longitude: zoneDraft.acceptance_center_longitude,
        acceptance_radius_meters: zoneDraft.acceptance_radius_meters,
        out_of_zone_action: zoneDraft.out_of_zone_action,
        witness_radius_meters: zoneDraft.witness_radius_meters,
        responder_nearby_radius_meters: zoneDraft.responder_nearby_radius_meters,
      })
      setZoneDraft(saved)
      onPolicyUpdated?.(saved)
      toast.success("Acceptance zone saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save acceptance zone.")
    } finally {
      setZoneSaving(false)
    }
  }

  function goHomeOnMap() {
    const map = mapRef.current
    if (!map) return
    const boundary = boundaryRef.current
    if (boundary) {
      map.fitBounds(boundary.getBounds(), { padding: [18, 18], animate: true })
      return
    }
    map.setView([snapshot.map.center.latitude, snapshot.map.center.longitude], snapshot.map.center.zoom, {
      animate: true,
    })
  }

  function goToCurrentLocation() {
    const map = mapRef.current
    if (!map) return
    if (!navigator.geolocation) {
      toast.error("Current location is not available on this device.")
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        map.setView([coords.latitude, coords.longitude], Math.max(map.getZoom(), 17), {
          animate: true,
        })
        setLocating(false)
      },
      () => {
        toast.error("Unable to read your current location.")
        setLocating(false)
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 10_000 },
    )
  }

  useEffect(() => {
    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return
      LRef.current = L
      map = L.map(containerRef.current, {
        center: [snapshot.map.center.latitude, snapshot.map.center.longitude],
        zoom: snapshot.map.center.zoom,
        zoomControl: false,
        attributionControl: false,
        preferCanvas: true,
        markerZoomAnimation: false,
      })
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
        maxZoom: 20,
        subdomains: "abcd",
      }).addTo(map)
      dynamicLayersRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      if (snapshot.map.boundary.geometry) {
        boundaryRef.current = L.geoJSON(snapshot.map.boundary.geometry as Parameters<typeof L.geoJSON>[0], {
          style: { color: "#ef4444", weight: 2, fillColor: "#ef4444", fillOpacity: 0.08, opacity: 0.9 },
        }).addTo(map)
        map.fitBounds(boundaryRef.current.getBounds(), { padding: [18, 18] })
        if (!layers.boundary && boundaryRef.current) map.removeLayer(boundaryRef.current)
      }
      requestAnimationFrame(() => map?.invalidateSize())
    }

    void init()
    return () => {
      cancelled = true
      map?.remove()
      if (mapRef.current === map) mapRef.current = null
    }
  }, [layers.boundary, snapshot.map.boundary.geometry, snapshot.map.center.latitude, snapshot.map.center.longitude, snapshot.map.center.zoom])

  useEffect(() => {
    const map = mapRef.current
    const boundary = boundaryRef.current
    if (!map || !boundary) return
    if (layers.boundary && !map.hasLayer(boundary)) boundary.addTo(map)
    if (!layers.boundary && map.hasLayer(boundary)) map.removeLayer(boundary)
  }, [layers.boundary])

  useAcceptanceZone({ mapRef, LRef, layers, allowPolicyEditing, zoneDraft, snapshot, updateZoneDraft })

  useMapLayers({ mapRef, LRef, dynamicLayersRef, layers, snapshot, selected, streetKey, streetLines, selectedStreetNames, onSelect })

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <MapControls
        onGoHome={goHomeOnMap}
        onGoToLocation={goToCurrentLocation}
        locating={locating}
        weatherOpen={weatherOpen}
        weather={weather}
        onWeatherToggle={() => setWeatherOpen((value) => !value)}
        onZoomIn={() => mapRef.current?.zoomIn()}
        onZoomOut={() => mapRef.current?.zoomOut()}
      />
      {layers.acceptance_zone && allowPolicyEditing ? (
        <div className="absolute right-3 top-3 z-[600] flex flex-col items-end gap-2 sm:right-4 sm:top-4">
          <AcceptanceZoneEditor
            zoneDraft={zoneDraft}
            zoneDirty={zoneDirty}
            zoneSaving={zoneSaving}
            onSave={() => void saveZoneDraft()}
          />
        </div>
      ) : null}
      <MapLegend
        layers={layers}
        counts={counts}
        onToggle={onToggleLayer}
        onReset={onResetLayers}
        open={legendOpen}
        onOpenChange={setLegendOpen}
      />
      <StreetFilterBadge selectedStreetNames={selectedStreetNames} />
    </div>
  )
}
