import {
  ChevronDown,
  ChevronUp,
  Check,
  GripVertical,
  Pencil,
  Trash2 as Trash,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, OcrTestField, ProofSide } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import {
  fieldCanvasSide,
  fieldDisplayColor,
  fieldDisplayNumber,
} from "@/features/ocr/lib/create-document-defaults"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "\u2014"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

interface FieldRowProps {
  field: OcrFieldDefinition
  index: number
  list: OcrFieldDefinition[]
  listSide: "front" | "back"
  fields: OcrFieldDefinition[]
  selectedFieldKey: string | null
  editingKey: string | null
  editLabel: string
  dragKey: string | null
  dragOverKey: string | null
  extractedByKey?: Map<string, OcrTestField>
  dualSides: boolean
  onSelectField: (key: string) => void
  onMoveField: (key: string, dir: -1 | 1) => void
  onRemoveField: (key: string) => void
  onUpdateField: (fieldKey: string, updater: (f: OcrFieldDefinition) => OcrFieldDefinition) => void
  onRenameField?: (fieldKey: string, label: string) => void
  onSetEditingKey: (key: string | null) => void
  onSetEditLabel: (label: string) => void
  onSetDragKey: (key: string | null) => void
  onSetDragOverKey: (key: string | null) => void
  onSetDragOverSide: (side: "front" | "back" | null) => void
  onClearDragState: () => void
  onDropOnSide: (fromKey: string | null, listSide: "front" | "back", toIndex: number) => void
  onSetSamplePreviewSide: (s: ProofSide) => void
}

export function FieldRow({
  field,
  index,
  list,
  listSide,
  fields,
  selectedFieldKey,
  editingKey,
  editLabel,
  dragKey,
  dragOverKey,
  extractedByKey,
  dualSides,
  onSelectField,
  onMoveField,
  onRemoveField,
  onUpdateField,
  onRenameField,
  onSetEditingKey,
  onSetEditLabel,
  onSetDragKey,
  onSetDragOverKey,
  onSetDragOverSide,
  onClearDragState,
  onDropOnSide,
  onSetSamplePreviewSide,
}: FieldRowProps) {
  const displayNumber = fieldDisplayNumber(field, fields)
  const color = fieldDisplayColor(field, fields)
  const detected = extractedByKey?.get(field.key)
  const selected = selectedFieldKey === field.key
  const isEditing = editingKey === field.key
  const isDragging = dragKey === field.key
  const isDropTarget = dragOverKey === field.key && dragKey !== field.key
  const fieldSide = fieldCanvasSide(field)

  function startEdit() {
    onSetEditingKey(field.key)
    onSetEditLabel(field.label)
    onSelectField(field.key)
    if (dualSides) onSetSamplePreviewSide(fieldCanvasSide(field))
  }

  function commitEdit() {
    const next = editLabel.trim()
    if (next) {
      if (onRenameField) {
        onRenameField(field.key, next)
      } else {
        onUpdateField(field.key, (f) => ({ ...f, label: next }))
      }
    }
    onSetEditingKey(null)
    onSetEditLabel("")
  }

  return (
    <div
      draggable={!isEditing}
      onDragStart={(e) => {
        onSetDragKey(field.key)
        e.dataTransfer.effectAllowed = "move"
        e.dataTransfer.setData("text/plain", field.key)
        e.dataTransfer.setData("application/x-field-side", fieldSide)
      }}
      onDragEnd={() => {
        onClearDragState()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = "move"
        if (dragKey && dragKey !== field.key) {
          onSetDragOverKey(field.key)
          onSetDragOverSide(listSide)
        }
      }}
      onDragLeave={() => {
        if (dragOverKey === field.key) onSetDragOverKey(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const fromKey = e.dataTransfer.getData("text/plain") || dragKey
        if (!fromKey || fromKey === field.key) {
          onClearDragState()
          return
        }
        const withoutDragged = list.filter((f) => f.key !== fromKey)
        const toIndex = withoutDragged.findIndex((f) => f.key === field.key)
        onDropOnSide(
          fromKey,
          listSide,
          toIndex >= 0 ? toIndex : withoutDragged.length,
        )
      }}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-colors",
        selected
          ? "border-[#145be7] bg-blue-50/80 shadow-sm"
          : "border-[#dfe7f5] bg-[#f8fafc] hover:bg-white",
        isDragging && "opacity-50",
        isDropTarget && "border-[#145be7] ring-2 ring-[#145be7]/25",
      )}
    >
      <span
        className="cursor-grab touch-none text-[#c0cadb] active:cursor-grabbing"
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
                onChange={(e) => onSetEditLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitEdit()
                  }
                  if (e.key === "Escape") {
                    onSetEditingKey(null)
                    onSetEditLabel("")
                  }
                }}
                onBlur={() => commitEdit()}
                className="h-8 font-bold"
                onClick={(e) => e.stopPropagation()}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitEdit()}
                aria-label="Save name"
              >
                <Check className="size-3.5 text-[#145be7]" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full min-w-0 text-left"
              onClick={() => {
                onSelectField(field.key)
                if (dualSides) onSetSamplePreviewSide(fieldCanvasSide(field))
              }}
              onDoubleClick={() => startEdit()}
            >
              <span className={cn("block truncate text-sm font-black", PROOF_THEME.title)}>
                {field.label}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {dualSides ? (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold",
                      fieldSide === "back"
                        ? "bg-violet-50 text-violet-700"
                        : "bg-sky-50 text-sky-700",
                    )}
                  >
                    {fieldSide === "back" ? "Back" : "Front"}
                  </span>
                ) : null}
                {field.required ? (
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-600">
                    Required
                  </span>
                ) : null}
                <span className={cn("text-[11px] font-semibold", PROOF_THEME.muted)}>
                  {asPercent(detected?.confidence ?? field.min_confidence)} quality
                </span>
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
          className="size-7"
          disabled={index === 0}
          title="Move up"
          onClick={() => onMoveField(field.key, -1)}
        >
          <ChevronUp className="size-3.5 text-[#68739c]" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={index >= list.length - 1}
          title="Move down"
          onClick={() => onMoveField(field.key, 1)}
        >
          <ChevronDown className="size-3.5 text-[#68739c]" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="Edit name"
          onClick={() => startEdit()}
        >
          <Pencil className="size-3.5 text-[#68739c]" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="Remove"
          onClick={() => onRemoveField(field.key)}
        >
          <Trash className="size-3.5 text-[#68739c]" />
        </Button>
      </div>
    </div>
  )
}
