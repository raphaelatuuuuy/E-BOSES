import { useEffect } from "react"
import { XIcon } from "lucide-react"

export type StreetViewCoord = { lat: number; lng: number }

export function streetViewEmbedUrl(coord: StreetViewCoord, heading = 0) {
  const lat = coord.lat.toFixed(6)
  const lng = coord.lng.toFixed(6)
  return `https://maps.google.com/maps?layer=c&cbll=${lat},${lng}&cbp=11,${heading},0,0,0&output=svembed`
}

export function StreetViewModal({
  coord,
  onClose,
}: {
  coord: StreetViewCoord
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="absolute inset-0 z-[900] flex flex-col bg-nav-bg/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Street View"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-3 text-white">
        <p className="text-[13px] font-semibold">Street View</p>
        <p className="min-w-0 flex-1 truncate text-[12px] text-white/50 tabular-nums">
          {coord.lat.toFixed(5)}, {coord.lng.toFixed(5)}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Street View"
          title="Close Street View"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <XIcon className="size-5" strokeWidth={2.1} />
        </button>
      </div>
      <iframe
        key={`${coord.lat},${coord.lng}`}
        src={streetViewEmbedUrl(coord)}
        title="Street View"
        loading="lazy"
        allowFullScreen
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  )
}

export function startStreetViewPick(
  map: import("leaflet").Map,
  handlers: {
    onPick: (coord: StreetViewCoord) => void
    onCancel: () => void
  },
) {
  const container = map.getContainer()
  container.classList.add("eboses-sv-pick")

  function resolve(clientX: number, clientY: number) {
    const fakeEvent = new MouseEvent("click", { clientX, clientY, bubbles: true })
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
