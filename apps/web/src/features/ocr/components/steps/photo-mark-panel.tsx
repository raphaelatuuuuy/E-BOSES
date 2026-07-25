import { type RefObject } from "react"
import {
  CloudArrowUp,
  Trash,
} from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, ProofSide } from "@/features/ocr/api"
import { MarkAreasCanvas } from "@/features/ocr/components/mark-areas-canvas"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import type { FieldRegion } from "@/features/ocr/lib/create-document-defaults"

interface PhotoMarkPanelProps {
  sampleInputRef: RefObject<HTMLInputElement | null>
  sampleUploadSideRef: RefObject<ProofSide>
  saving: boolean
  zoom: number
  canvasSides: ProofSide[]
  samplePreviewBySide: Partial<Record<ProofSide, string>>
  samplePreviewSide: ProofSide
  setSamplePreviewSide: (s: ProofSide) => void
  canvasSource: string | null
  selectedFieldKey: string
  fields: OcrFieldDefinition[]
  onRemoveSample: (side: ProofSide) => void
  onSelectField: (key: string) => void
  onSetFieldRegion: (fieldKey: string, region: FieldRegion) => void
}

export function PhotoMarkPanel({
  sampleInputRef,
  sampleUploadSideRef,
  saving,
  zoom,
  canvasSides,
  samplePreviewBySide,
  samplePreviewSide,
  setSamplePreviewSide,
  canvasSource,
  selectedFieldKey,
  fields,
  onRemoveSample,
  onSelectField,
  onSetFieldRegion,
}: PhotoMarkPanelProps) {
  return (
    <>
      <div className="mb-4">
        <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>Sample photos</p>
        <div className={cn("grid gap-2", canvasSides.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
          {canvasSides.map((side) => {
            const label =
              side === "front" ? "Front" : side === "back" ? "Back" : "Sample photo"
            const hasImage = Boolean(samplePreviewBySide[side])
            const active = samplePreviewSide === side
            return (
              <div
                key={side}
                className={cn(
                  "rounded-xl border p-2.5 transition",
                  active
                    ? "border-[#145be7] bg-blue-50/50 ring-1 ring-[#145be7]/25"
                    : "border-[#dfe7f5] bg-white",
                )}
              >
                <button
                  type="button"
                  className={cn("mb-2 text-left text-xs font-black", PROOF_THEME.title)}
                  onClick={() => setSamplePreviewSide(side)}
                >
                  {label}
                  {hasImage ? (
                    <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                      Ready
                    </span>
                  ) : (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                      Needed
                    </span>
                  )}
                </button>
                {hasImage ? (
                  <button
                    type="button"
                    className="mb-2 block w-full overflow-hidden rounded-lg border border-[#dfe7f5] bg-[#f8faff]"
                    onClick={() => setSamplePreviewSide(side)}
                  >
                    <img
                      src={samplePreviewBySide[side]}
                      alt={label}
                      className="mx-auto max-h-24 object-contain"
                    />
                  </button>
                ) : (
                  <p className={cn("mb-2 text-[11px] font-semibold", PROOF_THEME.muted)}>
                    No {side === "single" ? "sample" : side} photo yet.
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-bold"
                    disabled={saving}
                    onClick={() => {
                      sampleUploadSideRef.current = side
                      setSamplePreviewSide(side)
                      sampleInputRef.current?.click()
                    }}
                  >
                    <CloudArrowUp className="size-3.5" />
                    {hasImage ? "Replace" : "Upload"}
                  </Button>
                  {hasImage ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs font-bold text-destructive hover:text-destructive"
                      disabled={saving}
                      onClick={() => onRemoveSample(side)}
                    >
                      <Trash className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
        {canvasSides.length > 1 ? (
          <p className={cn("mt-2 text-[11px] font-semibold", PROOF_THEME.muted)}>
            Front and back are required and saved separately. Upload both, then click a side
            to mark boxes on that photo.
          </p>
        ) : (
          <p className={cn("mt-2 text-[11px] font-semibold", PROOF_THEME.muted)}>
            A sample photo is required before you can continue to Rules.
          </p>
        )}
        {canvasSides.some((side) => !samplePreviewBySide[side]) ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-900">
            Still needed:{" "}
            {canvasSides
              .flatMap((side) => {
                if (samplePreviewBySide[side]) return []
                if (side === "front" && samplePreviewBySide.single) return []
                if (side === "single" && samplePreviewBySide.front) return []
                return [side === "front" ? "Front" : side === "back" ? "Back" : "Sample photo"]
              })
              .join(" and ")}
            .
          </p>
        ) : null}
      </div>

      <MarkAreasCanvas
        imageUrl={canvasSource}
        fields={fields}
        selectedFieldKey={selectedFieldKey}
        zoom={zoom}
        sampleSide={samplePreviewSide}
        onSelectField={onSelectField}
        onSetFieldRegion={onSetFieldRegion}
        onRequestUpload={() => {
          sampleUploadSideRef.current = samplePreviewSide
          sampleInputRef.current?.click()
        }}
      />
      <p
        className={cn(
          "mt-3 border-t pt-3 text-[11px] font-semibold",
          PROOF_THEME.border,
          PROOF_THEME.muted,
        )}
      >
        Select an item from the list or a box on the photo. Drag the box to move it; use the
        corner to resize. Changes go live when you upload a sample, try a photo, or toggle
        availability.
      </p>
    </>
  )
}
