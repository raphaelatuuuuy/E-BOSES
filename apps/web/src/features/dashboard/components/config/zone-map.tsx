import { useEffect, useRef } from "react"
import type leaflet from "leaflet"

/**
 * The barangay's radii, drawn.
 *
 * These settings were four number inputs. "800 metres" tells an official
 * nothing about whether it covers the barangay; three concentric circles over
 * the actual map answer that in a glance, and dragging the centre pin is a far
 * better way to place it than typing coordinates.
 *
 * Circles update live as the form changes, so the numbers and the picture never
 * disagree.
 */

export interface ZoneMapValue {
  latitude: number
  longitude: number
  acceptanceRadius: number
  witnessRadius: number
  responderRadius: number
}

const RING = {
  acceptance: "#1f6c98",
  witness: "#f2a03d",
  responder: "#2f9e78",
}

export function ZoneMap({
  value,
  onCenterChange,
  className = "",
}: {
  value: ZoneMapValue
  onCenterChange: (latitude: number, longitude: number) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<leaflet.Map | null>(null)
  const LRef = useRef<typeof leaflet | null>(null)
  const layersRef = useRef<leaflet.LayerGroup | null>(null)
  const markerRef = useRef<leaflet.Marker | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  // Read inside async callbacks so the map is not re-created on every change.
  const valueRef = useRef(value)
  const onCenterChangeRef = useRef(onCenterChange)
  useEffect(() => {
    valueRef.current = value
    onCenterChangeRef.current = onCenterChange
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const L = (await import("leaflet")).default
      if (cancelled || !containerRef.current || mapRef.current) return

      LRef.current = L
      const current = valueRef.current
      const map = L.map(containerRef.current, {
        center: [current.latitude, current.longitude],
        zoom: 15,
        scrollWheelZoom: false,
        attributionControl: false,
      })
      // Matches the Alert Map: staff maps share one dark basemap so the
      // official side does not switch visual language between screens.
      containerRef.current?.classList.add("eboses-map-dark")

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 19,
      }).addTo(map)

      layersRef.current = L.layerGroup().addTo(map)

      const marker = L.marker([current.latitude, current.longitude], { draggable: true }).addTo(map)
      marker.on("dragend", () => {
        const position = marker.getLatLng()
        onCenterChangeRef.current(
          Number(position.lat.toFixed(7)),
          Number(position.lng.toFixed(7)),
        )
      })
      markerRef.current = marker

      // Clicking is faster than dragging when moving the centre a long way.
      map.on("click", (event: leaflet.LeafletMouseEvent) => {
        onCenterChangeRef.current(
          Number(event.latlng.lat.toFixed(7)),
          Number(event.latlng.lng.toFixed(7)),
        )
      })

      mapRef.current = map

      // Leaflet measures its container once, at creation. This panel mounts
      // inside a card whose width settles a frame later (and changes again on
      // resize), so without this the map keeps its first measurement and paints
      // blank space where tiles should be.
      map.invalidateSize()
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        const observer = new ResizeObserver(() => map.invalidateSize())
        observer.observe(containerRef.current)
        observerRef.current = observer
      }
    })()

    return () => {
      cancelled = true
      observerRef.current?.disconnect()
      observerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Redraw the rings whenever any radius or the centre changes.
  useEffect(() => {
    const L = LRef.current
    const map = mapRef.current
    const layers = layersRef.current
    if (!L || !map || !layers) return

    layers.clearLayers()

    const center: [number, number] = [value.latitude, value.longitude]

    const rings: { radius: number; color: string; label: string }[] = [
      { radius: value.acceptanceRadius, color: RING.acceptance, label: "Reports accepted" },
      { radius: value.witnessRadius, color: RING.witness, label: "Neighbours alerted" },
      { radius: value.responderRadius, color: RING.responder, label: "Responder counts as nearby" },
    ]

    // Largest first so the smaller rings stay visible on top.
    for (const ring of [...rings].sort((a, b) => b.radius - a.radius)) {
      L.circle(center, {
        radius: ring.radius,
        color: ring.color,
        weight: 2,
        fillColor: ring.color,
        fillOpacity: 0.07,
      })
        .bindTooltip(`${ring.label} · ${ring.radius}m`, { sticky: true })
        .addTo(layers)
    }

    markerRef.current?.setLatLng(center)
  }, [value])

  // Follow the centre only when it actually moves, not when a radius changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.setView([value.latitude, value.longitude], map.getZoom(), { animate: false })
    map.invalidateSize()
  }, [value.latitude, value.longitude])

  return (
    <div className={`overflow-hidden rounded-2xl border border-card-line ${className}`}>
      <div ref={containerRef} className="h-72 w-full md:h-96" />
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-card-line bg-card px-3 py-2.5">
        {[
          { color: RING.acceptance, label: "Reports accepted", value: value.acceptanceRadius },
          { color: RING.witness, label: "Neighbours alerted", value: value.witnessRadius },
          { color: RING.responder, label: "Nearby responder", value: value.responderRadius },
        ].map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-xs font-semibold">
            <span
              aria-hidden
              className="size-2.5 rounded-full border-2"
              style={{ borderColor: item.color, backgroundColor: `${item.color}22` }}
            />
            <span className="text-foreground">{item.label}</span>
            <span className="tabular-nums text-muted-foreground">{item.value}m</span>
          </span>
        ))}
        <span className="ml-auto text-xs font-medium text-muted-foreground">
          Drag the pin or click the map to move the centre
        </span>
      </div>
    </div>
  )
}
