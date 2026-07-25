import { MagnifyingGlass as Search } from "@phosphor-icons/react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, OcrTestField, ProofSide } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

import { FieldRow } from "@/features/ocr/components/steps/field-row"

interface FieldListPanelProps {
  fieldSearch: string
  setFieldSearch: (q: string) => void
  fields: OcrFieldDefinition[]
  dualSides: boolean
  frontFields: OcrFieldDefinition[]
  backFields: OcrFieldDefinition[]
  activeSideKey: string
  dragKey: string | null
  dragOverKey: string | null
  dragOverSide: "front" | "back" | null
  editingKey: string | null
  editLabel: string
  selectedFieldKey: string | null
  extractedByKey?: Map<string, OcrTestField>
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

export function FieldListPanel(props: FieldListPanelProps) {
  const {
    fieldSearch,
    setFieldSearch,
    fields,
    dualSides,
    frontFields,
    backFields,
    activeSideKey,
    dragKey,
    dragOverKey,
    dragOverSide,
    editingKey,
    editLabel,
    selectedFieldKey,
    extractedByKey,
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
  } = props

  const fieldRowProps = {
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
  } as const

  function dropOnSide(
    fromKey: string | null,
    listSide: "front" | "back",
    toIndex: number,
  ) {
    if (!fromKey) return
    onDropOnSide(fromKey, listSide, toIndex)
    onClearDragState()
  }

  return (
    <>
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
          placeholder="Search information\u2026"
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
                  ? "bg-sky-50/80 ring-2 ring-[#145be7]/20"
                  : "",
              )}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                onSetDragOverSide("front")
              }}
              onDrop={(e) => {
                e.preventDefault()
                const fromKey = e.dataTransfer.getData("text/plain") || dragKey
                dropOnSide(fromKey, "front", frontFields.length)
              }}
            >
              <p
                className={cn(
                  "text-[11px] font-black uppercase tracking-wide",
                  activeSideKey === "front" ? "text-[#145be7]" : PROOF_THEME.muted,
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
                    "rounded-lg border border-dashed border-[#cbd8ee] px-3 py-4 text-center text-xs font-semibold",
                    PROOF_THEME.muted,
                  )}
                >
                  No front fields yet. Add one, or drag a Back field here.
                </p>
              ) : (
                frontFields.map((field, index) =>
                  <FieldRow
                    key={field.key}
                    {...fieldRowProps}
                    field={field}
                    index={index}
                    list={frontFields}
                    listSide="front"
                  />
                )
              )}
            </div>
            <div
              className={cn(
                "space-y-2 rounded-xl border-t border-[#e8eef8] p-2 pt-3 transition-colors",
                dragOverSide === "back" && dragKey
                  ? "bg-violet-50/80 ring-2 ring-violet-400/25"
                  : "",
              )}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = "move"
                onSetDragOverSide("back")
              }}
              onDrop={(e) => {
                e.preventDefault()
                const fromKey = e.dataTransfer.getData("text/plain") || dragKey
                dropOnSide(fromKey, "back", backFields.length)
              }}
            >
              <p
                className={cn(
                  "text-[11px] font-black uppercase tracking-wide",
                  activeSideKey === "back" ? "text-[#145be7]" : PROOF_THEME.muted,
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
                    "rounded-lg border border-dashed border-[#cbd8ee] px-3 py-4 text-center text-xs font-semibold",
                    PROOF_THEME.muted,
                  )}
                >
                  No back fields yet. Add one, or drag a Front field here.
                </p>
              ) : (
                backFields.map((field, index) =>
                  <FieldRow
                    key={field.key}
                    {...fieldRowProps}
                    field={field}
                    index={index}
                    list={backFields}
                    listSide="back"
                  />
                )
              )}
            </div>
          </>
        ) : (
          <>
            {fields
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((field, index, arr) => (
                <FieldRow
                  key={field.key}
                  {...fieldRowProps}
                  field={field}
                  index={index}
                  list={arr}
                  listSide="front"
                />
              ))}
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
          </>
        )}
      </div>
      <p
        className={cn(
          "mt-3 border-t pt-3 text-[11px] font-semibold",
          PROOF_THEME.border,
          PROOF_THEME.muted,
        )}
      >
        {dualSides
          ? "Drag rows between Front and Back. Mark boxes only on the matching photo."
          : "Click an item to edit it. Use the grip icon to change order."}
      </p>
    </>
  )
}
