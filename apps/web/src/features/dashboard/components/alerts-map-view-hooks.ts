import { useEffect, useRef } from "react"
import type leaflet from "leaflet"
import type { LiveMapSnapshot, MapDispatchPolicy } from "@/features/dashboard/api"
import type { LayerKey, Selection, StreetLine } from "./alerts-map-view"

function listenLeaflet(target: leaflet.Evented, event: string, handler: leaflet.LeafletEventHandlerFn) {
  target.on(event, handler)
  return () => target.off(event, handler)
}

function validCoord(lat?: string | null, lng?: string | null) {
  const latitude = Number(lat)
  const longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return [latitude, longitude] as leaflet.LatLngTuple
}

export function useAcceptanceZone({
  mapRef,
  LRef,
  layers,
  allowPolicyEditing,
  zoneDraft,
  snapshot,
  updateZoneDraft,
}: {
  mapRef: React.MutableRefObject<leaflet.Map | null>
  LRef: React.MutableRefObject<typeof leaflet | null>
  layers: Record<LayerKey, boolean>
  allowPolicyEditing: boolean
  zoneDraft: MapDispatchPolicy
  snapshot: LiveMapSnapshot
  updateZoneDraft: (center: leaflet.LatLng, radius: number) => void
}) {
  const acceptanceZoneRef = useRef<leaflet.Circle | null>(null)
  const zoneHandleRef = useRef<leaflet.Marker | null>(null)
  const zoneCenterRef = useRef<leaflet.Marker | null>(null)

  const zoneDraftKey = [
    zoneDraft.acceptance_center_latitude,
    zoneDraft.acceptance_center_longitude,
    zoneDraft.acceptance_radius_meters,
  ].join(":")

  useEffect(() => {
    const map = mapRef.current
    const L = LRef.current
    if (!map || !L) return () => { try { map?.off() } catch {} }

    if (acceptanceZoneRef.current) { map.removeLayer(acceptanceZoneRef.current); acceptanceZoneRef.current = null }
    if (zoneHandleRef.current) { map.removeLayer(zoneHandleRef.current); zoneHandleRef.current = null }
    if (zoneCenterRef.current) { map.removeLayer(zoneCenterRef.current); zoneCenterRef.current = null }

    if (!layers.acceptance_zone) return () => {
      if (acceptanceZoneRef.current) { try { map.removeLayer(acceptanceZoneRef.current) } catch {} acceptanceZoneRef.current = null }
      if (zoneHandleRef.current) { try { map.removeLayer(zoneHandleRef.current) } catch {} zoneHandleRef.current = null }
      if (zoneCenterRef.current) { try { map.removeLayer(zoneCenterRef.current) } catch {} zoneCenterRef.current = null }
    }

    const policyNumber = (value: number | string, fallback: number) => {
      const next = Number(value)
      return Number.isFinite(next) ? next : fallback
    }

    const centerLat = policyNumber(zoneDraft.acceptance_center_latitude, snapshot.map.center.latitude)
    const centerLng = policyNumber(zoneDraft.acceptance_center_longitude, snapshot.map.center.longitude)
    const centerLatLng = L.latLng(centerLat, centerLng)
    const radius = Math.max(100, Math.min(5000, Number(zoneDraft.acceptance_radius_meters) || 800))

    const circle = L.circle(centerLatLng, {
      radius,
      color: "#94a3b8",
      fillColor: "#94a3b8",
      fillOpacity: 0.06,
      weight: 1.5,
      dashArray: "6 6",
    }).addTo(map)
    acceptanceZoneRef.current = circle

    if (!allowPolicyEditing) return () => {
      if (acceptanceZoneRef.current) { try { map.removeLayer(acceptanceZoneRef.current) } catch {} acceptanceZoneRef.current = null }
      if (zoneHandleRef.current) { try { map.removeLayer(zoneHandleRef.current) } catch {} zoneHandleRef.current = null }
      if (zoneCenterRef.current) { try { map.removeLayer(zoneCenterRef.current) } catch {} zoneCenterRef.current = null }
    }

    let dragging = false
    let dragOffset = { lat: 0, lng: 0 }
    const onCircleMouseDown = (e: leaflet.LeafletMouseEvent) => {
      dragging = true
      const circleCenter = circle.getLatLng()
      dragOffset = { lat: e.latlng.lat - circleCenter.lat, lng: e.latlng.lng - circleCenter.lng }
      map.dragging.disable()
    }
    circle.on("mousedown", onCircleMouseDown)

    const onMapMouseMove = (e: leaflet.LeafletMouseEvent) => {
      if (!dragging) return
      const newLat = e.latlng.lat - dragOffset.lat
      const newLng = e.latlng.lng - dragOffset.lng
      const newCenter = L.latLng(newLat, newLng)
      circle.setLatLng(newCenter)
      centerMarker.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    }
    map.on("mousemove", onMapMouseMove)

    const onMapMouseUp = () => {
      if (!dragging) return
      dragging = false
      map.dragging.enable()
      updateZoneDraft(circle.getLatLng(), circle.getRadius())
    }
    map.on("mouseup", onMapMouseUp)

    const centerMarker = L.marker(centerLatLng, {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;border-radius:999px;background:#94a3b8;border:2px solid #fff;box-shadow:0 0 0 6px rgba(148,163,184,.2);cursor:grab"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      }),
    }).addTo(map)
    zoneCenterRef.current = centerMarker

    const handleLat = centerLatLng.lat
    const handleLng = centerLatLng.lng + (radius / 111320) * Math.cos(centerLatLng.lat * Math.PI / 180)
    const handle = L.marker([handleLat, handleLng], {
      draggable: true,
      icon: L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;border-radius:999px;background:#94a3b8;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:grab"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map)
    zoneHandleRef.current = handle

    const onCenterDrag = () => {
      const newCenter = centerMarker.getLatLng()
      circle.setLatLng(newCenter)
      const currentRadius = circle.getRadius()
      const eastLng = newCenter.lng + (currentRadius / 111320) * Math.cos(newCenter.lat * Math.PI / 180)
      handle.setLatLng([newCenter.lat, eastLng])
    }
    centerMarker.on("drag", onCenterDrag)

    const onCenterDragEnd = () => updateZoneDraft(circle.getLatLng(), circle.getRadius())
    centerMarker.on("dragend", onCenterDragEnd)

    const onHandleDrag = () => {
      const handlePos = handle.getLatLng()
      const centerPos = circle.getLatLng()
      const newRadius = centerPos.distanceTo(handlePos)
      circle.setRadius(newRadius)
    }
    handle.on("drag", onHandleDrag)

    const onHandleDragEnd = () => updateZoneDraft(circle.getLatLng(), circle.getRadius())
    handle.on("dragend", onHandleDragEnd)

    return () => {
      circle.off("mousedown", onCircleMouseDown)
      map.off("mousemove", onMapMouseMove)
      map.off("mouseup", onMapMouseUp)
      centerMarker.off("drag", onCenterDrag)
      centerMarker.off("dragend", onCenterDragEnd)
      handle.off("drag", onHandleDrag)
      handle.off("dragend", onHandleDragEnd)
      if (acceptanceZoneRef.current) { try { map.removeLayer(acceptanceZoneRef.current) } catch {} acceptanceZoneRef.current = null }
      if (zoneHandleRef.current) { try { map.removeLayer(zoneHandleRef.current) } catch {} zoneHandleRef.current = null }
      if (zoneCenterRef.current) { try { map.removeLayer(zoneCenterRef.current) } catch {} zoneCenterRef.current = null }
    }
  }, [mapRef, LRef, allowPolicyEditing, layers.acceptance_zone, snapshot.map.center.latitude, snapshot.map.center.longitude, zoneDraftKey, zoneDraft.acceptance_center_latitude, zoneDraft.acceptance_center_longitude, zoneDraft.acceptance_radius_meters, updateZoneDraft])
}

export function useMapLayers({
  mapRef,
  LRef,
  dynamicLayersRef,
  layers,
  snapshot,
  selected,
  streetKey,
  streetLines,
  selectedStreetNames,
  onSelect,
}: {
  mapRef: React.MutableRefObject<leaflet.Map | null>
  LRef: React.MutableRefObject<typeof leaflet | null>
  dynamicLayersRef: React.MutableRefObject<leaflet.LayerGroup | null>
  layers: Record<LayerKey, boolean>
  snapshot: LiveMapSnapshot
  selected: Selection
  streetKey: string
  streetLines: StreetLine[]
  selectedStreetNames: Set<string>
  onSelect: (selection: Selection) => void
}) {
  useEffect(() => {
    const L = LRef.current
    const group = dynamicLayersRef.current
    if (!L || !group) return undefined
    const cleanups: Array<() => void> = []
    group.clearLayers()

    if (layers.streets) {
      for (const { name, line } of streetLines) {
        const selectedStreet = selectedStreetNames.has(name)
        if (selectedStreetNames.size && !selectedStreet) continue
        L.polyline(line, {
          color: selectedStreet ? "#2447b3" : "#2563eb",
          opacity: selectedStreet ? 0.95 : 0.5,
          weight: selectedStreet ? 3.5 : 2,
        }).addTo(group)
      }
    }

    if (layers.routes) {
      for (const route of snapshot.routes) {
        if (route.status === "ok" && route.geometry) {
          L.polyline(route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as leaflet.LatLngTuple), {
            color: "#2563eb",
            dashArray: "8 8",
            opacity: 0.85,
            weight: 4,
          }).addTo(group)
        }
      }
    }

    for (const concern of snapshot.concerns) {
      if (!layers.concerns) continue
      const coord = validCoord(concern.latitude, concern.longitude)
      if (!coord) continue
      const color = "#f97316"
      const marker = L.marker(coord, {
        icon: L.divIcon({ className: "", html: `<div style="width:22px;height:22px;border-radius:999px;background:${color};border:2.5px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.28)"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      })
      const handleClick = () => onSelect({ kind: "concern", id: concern.id })
      cleanups.push(listenLeaflet(marker, "click", handleClick))
      marker.addTo(group)
    }

    for (const emergency of snapshot.emergencies) {
      if (!layers.emergencies) continue
      const coord = validCoord(emergency.latitude, emergency.longitude)
      if (!coord) continue
      const marker = L.marker(coord, {
        icon: L.divIcon({ className: "", html: `<div style="width:26px;height:26px;border-radius:999px;background:#dc2626;border:3px solid #fff;box-shadow:0 0 0 10px #dc262622, 0 2px 10px rgba(220,38,38,.45)"></div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      })
      const handleClick = () => onSelect({ kind: "emergency", id: emergency.id })
      cleanups.push(listenLeaflet(marker, "click", handleClick))
      marker.addTo(group)
    }

    for (const person of snapshot.people) {
      const coord = validCoord(person.latitude, person.longitude)
      if (!coord) continue
      if (person.role === "resident" && !layers.residents) continue
      if (person.role === "barangay_official" && !layers.officials) continue
      if (person.role === "first_responder" && !layers.responders) continue
      const color = person.role === "resident" ? "#22c55e" : person.role === "barangay_official" ? "#7c3aed" : "#2563eb"
      const marker = L.marker(coord, {
        icon: L.divIcon({ className: "", html: `<div style="width:22px;height:22px;border-radius:999px;background:${color};border:2.5px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.28)"></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      })
      const handleClick = () => onSelect({ kind: "person", id: person.id })
      cleanups.push(listenLeaflet(marker, "click", handleClick))
      marker.addTo(group)
    }

    if (selected?.kind === "emergency") {
      const emergency = snapshot.emergencies.find((item) => item.id === selected.id)
      const coord = emergency ? validCoord(emergency.latitude, emergency.longitude) : null
      const map = mapRef.current
      if (coord && map) map.setView(coord, Math.max(map.getZoom(), 16), { animate: true })
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      group.clearLayers()
    }
  }, [mapRef, LRef, dynamicLayersRef, snapshot, layers, selected?.kind, selected?.id, streetKey, streetLines, selectedStreetNames, onSelect])
}
