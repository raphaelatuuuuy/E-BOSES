"use client"

import { useEffect, useRef } from "react"
import { MapIcon, MapPinIcon } from "lucide-react"

import type leaflet from "leaflet"

interface LocationPickerProps {
  onPin: (lat: number, lng: number) => void
  address: string
  onAddressChange: (val: string) => void
}

export default function LocationPicker({ onPin, address }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const markerRef = useRef<leaflet.Marker | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const initRef = useRef(false)
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin

  // Init map once
  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    let cancelled = false
    let map: leaflet.Map | null = null

    async function init() {
      const L = await import("leaflet")
      await import("leaflet/dist/leaflet.css")
      if (cancelled || !containerRef.current) return

      LRef.current = L

      map = L.map(containerRef.current, {
        center: [14.6341, 121.0962],
        zoom: 14,
        zoomControl: true,
        zoomSnap: 0.5,
        attributionControl: false,
      })

      // Move zoom controls to bottom-right
      map.zoomControl.setPosition("bottomright")

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map)

      // Fetch Marikina Heights boundary
      fetch("https://nominatim.openstreetmap.org/lookup?osm_ids=R371327&format=json&polygon_geojson=1")
        .then((r) => r.json())
        .then((data) => {
          if (cancelled || !data?.[0]?.geojson) return
          const geo = data[0].geojson
          const layer = L.geoJSON(geo, {
            style: { color: "#ff5003", weight: 2, fillOpacity: 0.08, opacity: 0.7 },
          }).addTo(map!)
          map!.fitBounds(layer.getBounds(), { padding: [30, 30] })
        })
        .catch(() => {})

      map.on("click", (e: leaflet.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng
        if (markerRef.current && map!.hasLayer(markerRef.current)) map!.removeLayer(markerRef.current)
        const marker = L.marker([lat, lng], { draggable: true })
        marker.on("dragend", () => {
          onPinRef.current(marker.getLatLng().lat, marker.getLatLng().lng)
        })
        marker.addTo(map!)
        markerRef.current = marker
        onPinRef.current(lat, lng)
        if (map!.getZoom() < 16) map!.setView([lat, lng], 16)
      })

      mapRef.current = map
      requestAnimationFrame(() => map?.invalidateSize())
    }

    init()

    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="relative">
        {/* Map container */}
        <div ref={containerRef} className="h-full w-full min-h-[260px]" />
        {/* Barangay badge — bottom-left */}
        <div className="absolute bottom-3 left-3 z-[1000] flex cursor-default items-center gap-3 rounded-sm bg-white/90 px-3 py-2 shadow-sm ring-1 ring-black/5 transition-opacity hover:opacity-60">
          <MapPinIcon className="size-4 shrink-0 text-[#2447b3]" />
          <div>
            <p className="text-xs font-bold leading-tight text-[#07145f]">Your Barangay</p>
            <p className="text-xs font-medium leading-tight text-[#68739c]">Brgy. Marikina Heights</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-white px-3 py-2 text-xs text-[#43507f]">
        <MapIcon className="size-4 shrink-0 text-[#2447b3]" />
        <span className="font-semibold">Selected location:</span>
        <span className="truncate text-[#68739c]">{address || "None"}</span>
      </div>
    </div>
  )
}
