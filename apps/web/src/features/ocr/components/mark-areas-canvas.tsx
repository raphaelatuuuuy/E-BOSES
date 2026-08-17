import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { CloudUpload } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, ProofSide } from "@/features/ocr/api"
import {
  defaultRegionForIndex,
  fieldCanvasSide,
  fieldDisplayNumber,
  hintsOf,
  type FieldRegion,
} from "@/features/ocr/lib/create-document-defaults"

type RegionDragState = {
  mode: "move" | "resize"
  fieldKey: string
  startX: number
  startY: number
  origin: FieldRegion
} | null

function regionsOverlapOrClose(
  a: FieldRegion,
  b: FieldRegion,
  pad = 0.02,
) {
  const a2 = { x1: a.x - pad, y1: a.y - pad, x2: a.x + a.w + pad, y2: a.y + a.h + pad }
  const b2 = { x1: b.x - pad, y1: b.y - pad, x2: b.x + b.w + pad, y2: b.y + b.h + pad }
  return !(a2.x2 < b2.x1 || b2.x2 < a2.x1 || a2.y2 < b2.y1 || b2.y2 < a2.y1)
}

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  // single-side proofs use the front photo — label it consistently.
  return "Front"
}

export function MarkAreasCanvas(props: {
  imageUrl: string | null
  fields: OcrFieldDefinition[]
  selectedFieldKey: string | null
  zoom: number
  sampleSide: ProofSide
  emptyUploadLabel?: string
  onSelectField: (key: string) => void
  onSetFieldRegion: (fieldKey: string, region: FieldRegion) => void
  onRequestUpload?: () => void
}) {
  const {
    imageUrl,
    fields,
    selectedFieldKey,
    zoom,
    sampleSide,
    emptyUploadLabel,
    onSelectField,
    onSetFieldRegion,
    onRequestUpload,
  } = props

  const canvasFrameRef = useRef<HTMLDivElement>(null)
  const [regionDrag, setRegionDrag] = useState<RegionDragState>(null)

  // Only draw fields for this sample side so front/back boxes never overlap.
  const sideKey = sampleSide === "back" ? "back" : "front"
  const sorted = [...fields]
    .filter((field) => fieldCanvasSide(field) === sideKey)
    .sort((a, b) => a.order - b.order)

  function pointerToRelative(clientX: number, clientY: number) {
    const frame = canvasFrameRef.current
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    }
  }

  function beginRegionDrag(
    event: ReactPointerEvent<HTMLElement>,
    fieldKey: string,
    mode: "move" | "resize",
    origin: FieldRegion,
  ) {
    event.preventDefault()
    event.stopPropagation()
    onSelectField(fieldKey)
    const point = pointerToRelative(event.clientX, event.clientY)
    if (!point) return

    const drag: NonNullable<RegionDragState> = {
      mode,
      fieldKey,
      startX: point.x,
      startY: point.y,
      origin: { ...origin },
    }
    setRegionDrag(drag)

    const onMove = (moveEvent: PointerEvent) => {
      const next = pointerToRelative(moveEvent.clientX, moveEvent.clientY)
      if (!next) return
      const dx = next.x - drag.startX
      const dy = next.y - drag.startY
      if (drag.mode === "move") {
        onSetFieldRegion(drag.fieldKey, {
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy,
        })
        return
      }
      onSetFieldRegion(drag.fieldKey, {
        ...drag.origin,
        w: drag.origin.w + dx,
        h: drag.origin.h + dy,
      })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      setRegionDrag(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  if (!imageUrl) {
    // Borderless upload target — the photo fills the section when added.
    return (
      <button
        type="button"
        onClick={onRequestUpload}
        className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-2 rounded-[18px] bg-neutral-50 px-6 py-14 text-center transition-colors hover:bg-neutral-100"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          <CloudUpload className="size-6" strokeWidth={1.8} />
        </span>
        <span className="text-[15px] font-semibold text-neutral-900">
          {emptyUploadLabel ??
            (sampleSide === "back"
              ? "Upload the back"
              : sampleSide === "front"
                ? "Upload the front"
                : "Upload a sample photo")}
        </span>
        <span className="text-[13px] text-neutral-500">
          Clear JPG or PNG works best
        </span>
      </button>
    )
  }

  // The photo fills the section with no frame. The boxes are neutral ink,
  // not colour-coded: square, grey, numbered — kept thin so the photo stays
  // readable underneath.
  const ink = "#171717"

  return (
    <div className="relative flex min-h-[16rem] w-full items-center justify-center overflow-auto rounded-[18px] bg-white">
      <div
        className="relative origin-center"
        style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
      >
        <div ref={canvasFrameRef} className="relative block w-full max-h-[32rem]">
          <img
            src={imageUrl}
            alt="Sample photo"
            className="block max-h-[32rem] w-full select-none bg-white object-contain"
            draggable={false}
          />
          {sorted.map((field, index) => {
            const region =
              hintsOf(field).region ?? defaultRegionForIndex(index, sorted.length)
            const displayNumber = fieldDisplayNumber(field, fields)
            const selected = selectedFieldKey === field.key
            const crowded = sorted.some((other, otherIndex) => {
              if (other.key === field.key) return false
              const otherRegion =
                hintsOf(other).region ?? defaultRegionForIndex(otherIndex, sorted.length)
              return regionsOverlapOrClose(region, otherRegion)
            })
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                title={`${field.label}. Drag to move, corner to resize. The system reads text inside this box.`}
                onPointerDown={(event) => beginRegionDrag(event, field.key, "move", region)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onSelectField(field.key)
                  }
                }}
                className={cn(
                  "absolute cursor-move border-2 text-left outline-none transition-opacity",
                  selected ? "z-20" : "z-10 hover:z-20",
                  regionDrag?.fieldKey === field.key && "z-30",
                  !selected && crowded && "hover:opacity-100",
                )}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.w * 100}%`,
                  height: `${region.h * 100}%`,
                  borderColor: ink,
                  backgroundColor: `rgba(23, 23, 23, ${selected ? 0.12 : crowded ? 0.03 : 0.06})`,
                  opacity: selected ? 1 : crowded ? 0.55 : 0.9,
                  borderWidth: selected ? 2 : crowded ? 1 : 1.5,
                }}
              >
                <span
                  className={cn(
                    "pointer-events-none absolute -left-px max-w-[10rem] truncate px-1.5 py-0.5 text-[10px] font-bold text-white",
                    selected || !crowded ? "-top-5" : "-top-4 scale-95",
                  )}
                  style={{
                    backgroundColor: ink,
                    opacity: selected ? 1 : crowded ? 0.7 : 0.95,
                  }}
                >
                  {displayNumber} {field.label}
                </span>
                {selected ? (
                  <span
                    aria-label={`Resize ${field.label}`}
                    onPointerDown={(event) =>
                      beginRegionDrag(event, field.key, "resize", region)
                    }
                    className="absolute -bottom-2 -right-2 size-2.5 cursor-se-resize rounded-full"
                    style={{ backgroundColor: ink }}
                  />
                ) : null}
              </div>
            )
          })}
          <span className="pointer-events-none absolute bottom-2 right-2 rotate-[-8deg] text-[13px] font-semibold uppercase tracking-widest text-neutral-400">
            {sideLabel(sampleSide)} preview
          </span>
        </div>
      </div>
    </div>
  )
}