import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { CloudUpload } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, ProofSide } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import {
  defaultRegionForIndex,
  fieldCanvasSide,
  fieldDisplayColor,
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

  return (
    <div className="relative flex min-h-[16rem] flex-1 items-center justify-center overflow-auto rounded-xl bg-tint p-4">
      {!imageUrl ? (
        <button
          type="button"
          onClick={onRequestUpload}
          className="flex w-full max-w-md flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-14 text-center shadow-sm"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-tint text-accent">
            <CloudUpload className="size-6" />
          </span>
          <span className={cn("text-sm font-semibold", PROOF_THEME.title)}>
            {emptyUploadLabel ??
              (sampleSide === "back"
                ? "Upload the back"
                : sampleSide === "front"
                  ? "Upload the front"
                  : "Upload a sample photo")}
          </span>
          <span className={cn("text-xs font-semibold", PROOF_THEME.muted)}>
            Clear JPG or PNG works best
          </span>
        </button>
      ) : (
        <div
          className="relative origin-center shadow-lg"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        >
          <div ref={canvasFrameRef} className="relative inline-block max-h-[32rem] max-w-full">
            <img
              src={imageUrl}
              alt="Sample photo"
              className="block max-h-[32rem] max-w-full select-none rounded-md border border-neutral-200 bg-white object-contain"
              draggable={false}
            />
            {sorted.map((field, index) => {
              const region =
                hintsOf(field).region ?? defaultRegionForIndex(index, sorted.length)
              const displayNumber = fieldDisplayNumber(field, fields)
              const color = fieldDisplayColor(field, fields)
              const selected = selectedFieldKey === field.key
              const crowded = sorted.some((other, otherIndex) => {
                if (other.key === field.key) return false
                const otherRegion =
                  hintsOf(other).region ?? defaultRegionForIndex(otherIndex, sorted.length)
                return regionsOverlapOrClose(region, otherRegion)
              })
              const fillOpacity = selected ? 0.18 : crowded ? 0.04 : 0.08
              const borderOpacity = selected ? 1 : crowded ? 0.45 : 0.85
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
                    "absolute cursor-move rounded border-2 text-left outline-none transition-[box-shadow,opacity]",
                    selected ? "z-20 shadow-[0_0_0_3px_rgba(20,91,231,0.28)]" : "z-10 hover:z-20",
                    regionDrag?.fieldKey === field.key && "z-30",
                    !selected && crowded && "hover:opacity-100",
                  )}
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.w * 100}%`,
                    height: `${region.h * 100}%`,
                    borderColor: color,
                    backgroundColor: `color-mix(in srgb, ${color} ${Math.round(fillOpacity * 100)}%, transparent)`,
                    opacity: selected ? 1 : crowded ? 0.55 : 0.9,
                    borderWidth: selected ? 2.5 : crowded ? 1.5 : 2,
                    boxShadow: selected
                      ? undefined
                      : crowded
                        ? `inset 0 0 0 1px ${color}${Math.round(borderOpacity * 40).toString(16).padStart(2, "0")}`
                        : undefined,
                  }}
                >
                  <span
                    className={cn(
                      "pointer-events-none absolute -left-px max-w-[10rem] truncate rounded px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm",
                      selected || !crowded ? "-top-5" : "-top-4 scale-95",
                    )}
                    style={{
                      backgroundColor: color,
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
                      className="absolute -bottom-1.5 -right-1.5 size-3.5 cursor-se-resize rounded-sm border-2 border-white shadow"
                      style={{ backgroundColor: color }}
                    />
                  ) : null}
                </div>
              )
            })}
            <span className="pointer-events-none absolute bottom-2 right-2 rotate-[-8deg] text-xs font-semibold uppercase tracking-widest text-accent/40">
              {sideLabel(sampleSide)} preview
            </span>
          </div>
        </div>
      )}
    </div>
  )
}