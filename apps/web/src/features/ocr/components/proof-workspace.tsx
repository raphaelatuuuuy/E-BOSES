import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheck,
  CreditCard,
  IdCard,
  ImageUp,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type {
  OcrDocumentType,
  OcrFieldDefinition,
  ProofSide,
} from "@/features/ocr/api"
import { MarkAreasCanvas } from "@/features/ocr/components/mark-areas-canvas"
import {
  fieldCanvasSide,
  type FieldRegion,
} from "@/features/ocr/lib/create-document-defaults"
import type {
  ProfileMatchKey,
  TestSlot,
} from "@/features/ocr/hooks/use-ocr-template-state"
import {
  SheetDialog,
  SheetPrimaryButton,
  SheetToggleRow,
} from "@/features/dashboard/components/sheet-dialog"

const MATCH_OPTIONS: ReadonlyArray<readonly [ProfileMatchKey, string]> = [
  ["first_name", "First name"],
  ["middle_name", "Middle name"],
  ["last_name", "Last name"],
  ["date_of_birth", "Date of birth"],
  ["address", "Address"],
] as const

/** The same dropdown the units page uses: a field-looking trigger that opens
 *  a bordered list, selected rows carrying a green check. */
function MatchProfileDropdown({
  value,
  options,
  onChange,
}: {
  value: ProfileMatchKey[]
  options: ReadonlyArray<readonly [ProfileMatchKey, string]>
  onChange: (next: ProfileMatchKey[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const selectedLabels = options
    .filter(([key]) => value.includes(key))
    .map(([, label]) => label)

  function toggle(key: ProfileMatchKey) {
    onChange(
      value.includes(key)
        ? value.filter((item) => item !== key)
        : [...value, key]
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 transition-colors outline-none hover:border-neutral-400"
      >
        <span className="flex-1 truncate font-medium">
          {selectedLabels.length > 0
            ? selectedLabels.join(", ")
            : "Nothing matches yet"}
        </span>
        {open ? (
          <ChevronUpIcon
            className="size-4 shrink-0 text-neutral-400"
            aria-hidden
          />
        ) : (
          <ChevronDownIcon
            className="size-4 shrink-0 text-neutral-400"
            aria-hidden
          />
        )}
      </button>
      {open ? (
        <div
          className="absolute z-50 mt-1 w-full [scrollbar-width:none] overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          <div className="py-1">
            {options.map(([key, label]) => {
              const active = value.includes(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50"
                >
                  <span className="min-w-0 flex-1 font-medium text-neutral-900">
                    {label}
                  </span>
                  {active ? (
                    <CircleCheck
                      className="size-4 shrink-0 text-green-600"
                      strokeWidth={2}
                      aria-hidden
                    />
                  ) : (
                    <span className="size-4 shrink-0 rounded-full border-[1.5px] border-neutral-300" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** A setup section: title above, content in the card below — the same
 *  header-above-list shape as the rest of Configuration. No collapse, no
 *  chevron — the wizard is one scrolling column. */
function SetupSection({
  title,
  subtitle,
  muted,
  action,
  unclipped = false,
  children,
}: {
  title: string
  subtitle: string
  muted?: boolean
  action?: ReactNode
  /** Lets an inner dropdown escape the card (Test section). */
  unclipped?: boolean
  children: ReactNode
}) {
  return (
    <section>
      <header className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h3
            className={cn(
              "block truncate text-[17px] font-semibold",
              muted ? "text-neutral-400" : "text-neutral-900"
            )}
          >
            {title}
          </h3>
          <p className="mt-0.5 block truncate text-[13px] text-neutral-500">
            {subtitle}
          </p>
        </div>
        {action}
      </header>
      <div
        className={cn(
          "rounded-[18px] border border-neutral-200",
          !unclipped && "overflow-hidden"
        )}
      >
        {children}
      </div>
    </section>
  )
}

const inputClass =
  "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500 placeholder:text-neutral-400"

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
      <span className="block text-[13px] font-semibold text-neutral-500">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1.5 block text-[13px] text-neutral-500">
          {hint}
        </span>
      ) : null}
    </label>
  )
}

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Document"
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
  checksFor,
  testPanel,
  resultsPanel,
  testAction,
  tested,
  availableOnSignup,
  onAvailabilityChange,
  availabilityHint,
  signupDisabled,
  saving,
  fieldMatchProfiles,
  onChangeFieldMatches,
  fieldLastRead,
  onRemoveSample,
  testSlots,
  onUploadTestSlot,
  onClearTestSlot,
  sampleMatchForSide,
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
  /** The selected detail's checks, rendered in its settings sheet. */
  checksFor: ReactNode
  /** The test runner, rendered in the Test section's card. */
  testPanel: ReactNode
  resultsPanel?: ReactNode
  testAction?: ReactNode
  tested: boolean
  availableOnSignup: boolean
  onAvailabilityChange: (next: boolean) => void
  availabilityHint: string
  /** Locks the toggle until required sample photos exist. */
  signupDisabled: boolean
  saving: boolean
  fieldMatchProfiles: (key: string) => ProfileMatchKey[]
  onChangeFieldMatches: (key: string, next: ProfileMatchKey[]) => void
  fieldLastRead: (key: string) => string | null
  onRemoveSample: (side: ProofSide) => void
  testSlots: Partial<Record<ProofSide, TestSlot>>
  onUploadTestSlot: (side: ProofSide, file: File) => void
  onClearTestSlot: (side: ProofSide) => void
  sampleMatchForSide: (
    side: ProofSide
  ) => { url: string; filename: string } | null
}) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const testUploadRef = useRef<HTMLInputElement>(null)
  const [uploadSide, setUploadSide] = useState<ProofSide>("front")
  const [testUploadSide, setTestUploadSide] = useState<ProofSide>("front")
  const [openFieldKey, setOpenFieldKey] = useState<string | null>(null)
  const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)
  const [photosOpen, setPhotosOpen] = useState(false)
  const [testSideIndex, setTestSideIndex] = useState(0)
  const needsBoth = canvasSides.length > 1

  // Fields on the side being marked. `fieldCanvasSide` maps legacy "single"
  // fields to front, so a document that switched photo requirements never
  // loses its details.
  const sideFields = fields.filter((field) =>
    needsBoth ? fieldCanvasSide(field) === sampleSide : true
  )
  const markedCount = sideFields.filter(
    (field) => field.extraction_hints?.region
  ).length

  const openFieldDef = openFieldKey
    ? (fields.find((field) => field.key === openFieldKey) ?? null)
    : null
  const pendingField = pendingRemoveKey
    ? (fields.find((field) => field.key === pendingRemoveKey) ?? null)
    : null

  const photoReady = sideFields.length > 0
  const testReady = Boolean(sampleUrl)

  const testSides: ProofSide[] = canvasSides.length ? canvasSides : ["single"]
  const allTestPhotosFilled = testSides.every(
    (side) => Boolean(testSlots[side]) || Boolean(sampleMatchForSide(side))
  )

  function requestUpload(side: ProofSide) {
    setUploadSide(side)
    uploadRef.current?.click()
  }

  function requestTestUpload(side: ProofSide) {
    setTestUploadSide(side)
    testUploadRef.current?.click()
  }

  function goNextSide() {
    setTestSideIndex((index) => (index + 1) % testSides.length)
  }

  return (
    <div className="space-y-8 pt-1">
      {/* Sample photo upload */}
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
      {/* Test photo upload */}
      <input
        ref={testUploadRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onUploadTestSlot(testUploadSide, file)
          event.target.value = ""
        }}
      />

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

      {/* The setup runs in order: define what to read, mark it on a photo,
          then test. Every section is always visible — no tabs, no collapse. */}
      <div className="space-y-6">
        <SetupSection
          title="Details to read"
          subtitle={
            sideFields.length
              ? `${sideFields.length} detail${sideFields.length === 1 ? "" : "s"}`
              : "No details yet"
          }
          action={
            <button
              type="button"
              onClick={onAddField}
              disabled={saving}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300"
            >
              <PlusIcon className="size-4" strokeWidth={2} aria-hidden />
              Add
            </button>
          }
        >
          {sideFields.length === 0 ? (
            <p className="px-4 py-6 text-center text-[14px] text-neutral-500">
              Nothing yet. Add the first detail the system should read.
            </p>
          ) : (
            <ol className="divide-y divide-neutral-200">
              {sideFields.map((field) => {
                const lastRead = fieldLastRead(field.key)
                function openChecks() {
                  onSelectField(field.key)
                  setOpenFieldKey(field.key)
                }
                return (
                  <li key={field.key}>
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <button
                        type="button"
                        onClick={openChecks}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate text-[15px] text-neutral-900">
                          {field.label || "Untitled detail"}
                        </span>
                      </button>
                      {lastRead ? (
                        <span
                          title={lastRead}
                          className="flex shrink-0 text-status-closed"
                        >
                          <CheckIcon className="size-4 shrink-0" aria-hidden />
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setPendingRemoveKey(field.key)}
                        aria-label={`Remove ${field.label}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-sos"
                      >
                        <Trash2Icon
                          className="size-4"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </SetupSection>

        <SetupSection
          title="Sample photo"
          subtitle={
            sampleUrl
              ? `${markedCount} of ${sideFields.length} marked`
              : photoReady
                ? "Add a sample photo"
                : "Add a detail first"
          }
          muted={!photoReady}
          action={
            needsBoth ? (
              <div className="flex shrink-0 items-center rounded-full border border-neutral-200 p-0.5">
                <button
                  type="button"
                  onClick={() => onSampleSideChange("front")}
                  title="Mark the front"
                  aria-label="Mark the front"
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full transition-colors",
                    sampleSide === "front"
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-400 hover:text-neutral-900"
                  )}
                >
                  <IdCard className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onSampleSideChange("back")}
                  title="Mark the back"
                  aria-label="Mark the back"
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full transition-colors",
                    sampleSide === "back"
                      ? "bg-neutral-100 text-neutral-900"
                      : "text-neutral-400 hover:text-neutral-900"
                  )}
                >
                  <CreditCard className="size-3.5" aria-hidden />
                </button>
              </div>
            ) : undefined
          }
        >
          <div className="space-y-3 px-5 py-4">
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
            {sampleUrl ? (
              <div className="flex items-center justify-between gap-4">
                <p className="text-[13px] text-neutral-500 tabular-nums">
                  {markedCount} of {sideFields.length} marked
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => requestUpload(sampleSide)}
                    aria-label="Replace photo"
                    className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                  >
                    <ImageUp className="size-4" strokeWidth={1.8} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSample(sampleSide)}
                    disabled={saving}
                    aria-label="Remove photo"
                    className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-sos disabled:opacity-40"
                  >
                    <Trash2Icon
                      className="size-4"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </SetupSection>

        <SetupSection
          title="Test"
          subtitle="See sample results"
          muted={!testReady}
          unclipped
          action={
            <button
              type="button"
              onClick={() => {
                setTestSideIndex(0)
                setPhotosOpen(true)
              }}
              disabled={!testReady || saving}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300"
            >
              <ImageUp className="size-4" strokeWidth={1.8} aria-hidden />
              {allTestPhotosFilled ? "Change photo" : "Upload photo"}
            </button>
          }
        >
          <div className="px-5 py-4">{testPanel}</div>
        </SetupSection>

        {tested ? (
          <SetupSection
            title="Results"
            subtitle="Compared against the simulated resident"
          >
            <div className="px-5 py-4">{resultsPanel}</div>
          </SetupSection>
        ) : null}

        {testAction}
      </div>

      {/* A detail's settings live in a focused sheet: name, what the value
          must match, and the checks. */}
      <SheetDialog
        open={openFieldKey != null}
        onClose={() => setOpenFieldKey(null)}
        onBack={openFieldKey != null ? () => setOpenFieldKey(null) : undefined}
        title={openFieldDef?.label || "Detail"}
        description="Checks applied when this detail is read from the photo."
        footer={
          <SheetPrimaryButton onClick={() => setOpenFieldKey(null)}>
            Done
          </SheetPrimaryButton>
        }
      >
        <label className="block">
          <span className="block text-[13px] font-semibold text-neutral-500">
            Name
          </span>
          <input
            value={openFieldDef?.label ?? ""}
            onChange={(event) => {
              if (openFieldDef)
                onRenameField(openFieldDef.key, event.target.value)
            }}
            onBlur={onBlurSave}
            placeholder="Full Name"
            className={inputClass}
          />
        </label>

        <div className="mt-6">
          <span className="mb-2 block text-[13px] font-semibold text-neutral-500">
            Must match what the resident typed
          </span>
          <MatchProfileDropdown
            value={openFieldDef ? fieldMatchProfiles(openFieldDef.key) : []}
            options={MATCH_OPTIONS}
            onChange={(next) => {
              if (openFieldDef) onChangeFieldMatches(openFieldDef.key, next)
            }}
          />
        </div>

        {openFieldKey ? <div className="mt-6">{checksFor}</div> : null}
      </SheetDialog>

      {/* Removing a detail asks first, like every other remove in the app. */}
      <SheetDialog
        open={pendingRemoveKey != null}
        onClose={() => setPendingRemoveKey(null)}
        title="Remove this detail?"
        description={
          pendingField ? (
            <>
              <strong>“{pendingField.label}”</strong> will stop being read from
              the photo.
            </>
          ) : undefined
        }
        footer={
          <div className="space-y-3">
            <SheetPrimaryButton
              tone="danger"
              disabled={saving || !pendingRemoveKey}
              onClick={() => {
                if (pendingRemoveKey) onRemoveField(pendingRemoveKey)
                setPendingRemoveKey(null)
              }}
            >
              Remove
            </SheetPrimaryButton>
            <SheetPrimaryButton onClick={() => setPendingRemoveKey(null)}>
              Keep it
            </SheetPrimaryButton>
          </div>
        }
      />

      {/* Test photos, edited in a focused sheet — one side per block, photo
          with change/remove below it, same shape as the sample photo area. */}
      <SheetDialog
        open={photosOpen}
        onClose={() => setPhotosOpen(false)}
        title="Test photos"
        description="The photos the test reads. Every side needs one."
        footer={
          <button
            type="button"
            disabled={!allTestPhotosFilled}
            onClick={() => setPhotosOpen(false)}
            className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:opacity-100"
          >
            Save
          </button>
        }
      >
        <div className="space-y-5">
          {(() => {
            const activeSide =
              testSides[Math.min(testSideIndex, testSides.length - 1)]
            const nextSide = testSides[(testSideIndex + 1) % testSides.length]
            const slot = testSlots[activeSide]
            const matched = sampleMatchForSide(activeSide)
            const photoUrl = slot?.url ?? matched?.url ?? null
            const multiSide = testSides.length > 1
            return (
              <div className="space-y-3">
                {photoUrl ? (
                  <button
                    type="button"
                    onClick={multiSide ? goNextSide : undefined}
                    disabled={!multiSide}
                    aria-label={
                      multiSide ? `Go to ${sideLabel(nextSide)}` : undefined
                    }
                    className={cn(
                      "group relative block w-full",
                      multiSide ? "cursor-pointer" : "cursor-default"
                    )}
                  >
                    <img
                      src={photoUrl}
                      alt={`${sideLabel(activeSide)} test photo`}
                      className="block max-h-72 w-full rounded-[18px] border border-neutral-200 bg-neutral-50 object-contain"
                    />
                    {/* A strong wash covers the whole photo while hovering. */}
                    {multiSide ? (
                      <span
                        className="pointer-events-none absolute inset-0 rounded-[18px] bg-white/90 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                        aria-hidden
                      />
                    ) : null}
                    {multiSide ? (
                      <span className="pointer-events-none absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-neutral-900 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                        {nextSide === "back" ? (
                          <CreditCard
                            className="size-6"
                            strokeWidth={1.8}
                            aria-hidden
                          />
                        ) : (
                          <IdCard
                            className="size-6"
                            strokeWidth={1.8}
                            aria-hidden
                          />
                        )}
                      </span>
                    ) : null}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => requestTestUpload(activeSide)}
                    disabled={saving}
                    className="flex min-h-[10rem] w-full flex-col items-center justify-center gap-2 rounded-[18px] bg-neutral-50 px-6 py-10 text-center transition-colors hover:bg-neutral-100 disabled:opacity-50"
                  >
                    <span className="flex size-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                      <ImageUp
                        className="size-5"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                    </span>
                    <span className="text-[14px] font-semibold text-neutral-900">
                      Upload {sideLabel(activeSide).toLowerCase()} photo
                    </span>
                  </button>
                )}

                {multiSide ? (
                  <p className="text-center text-[12px] text-neutral-400 tabular-nums">
                    {testSideIndex + 1} of {testSides.length}
                  </p>
                ) : null}

                <div className="flex items-center justify-between gap-4">
                  <p className="min-w-0 text-[13px] text-neutral-500">
                    JPG or PNG, up to 10 MB.
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => requestTestUpload(activeSide)}
                      disabled={saving}
                      aria-label={`Replace ${sideLabel(activeSide).toLowerCase()} test photo`}
                      className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
                    >
                      <ImageUp
                        className="size-4"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                    </button>
                    {slot ? (
                      <button
                        type="button"
                        onClick={() => onClearTestSlot(activeSide)}
                        disabled={saving}
                        aria-label={`Remove ${sideLabel(activeSide).toLowerCase()} test photo`}
                        className="flex size-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-sos"
                      >
                        <Trash2Icon
                          className="size-4"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </SheetDialog>

      {/* Going live is the last decision. Full width, same as Save changes. */}
      <div className="overflow-hidden rounded-[18px] border border-neutral-200">
        <SheetToggleRow
          id="offer-proof-on-signup"
          label="Residents can choose this when they register"
          description={availabilityHint}
          checked={availableOnSignup}
          disabled={signupDisabled}
          onChange={onAvailabilityChange}
        />
      </div>
    </div>
  )
}
