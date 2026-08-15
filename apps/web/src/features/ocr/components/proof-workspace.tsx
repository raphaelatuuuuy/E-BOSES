import { useRef, useState, type ReactNode } from "react"
import { ImageIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type {
  OcrDocumentType,
  OcrFieldDefinition,
  ProofSide,
} from "@/features/ocr/api"
import { MarkAreasCanvas } from "@/features/ocr/components/mark-areas-canvas"
import {
  fieldDisplayColor,
  type FieldRegion,
} from "@/features/ocr/lib/create-document-defaults"

/**
 * Setting up one document, on one screen.
 *
 * Everything lives in two panes and nothing stacks below them. The photo is the
 * subject, so it holds the stage; the document's own fields and its details sit
 * in the inspector beside it. Testing is a mode of the stage rather than a
 * section further down the page — you are still looking at the same document,
 * so you should not have to leave it.
 *
 * What this replaced: four steps that each rebuilt the same idea. A list of
 * details, a second panel showing those details as boxes, a third place that
 * opened with a dropdown to re-pick the detail you had already selected, a
 * preview repeating the name you typed two fields above, and the need for a
 * sample photo stated three separate times.
 */

const inputClass =
  "mt-1.5 w-full border-0 border-b border-neutral-200 bg-transparent pb-2 text-read text-brand-navy outline-none transition-colors placeholder:text-neutral-400 focus:border-accent"

function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-meta text-neutral-500">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-meta text-neutral-400">{hint}</span>
      ) : null}
    </label>
  )
}

