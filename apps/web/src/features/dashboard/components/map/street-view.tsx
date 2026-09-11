import { useEffect, useMemo, useRef, useState } from "react"
import { ExpandIcon, ShrinkIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { getStreetViewImage } from "@/features/dashboard/api"

import { MapControlButton, MapControlStack } from "./map-chrome"
import { insideCoverage, type CoverageInput } from "./coverage-layer"
import { glyphPinHtml, MAP_COLORS } from "./markers"
import { addBaseTiles } from "./tile-layers"

export type StreetViewCoord = { lat: number; lng: number }

export type StreetViewMapPoint = {
  id: string
  lat: number
  lng: number
  /** Pre-rendered pin markup — the exact same builder the main maps use. */
  html: string
  size: number
  title: string
  meta?: string
  excerpt?: string
  image?: string | null
}

const EMPTY_POINTS: StreetViewMapPoint[] = []
const FOOTPRINT_PATHS = [
  "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
  "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
  "M16 17h4",
  "M4 13h4",
]

type StreetViewCoverageState = {
  key: string
  status: "loading" | "available" | "no_coverage" | "error"
  image?: string
}

function esc(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function popupHtml(point: StreetViewMapPoint) {
  const image = point.image
    ? `<img class="eboses-sv-pop__img" src="${esc(point.image)}" alt="" />`
    : ""
  return `<div class="eboses-sv-pop__body">${image}<p class="eboses-sv-pop__title">${esc(point.title)}</p><p class="eboses-sv-pop__desc">${esc(point.excerpt ?? point.meta ?? "")}</p></div>`
}

function StreetViewPanorama({ src }: { src: string }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; offset: number } | null>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    setOffset(0)
  }, [src])

  function clampOffset(value: number) {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!viewport || !image) return value
    const overflow = Math.max(0, image.getBoundingClientRect().width - viewport.clientWidth)
    return Math.max(-overflow / 2, Math.min(overflow / 2, value))
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, offset }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setOffset(clampOffset(drag.offset + event.clientX - drag.x))
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      ref={viewportRef}
      className="absolute inset-0 min-h-0 min-w-0 max-w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      <img
        ref={imageRef}
        src={src}
        alt="Street View panorama"
        draggable={false}
        className="absolute top-0 left-1/2 h-full max-w-none"
        style={{ transform: `translate3d(calc(-50% + ${offset}px), 0, 0)` }}
      />
    </div>
  )
}

export function streetViewEmbedUrl(coord: StreetViewCoord, heading = 0) {
  const lat = coord.lat.toFixed(6)
  const lng = coord.lng.toFixed(6)
  const params = new URLSearchParams({
    q: "",
    layer: "c",
    cbll: `${lat},${lng}`,
    cbp: `11,${Math.round(heading)},0,0,0`,
    source: "embed",
    output: "svembed",
  })
  return `https://maps.google.com/maps?${params.toString()}`
}

function StreetViewMiniMap({
  coord,
  points,
  resizeSignal,
  onMove,
}: {
  coord: StreetViewCoord
  points: StreetViewMapPoint[]
  resizeSignal: string
  onMove?: (coord: StreetViewCoord) => void
}) {
  const elRef = useRef<HTMLDivElement>(null)
  const LRef = useRef<typeof import("leaflet") | null>(null)
  const mapRef = useRef<import("leaflet").Map | null>(null)
  const hereRef = useRef<import("leaflet").Marker | null>(null)
  const markersRef = useRef<import("leaflet").LayerGroup | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const onMoveRef = useRef(onMove)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    onMoveRef.current = onMove
  }, [onMove])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const L = await import("leaflet")
      if (cancelled || !elRef.current || mapRef.current) return
      const map = L.map(elRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        center: [coord.lat, coord.lng],
        zoom: 16,
      })
      addBaseTiles(L, map, "light")
      markersRef.current = L.layerGroup().addTo(map)
      const here = L.marker([coord.lat, coord.lng], {
        icon: L.divIcon({
          className: "",
          html: glyphPinHtml({
            paths: FOOTPRINT_PATHS,
            color: MAP_COLORS.route,
            size: 26,
          }),
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        interactive: false,
        zIndexOffset: 1500,
      })
      here.addTo(map)
      hereRef.current = here
      const host = elRef.current
      const closePopup = () => map.closePopup()
      host.addEventListener("mouseleave", closePopup)
      cleanupRef.current = () =>
        host.removeEventListener("mouseleave", closePopup)
      map.on("dblclick", (event: import("leaflet").LeafletMouseEvent) => {
        onMoveRef.current?.({
          lat: event.latlng.wrap().lat,
          lng: event.latlng.wrap().lng,
        })
      })
      LRef.current = L
      mapRef.current = map
      setReady(true)
    })()
    return () => {
      cancelled = true
      setReady(false)
      cleanupRef.current?.()
      cleanupRef.current = null
      hereRef.current = null
      markersRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coord is only the initial center; a follow effect tracks moves
  }, [])

  useEffect(() => {
    if (!ready) return
    hereRef.current?.setLatLng([coord.lat, coord.lng])
    mapRef.current?.setView(
      [coord.lat, coord.lng],
      Math.max(mapRef.current.getZoom(), 15)
    )
  }, [ready, coord.lat, coord.lng])

  useEffect(() => {
    if (!ready) return
    const L = LRef.current
    const map = mapRef.current
    const group = markersRef.current
    if (!L || !map || !group) return
    group.clearLayers()
    for (const point of points) {
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: "",
          html: point.html,
          iconSize: [point.size, point.size],
          iconAnchor: [point.size / 2, point.size / 2],
        }),
        keyboard: false,
      })
      marker.bindPopup(popupHtml(point), {
        className: "eboses-sv-pop",
        closeButton: false,
        // Pans the small clipped mini map so the card is never cut off.
        autoPan: true,
        autoPanPadding: L.point(10, 10),
        maxWidth: 240,
      })
      marker.on("mouseover", () => marker.openPopup())
      marker.off("click")
      marker.addTo(group)
    }
    const all: Array<[number, number]> = [
      [coord.lat, coord.lng],
      ...points.map((point) => [point.lat, point.lng] as [number, number]),
    ]
    if (all.length > 1) map.fitBounds(L.latLngBounds(all).pad(0.2))
  }, [ready, points])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      mapRef.current?.invalidateSize()
      requestAnimationFrame(() => mapRef.current?.invalidateSize())
    })
    return () => cancelAnimationFrame(frame)
  }, [resizeSignal])

  return (
    <div className="absolute inset-0">
      <div ref={elRef} className="size-full" />
    </div>
  )
}

