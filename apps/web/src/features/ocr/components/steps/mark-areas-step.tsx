import { useRef, type ReactNode, type RefObject } from "react"
import {
  CloudUpload,
  GripVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType, OcrFieldDefinition, OcrTestField, ProofSide } from "@/features/ocr/api"
import { MarkAreasCanvas } from "@/features/ocr/components/mark-areas-canvas"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import { FIELD_COLORS, type FieldRegion } from "@/features/ocr/lib/create-document-defaults"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

function Panel({
  title,
  step,
  description,
  action,
  children,
  className,
}: {
  title: string
  step?: number
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn(PROOF_THEME.card, "flex flex-col", className)}>
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b px-4 py-3.5 md:px-5",
          PROOF_THEME.border,
        )}
      >
        <div className="min-w-0">
          <h2 className={cn("flex items-center gap-2 text-base font-black", PROOF_THEME.title)}>
            {step != null ? (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ backgroundColor: PROOF_THEME.primary }}
              >
                {step}
              </span>
            ) : null}
            {title}
          </h2>
          {description ? (
            <p className={cn("mt-1 text-xs font-semibold leading-5", PROOF_THEME.body)}>
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">{children}</div>
    </section>
  )
}

export function MarkAreasStep(props: {
  document: OcrDocumentType
  fields: OcrFieldDefinition[]
  fieldSearch: string
  setFieldSearch: (q: string) => void
  samplePreviewBySide: Partial<Record<ProofSide, string>>
  samplePreviewSide: ProofSide
  setSamplePreviewSide: (s: ProofSide) => void
  canvasSides: ProofSide[]
  selectedFieldKey: string
  onSelectField: (key: string) => void
  onAddField: () => void
  onRemoveField: (key: string) => void
  onMoveField: (key: string, dir: -1 | 1) => void
  onUploadSample: (file: File, side: ProofSide) => void
  onRemoveSample: (side: ProofSide) => void
  onSetFieldRegion: (fieldKey: string, region: FieldRegion) => void
  saving: boolean
  zoom: number
  setZoom: (updater: number | ((z: number) => number)) => void
  canvasSource: string | null
  extractedByKey?: Map<string, OcrTestField>
  sampleInputRef?: RefObject<HTMLInputElement | null>
  sampleUploadSideRef?: RefObject<ProofSide>
}) {
  const {
    fields,
    fieldSearch,
    setFieldSearch,
    samplePreviewBySide,
    samplePreviewSide,
    setSamplePreviewSide,
    canvasSides,
    selectedFieldKey,
    onSelectField,
    onAddField,
    onRemoveField,
    onMoveField,
    onUploadSample,
    onRemoveSample,
    onSetFieldRegion,
    saving,
    zoom,
    setZoom,
    canvasSource,
    extractedByKey,
    sampleInputRef: externalSampleInputRef,
    sampleUploadSideRef: externalUploadSideRef,
  } = props

  const localSampleInputRef = useRef<HTMLInputElement>(null)
  const localUploadSideRef = useRef<ProofSide>("single")
  const sampleInputRef = externalSampleInputRef ?? localSampleInputRef
  const sampleUploadSideRef = externalUploadSideRef ?? localUploadSideRef

  const selectedField = fields.find((f) => f.key === selectedFieldKey) ?? fields[0] ?? null

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.45fr)]">
      <Panel
        step={1}
        title="Information to read"
        description="List what the system should look for on this proof (name, address, ID number, and so on)."
        className="min-h-[28rem]"
        action={
          <Button
            size="sm"
            className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
            onClick={onAddField}
          >
            <Plus className="size-4" />
            Add
          </Button>
        }
      >
        <div className="relative mb-3">
          <Search
            className={cn(
              "pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2",
              PROOF_THEME.muted,
            )}
          />
          <Input
            value={fieldSearch}
            onChange={(event) => setFieldSearch(event.target.value)}
            placeholder="Search information…"
            className="h-10 pl-8 font-semibold"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {fields.map((field, index) => {
            const color = FIELD_COLORS[index % FIELD_COLORS.length]
            const detected = extractedByKey?.get(field.key)
            const selected = selectedField?.key === field.key
            return (
              <div
                key={field.key}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-colors",
                  selected
                    ? "border-[#145be7] bg-blue-50/80 shadow-sm"
                    : "border-[#dfe7f5] bg-[#f8fafc] hover:bg-white",
                )}
              >
                <button
                  type="button"
                  className="text-[#c0cadb]"
                  title="Reorder"
                  onClick={() => onMoveField(field.key, -1)}
                >
                  <GripVertical className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => onSelectField(field.key)}
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                    style={{ backgroundColor: color }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-black", PROOF_THEME.title)}>
                      {field.label}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {field.required ? (
                        <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                          Required
                        </span>
                      ) : null}
                      <span className={cn("text-[11px] font-semibold", PROOF_THEME.muted)}>
                        {asPercent(detected?.confidence ?? field.min_confidence)} quality
                      </span>
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => onSelectField(field.key)}
                >
                  <Pencil className="size-3.5 text-[#68739c]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => onRemoveField(field.key)}
                >
                  <Trash2 className="size-3.5 text-[#68739c]" />
                </Button>
              </div>
            )
          })}
          {fields.length === 0 ? (
            <p
              className={cn(
                "rounded-xl border border-dashed border-[#cbd8ee] px-3 py-10 text-center text-sm font-semibold",
                PROOF_THEME.muted,
              )}
            >
              No information listed yet. Add items such as Full name or Address.
            </p>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-3 border-t pt-3 text-[11px] font-semibold",
            PROOF_THEME.border,
            PROOF_THEME.muted,
          )}
        >
          Click an item to edit it. Use the grip icon to change order.
        </p>
      </Panel>

      <Panel
        step={2}
        title="Mark areas on the photo"
        description="Upload a clear sample, then drag colored boxes over the text the system should read."
        className="min-h-[28rem]"
        action={
          <div className="flex flex-wrap gap-1.5">
            <input
              ref={sampleInputRef}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) onUploadSample(file, sampleUploadSideRef.current ?? samplePreviewSide)
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="bg-white" onClick={() => setZoom(1)}>
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        }
      >
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
                      <CloudUpload className="size-3.5" />
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
                        <Trash2 className="size-3.5" />
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
              Front and back are saved separately. Click a side to mark boxes on that photo.
            </p>
          ) : null}
        </div>

        <MarkAreasCanvas
          imageUrl={canvasSource}
          fields={fields}
          selectedFieldKey={selectedField?.key ?? selectedFieldKey}
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
      </Panel>
    </section>
  )
}
