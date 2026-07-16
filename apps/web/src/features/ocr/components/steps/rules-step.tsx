import type { ReactNode } from "react"

import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType, OcrFieldDefinition, OcrFieldHints, OcrTestField } from "@/features/ocr/api"
import { PROOF_THEME, proofSelectClass } from "@/features/ocr/components/proof-theme"
import type { ProfileMatchKey } from "@/features/ocr/hooks/use-ocr-template-state"
import {
  fieldDisplayColor,
  fieldDisplayNumber,
  hintsOf,
} from "@/features/ocr/lib/create-document-defaults"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

function Panel({
  title,
  step,
  description,
  children,
  className,
}: {
  title: string
  step?: number
  description?: string
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
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4 md:p-5">{children}</div>
    </section>
  )
}

function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block">
      <span className={cn("block text-xs font-black", PROOF_THEME.title)}>{children}</span>
      {hint ? (
        <span className={cn("mt-0.5 block text-[11px] font-semibold leading-4", PROOF_THEME.muted)}>
          {hint}
        </span>
      ) : null}
    </span>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2.5 transition hover:bg-[#f8fafc]",
        PROOF_THEME.border,
      )}
    >
      <span className="min-w-0">
        <span className={cn("block text-xs font-black", PROOF_THEME.title)}>{label}</span>
        {hint ? (
          <span className={cn("mt-0.5 block text-[11px] font-semibold leading-4", PROOF_THEME.muted)}>
            {hint}
          </span>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

export function RulesStep(props: {
  document: OcrDocumentType
  fields: OcrFieldDefinition[]
  selectedField: OcrFieldDefinition | null
  selectedFieldIndex: number
  onSelectField: (key: string) => void
  onUpdateField: (fieldKey: string, updater: (f: OcrFieldDefinition) => OcrFieldDefinition) => void
  onRenameField?: (fieldKey: string, label: string) => void
  onUpdateHints: (fieldKey: string, patch: Partial<OcrFieldHints>) => void
  onSetValidationRules: (
    fieldKey: string,
    next: {
      required: boolean
      matchProfiles: Array<
        "first_name" | "middle_name" | "last_name" | "gender" | "date_of_birth" | "address"
      >
      notExpired: boolean
    },
  ) => void
  fieldMatchProfiles: (fieldKey: string) => ProfileMatchKey[]
  fieldHasNotExpired: (fieldKey: string) => boolean
  selectedDetected?: OcrTestField | null
}) {
  const {
    fields,
    selectedField,
    selectedFieldIndex,
    onSelectField,
    onUpdateField,
    onRenameField,
    onUpdateHints,
    onSetValidationRules,
    fieldMatchProfiles,
    fieldHasNotExpired,
    selectedDetected,
  } = props

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(16rem,0.9fr)_minmax(0,1.2fr)]">
      <Panel
        step={1}
        title="Information to read"
        description="Select an item to configure its rules."
        className="min-h-[28rem]"
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {fields.map((field) => {
            const color = fieldDisplayColor(field, fields)
            const displayNumber = fieldDisplayNumber(field, fields)
            const selected = selectedField?.key === field.key
            return (
              <button
                key={field.key}
                type="button"
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-colors",
                  selected
                    ? "border-[#145be7] bg-blue-50/80 shadow-sm"
                    : "border-[#dfe7f5] bg-[#f8fafc] hover:bg-white",
                )}
                onClick={() => onSelectField(field.key)}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {displayNumber}
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-sm font-black", PROOF_THEME.title)}>
                  {field.label}
                </span>
              </button>
            )
          })}
          {fields.length === 0 ? (
            <p
              className={cn(
                "rounded-xl border border-dashed border-[#cbd8ee] px-3 py-10 text-center text-sm font-semibold",
                PROOF_THEME.muted,
              )}
            >
              No information listed yet. Add items on the Mark areas step first.
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        step={2}
        title="Rules for this field"
        description="Decide what must match, and how strictly the system should check."
        className="min-h-[28rem]"
      >
        {!selectedField ? (
          <p className={cn("py-8 text-center text-sm font-semibold", PROOF_THEME.muted)}>
            Select an information item from the list to set its rules.
          </p>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex items-center gap-2 rounded-xl bg-[#f2f6ff] px-3 py-2.5">
              <span
                className="flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                style={{
                  backgroundColor: fieldDisplayColor(selectedField, fields),
                }}
              >
                {fieldDisplayNumber(selectedField, fields)}
              </span>
              <p className={cn("text-sm font-black", PROOF_THEME.title)}>
                Editing: <span className="text-[#145be7]">{selectedField.label}</span>
              </p>
            </div>

            <label className="block">
              <FieldLabel hint="Simple name officials and residents will understand">
                What to call this
              </FieldLabel>
              <Input
                value={selectedField.label}
                onChange={(event) => {
                  const next = event.target.value
                  if (onRenameField) {
                    onRenameField(selectedField.key, next)
                  } else {
                    onUpdateField(selectedField.key, (field) => ({
                      ...field,
                      label: next,
                    }))
                  }
                }}
                className="h-10 font-semibold"
              />
            </label>

            <div className="grid grid-cols-1 gap-2">
              <ToggleRow
                label="Covers more than one line"
                hint="Turn on for long addresses or multi-line text"
                checked={Boolean(hintsOf(selectedField).multi_line)}
                onCheckedChange={(multi_line) =>
                  onUpdateHints(selectedField.key, { multi_line })
                }
              />
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-amber-950">
              <p className="font-black text-amber-900">Resident feedback for this field</p>
              <p className="mt-1.5">
                If this field is <strong>missing</strong> on the ID or does not{" "}
                <strong>match</strong> the form, residents see:{" "}
                <strong className="text-rose-700">“ID mismatched.”</strong>
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                <li>
                  Turn on <em>Must appear on the proof</em> so empty OCR is treated as mismatched.
                </li>
                <li>
                  Under <em>Compare with resident’s form</em>, tick form fields to compare (e.g.
                  Full name → First + Last name). Wrong text also returns “ID mismatched.”
                </li>
                <li>
                  For expiry dates, use <em>Must not be expired</em>.
                </li>
              </ul>
            </div>

            <ToggleRow
              label="Must appear on the proof"
              hint='If OCR finds nothing in the marked box, feedback is “ID mismatched.”'
              checked={selectedField.required}
              onCheckedChange={(required) => {
                onUpdateField(selectedField.key, (field) => ({ ...field, required }))
                onSetValidationRules(selectedField.key, {
                  required,
                  matchProfiles: fieldMatchProfiles(selectedField.key),
                  notExpired: fieldHasNotExpired(selectedField.key),
                })
              }}
            />

            <div>
              <p className={cn("mb-1 text-xs font-black", PROOF_THEME.title)}>
                Compare with resident’s form (mismatch checks)
              </p>
              <p className={cn("mb-2 text-[11px] font-semibold leading-4", PROOF_THEME.muted)}>
                Tick the registration fields this OCR value must match. Example: a “Full name” box
                often matches First name + Last name; “Address” matches Address.
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {(
                  [
                    ["first_name", "First name"],
                    ["middle_name", "Middle name"],
                    ["last_name", "Last name"],
                    ["gender", "Gender"],
                    ["date_of_birth", "Date of birth"],
                    ["address", "Address"],
                  ] as const
                ).map(([profileKey, label]) => {
                  const active = fieldMatchProfiles(selectedField.key).includes(profileKey)
                  return (
                    <label
                      key={profileKey}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition",
                        active
                          ? "border-[#145be7] bg-blue-50 text-[#07145f]"
                          : "border-[#dfe7f5] text-[#07145f] hover:bg-[#f8fafc]",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-[#145be7]"
                        checked={active}
                        onChange={(event) => {
                          const current = fieldMatchProfiles(selectedField.key)
                          const next = event.target.checked
                            ? [...current, profileKey]
                            : current.filter((item) => item !== profileKey)
                          onSetValidationRules(selectedField.key, {
                            required: selectedField.required,
                            matchProfiles: next,
                            notExpired: fieldHasNotExpired(selectedField.key),
                          })
                        }}
                      />
                      {label}
                    </label>
                  )
                })}
              </div>
            </div>

            <ToggleRow
              label="Must not be expired"
              hint="Use only on an expiry / valid-until date field to reject expired IDs"
              checked={fieldHasNotExpired(selectedField.key)}
              onCheckedChange={(notExpired) =>
                onSetValidationRules(selectedField.key, {
                  required: selectedField.required,
                  matchProfiles: fieldMatchProfiles(selectedField.key),
                  notExpired,
                })
              }
            />

            <details className="rounded-xl border border-dashed border-[#cbd8ee] p-3">
              <summary className={cn("cursor-pointer text-xs font-black", PROOF_THEME.muted)}>
                Optional: advanced reading options
              </summary>
              <div className="mt-3 space-y-3">
                <p className={cn("text-xs font-black", PROOF_THEME.title)}>Reading options</p>
                <label className="block">
                  <FieldLabel hint="Advanced — require a specific pattern in the value">
                    Text pattern (optional)
                  </FieldLabel>
                  <Input
                    value={hintsOf(selectedField).regex_pattern || ""}
                    placeholder={
                      /number|id_no|document/i.test(selectedField.key + selectedField.label)
                        ? "2026|MH\\d{4}-\\d+|20\\d{2}"
                        : "^[A-Z .'-]+$"
                    }
                    onChange={(event) =>
                      onUpdateHints(selectedField.key, { regex_pattern: event.target.value })
                    }
                    className="font-mono text-xs"
                  />
                  <span
                    className={cn(
                      "mt-1 block text-[11px] font-semibold leading-snug",
                      PROOF_THEME.muted,
                    )}
                  >
                    Examples: <code className="rounded bg-[#f2f6ff] px-1">2026</code> must appear;{" "}
                    <code className="rounded bg-[#f2f6ff] px-1">MH\d{"{4}"}-\d+</code> for codes
                    like MH2024-5148. Also turn on “Must appear on the proof.”
                  </span>
                </label>
                <label className="block">
                  <FieldLabel hint="Printed labels near the text, e.g. ID NO.">
                    Nearby printed labels
                  </FieldLabel>
                  <Input
                    value={(hintsOf(selectedField).expected_keywords || []).join(", ")}
                    placeholder="ID NO, DOCUMENT NUMBER"
                    onChange={(event) =>
                      onUpdateHints(selectedField.key, {
                        expected_keywords: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                        labels: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <span className={cn("mt-1 block text-[11px] font-semibold", PROOF_THEME.muted)}>
                    Helps the system find the right area. Does not check the value itself.
                  </span>
                </label>

                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className={cn("font-black", PROOF_THEME.title)}>
                      Minimum reading quality
                    </span>
                    <span className="font-black text-[#145be7]">
                      {asPercent(selectedField.min_confidence ?? 0.9)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={Math.round((selectedField.min_confidence ?? 0.9) * 100)}
                    onChange={(event) =>
                      onUpdateField(selectedField.key, (field) => ({
                        ...field,
                        min_confidence: Number(event.target.value) / 100,
                      }))
                    }
                    className="w-full accent-[#145be7]"
                  />
                  <p className={cn("mt-1 text-[11px] font-semibold", PROOF_THEME.muted)}>
                    Higher means the system must be more sure about what it read.
                  </p>
                </div>

                <ToggleRow
                  label="Fix common reading mistakes"
                  hint="Small spelling and character corrections"
                  checked={hintsOf(selectedField).auto_correct !== false}
                  onCheckedChange={(auto_correct) =>
                    onUpdateHints(selectedField.key, { auto_correct })
                  }
                />
                <label className="block">
                  <FieldLabel>Letter casing</FieldLabel>
                  <select
                    className={proofSelectClass()}
                    value={
                      hintsOf(selectedField).case_normalization ||
                      selectedField.normalization ||
                      "none"
                    }
                    onChange={(event) => {
                      const value = event.target.value
                      onUpdateField(selectedField.key, (field) => ({
                        ...field,
                        normalization:
                          value === "uppercase"
                            ? "uppercase"
                            : value === "name"
                              ? "name"
                              : "none",
                        extraction_hints: {
                          ...hintsOf(field),
                          case_normalization: value,
                        },
                      }))
                    }}
                  >
                    <option value="none">Keep as read</option>
                    <option value="uppercase">ALL CAPS</option>
                    <option value="lowercase">all lowercase</option>
                    <option value="name">Title Case (Names)</option>
                  </select>
                </label>
                <ToggleRow
                  label="Remove symbols"
                  hint="Strip punctuation and special characters"
                  checked={Boolean(hintsOf(selectedField).remove_special_chars)}
                  onCheckedChange={(remove_special_chars) =>
                    onUpdateHints(selectedField.key, { remove_special_chars })
                  }
                />
              </div>
            </details>

            <div className="rounded-xl border border-[#dfe7f5] bg-[#f2f6ff] p-3">
              <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>
                Last test for this field
              </p>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className={cn("font-semibold", PROOF_THEME.muted)}>Value found</span>
                <span className={cn("max-w-[60%] truncate text-right font-black", PROOF_THEME.title)}>
                  {selectedDetected?.value || "—"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span className={cn("font-semibold", PROOF_THEME.muted)}>Reading quality</span>
                <span className="font-black text-emerald-600">
                  {asPercent(selectedDetected?.confidence)}
                </span>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </section>
  )
}
