import { useRef, useState, type ReactNode, type RefObject } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
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

import type { OcrDocumentType, OcrFieldDefinition, ProofSide } from "@/features/ocr/api"
import { MarkAreasCanvas } from "@/features/ocr/components/mark-areas-canvas"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import {
  fieldCanvasSide,
  fieldDisplayColor,
  fieldDisplayNumber,
  type FieldRegion,
} from "@/features/ocr/lib/create-document-defaults"

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
          <h2 className={cn("flex items-center gap-2 text-base font-semibold", PROOF_THEME.title)}>
            {step != null ? (
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
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
  onReorderField: (
    key: string,
    toIndex: number,
    targetSide?: "front" | "back",
  ) => void
  onUpdateField: (
    fieldKey: string,
    updater: (f: OcrFieldDefinition) => OcrFieldDefinition,
  ) => void
  /** Rename label (+ refresh auto key to a readable slug when applicable). */
  onRenameField?: (fieldKey: string, label: string) => void
  onUploadSample: (file: File, side: ProofSide) => void
  onRemoveSample: (side: ProofSide) => void
  onSetFieldRegion: (fieldKey: string, region: FieldRegion) => void
  saving: boolean
  zoom: number
  setZoom: (updater: number | ((z: number) => number)) => void
  canvasSource: string | null
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
    onReorderField,
    onUpdateField,
    onRenameField,
    onUploadSample,
    onRemoveSample,
    onSetFieldRegion,
    saving,
    zoom,
    setZoom,
    canvasSource,
    sampleInputRef: externalSampleInputRef,
    sampleUploadSideRef: externalUploadSideRef,
  } = props

  const localSampleInputRef = useRef<HTMLInputElement>(null)
  const localUploadSideRef = useRef<ProofSide>("single")
  const sampleInputRef = externalSampleInputRef ?? localSampleInputRef
  const sampleUploadSideRef = externalUploadSideRef ?? localUploadSideRef

  const dualSides = canvasSides.includes("front") && canvasSides.includes("back")
  const activeSideKey = samplePreviewSide === "back" ? "back" : "front"
  const fieldsForActiveSide = fields.filter((f) => fieldCanvasSide(f) === activeSideKey)
  const selectedField =
    fields.find((f) => f.key === selectedFieldKey) ?? fieldsForActiveSide[0] ?? fields[0] ?? null

  const frontFields = fields
    .filter((f) => fieldCanvasSide(f) === "front")
    .sort((a, b) => a.order - b.order)
  const backFields = fields
    .filter((f) => fieldCanvasSide(f) === "back")
    .sort((a, b) => a.order - b.order)

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState("")
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [dragOverSide, setDragOverSide] = useState<"front" | "back" | null>(null)

  function startEdit(field: OcrFieldDefinition) {
    setEditingKey(field.key)
    setEditLabel(field.label)
    onSelectField(field.key)
    if (dualSides) setSamplePreviewSide(fieldCanvasSide(field))
  }

  function commitEdit(fieldKey: string) {
    const next = editLabel.trim()
    if (next) {
      // Prefer renameField when provided so machine keys become readable slugs.
      if (onRenameField) {
        onRenameField(fieldKey, next)
      } else {
        onUpdateField(fieldKey, (f) => ({ ...f, label: next }))
      }
    }
    setEditingKey(null)
    setEditLabel("")
  }

  function clearDragState() {
    setDragKey(null)
    setDragOverKey(null)
    setDragOverSide(null)
  }

  function dropOnSide(
    fromKey: string | null,
    listSide: "front" | "back",
    toIndex: number,
  ) {
    if (!fromKey) return
    onReorderField(fromKey, toIndex, dualSides ? listSide : undefined)
    clearDragState()
  }

  function renderFieldRow(
    field: OcrFieldDefinition,
    index: number,
    list: OcrFieldDefinition[],
    listSide: "front" | "back" = "front",
  ) {
    // Stable number/color across Front + Back (not re-numbered per side).
    const displayNumber = fieldDisplayNumber(field, fields)
    const color = fieldDisplayColor(field, fields)
    const selected = selectedField?.key === field.key
    const isEditing = editingKey === field.key
    const isDragging = dragKey === field.key
    const isDropTarget = dragOverKey === field.key && dragKey !== field.key
    const fieldSide = fieldCanvasSide(field)

    return (
      <div
        key={field.key}
        draggable={!isEditing}
        onDragStart={(e) => {
          setDragKey(field.key)
          e.dataTransfer.effectAllowed = "move"
          e.dataTransfer.setData("text/plain", field.key)
          e.dataTransfer.setData("application/x-field-side", fieldSide)
        }}
        onDragEnd={() => {
          clearDragState()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = "move"
          if (dragKey && dragKey !== field.key) {
            setDragOverKey(field.key)
            setDragOverSide(listSide)
          }
        }}
        onDragLeave={() => {
          if (dragOverKey === field.key) setDragOverKey(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const fromKey = e.dataTransfer.getData("text/plain") || dragKey
          if (!fromKey || fromKey === field.key) {
            clearDragState()
            return
          }
          // Insert before this row in the destination list (works across front ↔ back).
          const withoutDragged = list.filter((f) => f.key !== fromKey)
          const toIndex = withoutDragged.findIndex((f) => f.key === field.key)
          dropOnSide(
            fromKey,
            listSide,
            toIndex >= 0 ? toIndex : withoutDragged.length,
          )
        }}
        className={cn(
          "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-colors",
          selected
            ? "border-brand-blue bg-tint/80 shadow-sm"
            : "border-line-tint bg-canvas hover:bg-white",
          isDragging && "opacity-50",
          isDropTarget && "border-brand-blue ring-2 ring-brand-blue/25",
        )}
      >
        <span
          className="cursor-grab touch-none text-line-tint active:cursor-grabbing"
          title={
            dualSides
              ? "Drag to reorder or move between Front and Back"
              : "Drag to reorder"
          }
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-4" />
        </span>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
            style={{ backgroundColor: color }}
          >
            {displayNumber}
          </span>
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      commitEdit(field.key)
                    }
                    if (e.key === "Escape") {
                      setEditingKey(null)
                      setEditLabel("")
                    }
                  }}
                  onBlur={() => commitEdit(field.key)}
                  className="h-8 font-bold"
                  onClick={(e) => e.stopPropagation()}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 hover:bg-tint"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitEdit(field.key)}
                  aria-label="Save name"
                >
                  <Check className="size-3.5 text-brand-blue" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="w-full min-w-0 text-left"
                onClick={() => {
                  onSelectField(field.key)
                  if (dualSides) setSamplePreviewSide(fieldCanvasSide(field))
                }}
                onDoubleClick={() => startEdit(field)}
              >
                <span className={cn("block truncate text-sm font-semibold", PROOF_THEME.title)}>
                  {field.label}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  {dualSides ? (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold",
                        fieldSide === "back"
                          ? "bg-neutral-100 text-foreground"
                          : "bg-neutral-100 text-neutral-500",
                      )}
                    >
                      {fieldSide === "back" ? "Back" : "Front"}
                    </span>
                  ) : null}
                  {field.required ? (
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-sos">
                      Required
                    </span>
                  ) : null}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 hover:bg-tint"
            disabled={index === 0}
            title="Move up"
            onClick={() => onMoveField(field.key, -1)}
          >
            <ChevronUp className="size-3.5 text-subtle-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 hover:bg-tint"
            disabled={index >= list.length - 1}
            title="Move down"
            onClick={() => onMoveField(field.key, 1)}
          >
            <ChevronDown className="size-3.5 text-subtle-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 hover:bg-tint"
            title="Edit name"
            onClick={() => startEdit(field)}
          >
            <Pencil className="size-3.5 text-subtle-foreground" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 hover:bg-neutral-100"
            title="Remove"
            onClick={() => onRemoveField(field.key)}
          >
            <Trash2 className="size-3.5 text-subtle-foreground" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.45fr)]">
      <Panel
        step={1}
        title="Information to read"
        description={
          dualSides
            ? "Add fields for Front and Back separately. Switching sample photo filters the list and boxes."
            : "List what the system should look for on this proof (name, address, ID number, and so on)."
        }
        className="min-h-[28rem]"
        action={
          <Button
            size="sm"
            className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
            onClick={onAddField}
          >
            <Plus className="size-4" />
            Add to {activeSideKey === "back" ? "Back" : "Front"}
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
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {dualSides ? (
            <>
              <div
                className={cn(
                  "space-y-2 rounded-xl p-2 transition-colors",
                  dragOverSide === "front" && dragKey
                    ? "bg-neutral-100/80 ring-2 ring-brand-blue/20"
                    : "",
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOverSide("front")
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const fromKey = e.dataTransfer.getData("text/plain") || dragKey
                  dropOnSide(fromKey, "front", frontFields.length)
                }}
              >
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    activeSideKey === "front" ? PROOF_THEME.accent : PROOF_THEME.muted,
                  )}
                >
                  Front fields
                  <span className={cn("ml-1.5 font-semibold normal-case", PROOF_THEME.muted)}>
                    (drop here)
                  </span>
                </p>
                {frontFields.length === 0 ? (
                  <p
                    className={cn(
                      "rounded-lg border border-dashed border-line-tint px-3 py-4 text-center text-xs font-semibold",
                      PROOF_THEME.muted,
                    )}
                  >
                    No front fields yet. Add one, or drag a Back field here.
                  </p>
                ) : (
                  frontFields.map((field, index) =>
                    renderFieldRow(field, index, frontFields, "front"),
                  )
                )}
              </div>
              <div
                className={cn(
                  "space-y-2 rounded-xl border-t border-line-tint p-2 pt-3 transition-colors",
                  dragOverSide === "back" && dragKey
                    ? "bg-neutral-100/80 ring-2 ring-neutral-300"
                    : "",
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  setDragOverSide("back")
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const fromKey = e.dataTransfer.getData("text/plain") || dragKey
                  dropOnSide(fromKey, "back", backFields.length)
                }}
              >
                <p
                  className={cn(
                    "text-[11px] font-semibold uppercase tracking-wide",
                    activeSideKey === "back" ? PROOF_THEME.accent : PROOF_THEME.muted,
                  )}
                >
                  Back fields
                  <span className={cn("ml-1.5 font-semibold normal-case", PROOF_THEME.muted)}>
                    (drop here)
                  </span>
                </p>
                {backFields.length === 0 ? (
                  <p
                    className={cn(
                      "rounded-lg border border-dashed border-line-tint px-3 py-4 text-center text-xs font-semibold",
                      PROOF_THEME.muted,
                    )}
                  >
                    No back fields yet. Add one, or drag a Front field here.
                  </p>
                ) : (
                  backFields.map((field, index) =>
                    renderFieldRow(field, index, backFields, "back"),
                  )
                )}
              </div>
            </>
          ) : (
            <>
              {fields
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((field, index, arr) => renderFieldRow(field, index, arr, "front"))}
              {fields.length === 0 ? (
                <p
                  className={cn(
                    "rounded-xl border border-dashed border-line-tint px-3 py-10 text-center text-sm font-semibold",
                    PROOF_THEME.muted,
                  )}
                >
                  No information listed yet. Add items such as Full name or Address.
                </p>
              ) : null}
            </>
          )}
        </div>
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
              className="bg-white hover:bg-tint hover:text-brand-blue"
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            >
              <ZoomIn className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white hover:bg-tint hover:text-brand-blue"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            >
              <ZoomOut className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-white hover:bg-tint hover:text-brand-blue"
              onClick={() => setZoom(1)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        }
      >
        <div className="mb-4">
          <p className={cn("mb-2 text-xs font-semibold", PROOF_THEME.title)}>Sample photos</p>
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
                      ? "border-brand-blue bg-tint/50 ring-1 ring-brand-blue/25"
                      : "border-line-tint bg-white",
                  )}
                >
                  <button
                    type="button"
                    className={cn("mb-2 text-left text-xs font-semibold", PROOF_THEME.title)}
                    onClick={() => setSamplePreviewSide(side)}
                  >
                    {label}
                    {hasImage ? (
                      <span className="ml-1.5 rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                        Ready
                      </span>
                    ) : (
                      <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                        Needed
                      </span>
                    )}
                  </button>
                  {hasImage ? (
                    <button
                      type="button"
                      className="mb-2 block w-full overflow-hidden rounded-lg border border-line-tint bg-canvas"
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
                      className="h-8 text-xs font-bold hover:bg-tint hover:text-brand-blue"
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
                        className="h-8 text-xs font-bold text-destructive hover:bg-neutral-100 hover:text-destructive"
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
              Front and back are required and saved separately. Upload both, then click a side
              to mark boxes on that photo.
            </p>
          ) : (
            <p className={cn("mt-2 text-[11px] font-semibold", PROOF_THEME.muted)}>
              A sample photo is required before you can continue to Rules.
            </p>
          )}
          {canvasSides.some((side) => !samplePreviewBySide[side]) ? (
            <p className="mt-2 rounded-lg border border-neutral-200 bg-neutral-100 px-2.5 py-2 text-[11px] font-semibold text-foreground">
              Still needed:{" "}
              {canvasSides
                .filter((side) => {
                  if (samplePreviewBySide[side]) return false
                  if (side === "front" && samplePreviewBySide.single) return false
                  if (side === "single" && samplePreviewBySide.front) return false
                  return true
                })
                .map((side) =>
                  side === "front" ? "Front" : side === "back" ? "Back" : "Sample photo",
                )
                .join(" and ")}
              .
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
      </Panel>
    </section>
  )
}