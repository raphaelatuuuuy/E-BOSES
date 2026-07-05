"use client"

import { useEffect, useRef, useState } from "react"
import { LocateFixedIcon, SearchIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type leaflet from "leaflet"

interface LocationPickerProps {
  onPin: (lat: number, lng: number) => void
  address: string
  onAddressChange: (val: string) => void
}

let searchTimeout: ReturnType<typeof setTimeout> | null = null

export default function LocationPicker({ onPin, address, onAddressChange }: LocationPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const markerRef = useRef<leaflet.Marker | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const initRef = useRef(false)
  const onPinRef = useRef(onPin)
  onPinRef.current = onPin
  const [locating, setLocating] = useState(false)
  const [searchResults, setSearchResults] = useState<{ lat: number; lon: number; display: string }[]>([])

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
        zoomControl: false,
      })

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

  function handleSearch(value: string) {
    onAddressChange(value)
    if (searchTimeout) clearTimeout(searchTimeout)
    if (!value.trim()) { setSearchResults([]); return }

    searchTimeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&limit=5&countrycodes=PH`,
          { headers: { "User-Agent": "eBosesApp/1.0" } },
        )
        const data = await res.json()
        setSearchResults(
          data.map((r: { lat: string; lon: string; display_name: string }) => ({
            lat: Number(r.lat),
            lon: Number(r.lon),
            display: r.display_name,
          })),
        )
      } catch { /* silent */ }
    }, 400)
  }

  function dropPin(lat: number, lng: number) {
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (markerRef.current) map.removeLayer(markerRef.current)
    const marker = L.marker([lat, lng], { draggable: true })
    marker.on("dragend", () => {
      onPinRef.current(marker.getLatLng().lat, marker.getLatLng().lng)
    })
    marker.addTo(map)
    markerRef.current = marker
    onPinRef.current(lat, lng)
  }

  function goToResult(lat: number, lon: number) {
    mapRef.current?.setView([lat, lon], 17)
    dropPin(lat, lon)
    setSearchResults([])
  }

  function handleLocate() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        mapRef.current?.setView([latitude, longitude], 17)
        dropPin(latitude, longitude)
        setLocating(false)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="relative flex h-full w-full flex-col rounded-lg border border-border overflow-hidden">
      {/* Top bar */}
      <div className="absolute left-2 right-2 top-2 z-[1000] flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={address}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search location"
              className="w-full rounded-md bg-white py-1.5 pl-8 pr-3 text-xs text-foreground shadow-md ring-1 ring-border outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={handleLocate}
            disabled={locating}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md ring-1 ring-border transition-colors hover:bg-muted disabled:opacity-60",
            )}
          >
            <LocateFixedIcon className="size-3.5" />
            {locating ? "…" : "Locate"}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="max-h-[160px] overflow-y-auto rounded-md bg-white shadow-md ring-1 ring-border">
            {searchResults.map((r, i) => (
              <button key={i} type="button" onClick={() => goToResult(r.lat, r.lon)}
                className="w-full px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted border-b border-border last:border-0"
              >
                {r.display}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map container */}
      <div ref={containerRef} className="h-full w-full min-h-[260px]" />
    </div>
  )
}