export function StreetViewModal({
  coord,
  onClose,
  points = EMPTY_POINTS,
  onMove,
  mode = "browse",
  coverage = null,
  embedded = false,
}: {
  coord: StreetViewCoord
  onClose: () => void
  points?: StreetViewMapPoint[]
  /** Double-clicking the nearby map relocates Street View here. */
  onMove?: (coord: StreetViewCoord) => void
  /** Pick mode tints the view red outside coverage. */
  mode?: "browse" | "pick"
  coverage?: CoverageInput | null
  /** Render as a normal sheet panel instead of an absolute map overlay. */
  embedded?: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [miniOpen, setMiniOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const coordKey = `${coord.lat.toFixed(6)},${coord.lng.toFixed(6)}`
  const [streetCoverage, setStreetCoverage] = useState<StreetViewCoverageState>({
    key: "",
    status: "loading",
  })
  const pickMode = mode === "pick"
  const outOfScope = useMemo(
    () => Boolean(coverage && !insideCoverage(coord.lat, coord.lng, coverage)),
    [coord.lat, coord.lng, coverage]
  )
  const [mapSize, setMapSize] = useState<{ w: number; h: number } | null>(null)
  const mapPanelRef = useRef<HTMLDivElement>(null)
  const mapResizeStartRef = useRef<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [mapResizing, setMapResizing] = useState(false)

  function onMapResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    const rect = mapPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    mapResizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      w: rect.width,
      h: rect.height,
    }
    setMapResizing(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onMapResizeMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = mapResizeStartRef.current
    if (!start) return
    setMapSize({
      w: Math.min(
        560,
        Math.max(220, Math.round(start.w + (event.clientX - start.x)))
      ),
      h: Math.min(
        Math.round(window.innerHeight * 0.6),
        Math.max(180, Math.round(start.h - (event.clientY - start.y)))
      ),
    })
  }
  function onMapResizeEnd(event: React.PointerEvent<HTMLDivElement>) {
    mapResizeStartRef.current = null
    setMapResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyOverflowX = document.body.style.overflowX
    document.body.style.overflow = "hidden"
    document.body.style.overflowX = "hidden"
    document.body.classList.add("eboses-sv-open")
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousBodyOverflow
      document.body.style.overflowX = previousBodyOverflowX
      document.body.classList.remove("eboses-sv-open")
    }
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()
    setStreetCoverage({ key: coordKey, status: "loading" })
    void getStreetViewImage(coord, controller.signal)
      .then((result) => {
        if (result.status === "available" && result.image) {
          setStreetCoverage({
            key: coordKey,
            status: "available",
            image: result.image,
          })
        } else {
          setStreetCoverage({ key: coordKey, status: "no_coverage" })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStreetCoverage({ key: coordKey, status: "error" })
        }
      })
    return () => controller.abort()
  }, [coordKey, coord.lat, coord.lng])

  useEffect(() => {
    const host = hostRef.current
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement === host)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange)
      if (document.fullscreenElement && document.fullscreenElement === host) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement === hostRef.current) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void hostRef.current?.requestFullscreen().catch(() => {})
    }
  }

  const currentCoverage = streetCoverage.key === coordKey
    ? streetCoverage
    : { key: coordKey, status: "loading" as const }
  const coverageUnavailable = currentCoverage.status === "no_coverage" || currentCoverage.status === "error"

  return (
    <div
      ref={hostRef}
      className={cn(
        "z-[1000] min-h-0 min-w-0 max-w-full overflow-hidden bg-neutral-900",
        embedded
          ? "relative h-full w-full"
          : "absolute inset-0"
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Street View"
    >
      <div
        className={cn(
          "absolute inset-0 min-h-0 min-w-0 max-w-full overflow-hidden",
          pickMode && outOfScope && "eboses-map-blocked"
        )}
      >
        {currentCoverage.status === "available" && currentCoverage.image ? (
          <StreetViewPanorama src={currentCoverage.image} />
        ) : coverageUnavailable ? (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 px-6 text-center text-white">
            <div className="max-w-sm">
              <p className="text-base font-semibold">
                {currentCoverage.status === "no_coverage"
                  ? "Street View is unavailable at this location."
                  : "Street View could not be loaded at this location."}
              </p>
              <p className="mt-2 text-sm text-white/65">
                Open the nearby map and double-click a road to try another spot.
              </p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 px-6 text-center text-white">
            <p className="text-sm font-medium text-white/75">Loading Street View…</p>
          </div>
        )}
      </div>

      <div className="absolute top-2 right-2 z-20">
        <MapControlStack tone="light">
          <MapControlButton
            tone="light"
            label="Exit Street View"
            onClick={onClose}
            className="size-11"
          >
            <span
              aria-hidden
              className="material-symbols-outlined leading-none select-none"
              style={{ fontSize: "20px" }}
            >
              directions_run
            </span>
          </MapControlButton>
          <MapControlButton
            tone="light"
            divider
            active={fullscreen}
            label={fullscreen ? "Exit full screen" : "Toggle full screen"}
            onClick={toggleFullscreen}
            className="size-11"
          >
            {fullscreen ? (
              <ShrinkIcon className="size-5" strokeWidth={1.9} />
            ) : (
              <ExpandIcon className="size-5" strokeWidth={1.9} />
            )}
          </MapControlButton>
        </MapControlStack>
      </div>

      <div className="absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2">
        {miniOpen ? (
          <div
            ref={mapPanelRef}
            className={cn(
              "relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg",
              !mapResizing && "transition-[width,height] duration-150 ease-out",
              !mapSize && "h-72 w-80 max-w-[calc(100vw-1.5rem)]"
            )}
            style={
              mapSize ? { width: mapSize.w, height: mapSize.h } : undefined
            }
          >
            <StreetViewMiniMap
              coord={coord}
              points={points}
              resizeSignal={mapSize ? `${mapSize.w}x${mapSize.h}` : "fixed"}
              onMove={onMove}
            />
            <div className="absolute top-2 right-2 z-[810] flex flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-md">
              <button
                type="button"
                onClick={() => setMiniOpen(false)}
                aria-label="Close map"
                title="Close map"
                className="flex size-7 items-center justify-center text-neutral-600 hover:bg-neutral-100"
              >
                <XIcon className="size-4" strokeWidth={2.25} />
              </button>
            </div>
            <div
              onPointerDown={onMapResizeStart}
              onPointerMove={onMapResizeMove}
              onPointerUp={onMapResizeEnd}
              onPointerCancel={onMapResizeEnd}
              className="absolute top-0 right-0 z-[820] size-4 cursor-nwse-resize touch-none"
              aria-hidden
            />
          </div>
        ) : null}
        {miniOpen ? null : (
          <button
            type="button"
            onClick={() => setMiniOpen(true)}
            aria-label="Toggle nearby map"
            aria-expanded={false}
            title="Nearby map"
            className="flex size-10 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-md transition-colors hover:bg-neutral-50"
          >
            <span
              aria-hidden
              className="material-symbols-outlined leading-none select-none"
              style={{ fontSize: "20px" }}
            >
              map
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

export function startStreetViewPick(
  map: import("leaflet").Map,
  handlers: {
    onPick: (coord: StreetViewCoord) => void
    onCancel: () => void
  }
) {
  const container = map.getContainer()
  container.classList.add("eboses-sv-pick")

  function resolve(clientX: number, clientY: number) {
    const fakeEvent = new MouseEvent("click", {
      clientX,
      clientY,
      bubbles: true,
    })
    try {
      const point = map.mouseEventToLatLng(fakeEvent)
      if (point) handlers.onPick({ lat: point.lat, lng: point.lng })
    } catch {
      handlers.onCancel()
    }
  }

  function onMapClick(event: import("leaflet").LeafletMouseEvent) {
    handlers.onPick({ lat: event.latlng.lat, lng: event.latlng.lng })
  }
  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") handlers.onCancel()
  }
  function onDragOver(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }
  function onDrop(event: DragEvent) {
    event.preventDefault()
    if (event.clientX || event.clientY) resolve(event.clientX, event.clientY)
  }

  map.on("click", onMapClick)
  document.addEventListener("keydown", onKey)
  container.addEventListener("dragover", onDragOver)
  container.addEventListener("drop", onDrop)

  return () => {
    container.classList.remove("eboses-sv-pick")
    map.off("click", onMapClick)
    document.removeEventListener("keydown", onKey)
    container.removeEventListener("dragover", onDragOver)
    container.removeEventListener("drop", onDrop)
  }
}