/** Two options do not need two paragraphs of explanation each. */
function SidesChoice({
  needsBoth,
  onChange,
}: {
  needsBoth: boolean
  onChange: (mode: "one" | "both") => void
}) {
  return (
    <div>
      <span className="block text-meta text-neutral-500">
        Photos the resident takes
      </span>
      <div className="mt-2 inline-flex rounded-full bg-neutral-100 p-1">
        {[
          { key: "one" as const, label: "Front only", active: !needsBoth },
          { key: "both" as const, label: "Front and back", active: needsBoth },
        ].map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-meta transition-colors",
              option.active
                ? "bg-white font-medium text-brand-navy shadow-sm"
                : "text-neutral-500 hover:text-brand-navy"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProofWorkspace({
  document,
  fields,
  selectedField,
  canvasSides,
  sampleSide,
  onSampleSideChange,
  sampleUrl,
  zoom,
  onSelectField,
  onAddField,
  onRemoveField,
  onRenameField,
  onSetFieldRegion,
  onUploadSample,
  onChangeDocument,
  onBlurSave,
  onChangeCaptureMode,
  checksFor,
  testPanel,
  tested,
  availableOnSignup,
  onAvailabilityChange,
  availabilityHint,
  saving,
}: {
  document: OcrDocumentType
  fields: OcrFieldDefinition[]
  selectedField: OcrFieldDefinition | null
  canvasSides: ProofSide[]
  sampleSide: ProofSide
  onSampleSideChange: (side: ProofSide) => void
  sampleUrl: string | null
  zoom: number
  onSelectField: (key: string) => void
  onAddField: () => void
  onRemoveField: (key: string) => void
  onRenameField: (key: string, label: string) => void
  onSetFieldRegion: (key: string, region: FieldRegion) => void
  onUploadSample: (file: File, side: ProofSide) => void
  onChangeDocument: (patch: Partial<OcrDocumentType>) => void
  onBlurSave: () => void
  onChangeCaptureMode: (mode: "one" | "both") => void
  /** The selected detail's checks, rendered under that detail. */
  checksFor: ReactNode
  /** The test runner, rendered on the stage rather than below it. */
  testPanel: ReactNode
  tested: boolean
  availableOnSignup: boolean
  onAvailabilityChange: (next: boolean) => void
  availabilityHint: string
  saving: boolean
}) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const [uploadSide, setUploadSide] = useState<ProofSide>("front")
  const [mode, setMode] = useState<"mark" | "test">("mark")
  const [pane, setPane] = useState<"setup" | "photo">("setup")
  const needsBoth = canvasSides.length > 1

  const sideFields = fields.filter((field) => {
    const side = field.extraction_hints?.side ?? "front"
    return needsBoth ? side === sampleSide : true
  })
  const markedCount = sideFields.filter(
    (field) => field.extraction_hints?.region
  ).length

  function requestUpload(side: ProofSide) {
    setUploadSide(side)
    uploadRef.current?.click()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[420px_minmax(0,1fr)]">
      {/* Phones get one pane at a time; there is not room for two. */}
      <div className="flex shrink-0 items-center gap-6 border-b border-neutral-200 px-5 py-3 lg:hidden">
        {(
          [
            { key: "setup" as const, label: "Setup" },
            { key: "photo" as const, label: "Photo" },
          ]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setPane(tab.key)}
            className={cn(
              "text-read transition-colors",
              pane === tab.key
                ? "font-medium text-brand-navy"
                : "text-neutral-400 hover:text-brand-navy",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUploadSample(file, uploadSide)
          event.target.value = ""
        }}
      />

      {/* Inspector — the only thing that scrolls on a desktop. */}
      <div
        className={cn(
          "min-h-0 flex-1 flex-col border-neutral-200 lg:flex lg:border-r",
          pane === "setup" ? "flex" : "hidden",
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 sm:py-7">
          <div className="space-y-6">
            <Labelled label="Name">
              <input
                value={document.template_name || document.name || ""}
                onChange={(event) =>
                  onChangeDocument({ template_name: event.target.value })
                }
                onBlur={onBlurSave}
                placeholder="Barangay ID"
                className={inputClass}
              />
            </Labelled>
            <Labelled
              label="Description"
              hint="Shown under the name when a resident picks it."
            >
              <input
                value={document.description ?? ""}
                onChange={(event) =>
                  onChangeDocument({ description: event.target.value })
                }
                onBlur={onBlurSave}
                placeholder="Barangay-issued resident identification card"
                className={inputClass}
              />
            </Labelled>
            <SidesChoice needsBoth={needsBoth} onChange={onChangeCaptureMode} />
          </div>

          <div className="mt-8 border-t border-neutral-200 pt-7">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-row font-medium text-brand-navy">
                Details to read
              </h3>
              <button
                type="button"
                onClick={onAddField}
                disabled={saving}
                className="inline-flex shrink-0 items-center gap-1.5 text-meta text-neutral-500 transition-colors hover:text-accent disabled:text-neutral-300"
              >
                <PlusIcon className="size-4" strokeWidth={2} aria-hidden />
                Add
              </button>
            </div>

            {sideFields.length === 0 ? (
              <p className="mt-5 text-meta text-neutral-400">
                Nothing yet. Add the first detail the system should read.
              </p>
            ) : (
              <ul className="mt-3">
                {sideFields.map((field) => {
                  const active = selectedField?.key === field.key
                  return (
                    <li
                      key={field.key}
                      className="border-b border-neutral-200 last:border-b-0"
                    >
                      <div className="flex items-center gap-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => onSelectField(field.key)}
                          aria-label={`Select ${field.label}`}
                          className="size-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: fieldDisplayColor(field, fields),
                          }}
                        />
                        {/* Renamed where the name is shown. This used to be a
                            separate "Label" input inside the checks panel. */}
                        <input
                          value={field.label}
                          onChange={(event) =>
                            onRenameField(field.key, event.target.value)
                          }
                          onFocus={() => onSelectField(field.key)}
                          onBlur={onBlurSave}
                          className="min-w-0 flex-1 bg-transparent text-read text-brand-navy outline-none"
                        />
                        {!field.extraction_hints?.region ? (
                          <span className="shrink-0 text-meta text-neutral-400">
                            Not marked
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onRemoveField(field.key)}
                          disabled={saving}
                          aria-label={`Remove ${field.label}`}
                          className="flex size-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-sos"
                        >
                          <Trash2Icon
                            className="size-4"
                            strokeWidth={1.8}
                            aria-hidden
                          />
                        </button>
                      </div>

                      {active ? <div className="pb-5">{checksFor}</div> : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Going live is the last decision, so it sits at the foot of the
            inspector rather than as its own section below everything. */}
        <label className="flex shrink-0 items-start gap-3 border-t border-neutral-200 px-5 py-5 sm:px-8">
          <input
            type="checkbox"
            checked={availableOnSignup}
            onChange={(event) => onAvailabilityChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span className="min-w-0">
            <span className="block text-read text-brand-navy">
              Offer this on sign-up
            </span>
            <span className="mt-0.5 block text-meta text-neutral-500">
              {availabilityHint}
            </span>
          </span>
        </label>
      </div>

      {/* Stage */}
      <div
        className={cn(
          "min-h-0 flex-1 flex-col bg-neutral-50 lg:flex",
          pane === "photo" ? "flex" : "hidden",
        )}
      >
        <div className="flex shrink-0 items-center gap-6 border-b border-neutral-200 px-5 py-3 sm:px-8">
          {[
            { key: "mark" as const, label: "Mark the photo" },
            { key: "test" as const, label: tested ? "Test · done" : "Test" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              className={cn(
                "text-meta transition-colors",
                mode === tab.key
                  ? "font-medium text-brand-navy"
                  : "text-neutral-400 hover:text-brand-navy"
              )}
            >
              {tab.label}
            </button>
          ))}

          {mode === "mark" && needsBoth ? (
            <span className="ml-auto flex items-center gap-4">
              {canvasSides.map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => onSampleSideChange(side)}
                  className={cn(
                    "text-meta capitalize transition-colors",
                    sampleSide === side
                      ? "font-medium text-brand-navy"
                      : "text-neutral-400 hover:text-brand-navy"
                  )}
                >
                  {side}
                </button>
              ))}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5 sm:p-8">
          {mode === "test" ? (
            testPanel
          ) : sampleUrl ? (
            <MarkAreasCanvas
              imageUrl={sampleUrl}
              fields={fields}
              selectedFieldKey={selectedField?.key ?? null}
              zoom={zoom}
              sampleSide={sampleSide}
              onSelectField={onSelectField}
              onSetFieldRegion={onSetFieldRegion}
              onRequestUpload={() => requestUpload(sampleSide)}
            />
          ) : (
            /* One statement of what is needed. This was said in three places:
               a "Sample photos" panel, a warning under it, and a dropzone. */
            <button
              type="button"
              onClick={() => requestUpload(sampleSide)}
              className="flex h-full min-h-[300px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-neutral-300 text-center transition-colors hover:border-accent"
            >
              <ImageIcon
                className="size-8 text-neutral-400"
                strokeWidth={1.5}
                aria-hidden
              />
              <span className="text-row text-brand-navy">
                Add a sample photo
              </span>
              <span className="max-w-xs text-meta text-neutral-500">
                A clear JPG or PNG of the {needsBoth ? sampleSide : "document"}.
                You draw the boxes on top of it.
              </span>
            </button>
          )}
        </div>

        {mode === "mark" && sampleUrl ? (
          <div className="flex shrink-0 items-center justify-between gap-4 border-t border-neutral-200 px-5 py-3 sm:px-8">
            <p className="text-meta text-neutral-500 tabular-nums">
              {markedCount} of {sideFields.length} marked
            </p>
            <button
              type="button"
              onClick={() => requestUpload(sampleSide)}
              className="text-meta text-neutral-500 transition-colors hover:text-accent"
            >
              Replace photo
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
