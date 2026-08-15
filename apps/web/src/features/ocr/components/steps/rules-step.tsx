import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type {
  OcrDocumentType,
  OcrFieldDefinition,
  OcrFieldHints,
  OcrTestField,
} from "@/features/ocr/api"
import {
  PROOF_THEME,
  proofSelectClass,
} from "@/features/ocr/components/proof-theme"
import type { ProfileMatchKey } from "@/features/ocr/hooks/use-ocr-template-state"
import {
  hintsOf,
} from "@/features/ocr/lib/create-document-defaults"

const MATCH_OPTIONS: ReadonlyArray<readonly [ProfileMatchKey, string]> = [
  ["first_name", "First name"],
  ["middle_name", "Middle name"],
  ["last_name", "Last name"],
  ["gender", "Gender"],
  ["date_of_birth", "Date of birth"],
  ["address", "Address"],
] as const

function isLikelyDateField(field: OcrFieldDefinition): boolean {
  const key = `${field.key} ${field.label}`.toLowerCase()
  return field.data_type === "date" || /expir|valid|until/.test(key)
}

export function RulesStep(props: {
  document: OcrDocumentType
  fields: OcrFieldDefinition[]
  selectedField: OcrFieldDefinition | null
  selectedFieldIndex: number
  /** The detail list is on-screen already, so the picker is off by default. */
  showFieldPicker?: boolean
  onSelectField: (key: string) => void
  onUpdateField: (
    fieldKey: string,
    updater: (f: OcrFieldDefinition) => OcrFieldDefinition
  ) => void
  /** Renaming lives in the detail list; this panel only sets checks. */
  onUpdateHints: (fieldKey: string, patch: Partial<OcrFieldHints>) => void
  onSetValidationRules: (
    fieldKey: string,
    next: {
      required: boolean
      matchProfiles: ProfileMatchKey[]
      notExpired: boolean
    }
  ) => void
  fieldMatchProfiles: (fieldKey: string) => ProfileMatchKey[]
  fieldHasNotExpired: (fieldKey: string) => boolean
  selectedDetected?: OcrTestField | null
}) {
  const {
    fields,
    selectedField,
    onSelectField,
    onUpdateField,
    onUpdateHints,
    onSetValidationRules,
    fieldMatchProfiles,
    fieldHasNotExpired,
    selectedDetected,
  } = props

  const activeMatches = selectedField
    ? fieldMatchProfiles(selectedField.key)
    : []
  const showExpiry = selectedField ? isLikelyDateField(selectedField) : false

  return (
    <section className="flex flex-col">
      {props.showFieldPicker ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
          <label className="text-meta text-neutral-500">Detail</label>
          <select
            className={proofSelectClass()}
            value={selectedField?.key ?? ""}
            onChange={(event) => onSelectField(event.target.value)}
          >
            {fields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!selectedField ? (
        <div className="px-1 pt-4 md:px-1">
          <p
            className={cn(
              "rounded-xl border border-dashed border-neutral-200 px-3 py-10 text-center text-sm font-medium",
              PROOF_THEME.muted
            )}
          >
            No information listed yet. Add items on the Mark areas step first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 pt-1">
          <div className="flex flex-col gap-3">
            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={selectedField.required}
                onCheckedChange={(required) => {
                  onUpdateField(selectedField.key, (field) => ({
                    ...field,
                    required,
                  }))
                  onSetValidationRules(selectedField.key, {
                    required,
                    matchProfiles: activeMatches,
                    notExpired: fieldHasNotExpired(selectedField.key),
                  })
                }}
              />
              <span className="text-meta text-brand-navy">
                Must be present
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={Boolean(hintsOf(selectedField).multi_line)}
                onCheckedChange={(multi_line) =>
                  onUpdateHints(selectedField.key, { multi_line })
                }
              />
              <span className="text-meta text-brand-navy">
                Can run over more than one line
              </span>
            </label>

            {showExpiry ? (
              <label className="flex cursor-pointer items-center gap-2">
                <Switch
                  checked={fieldHasNotExpired(selectedField.key)}
                  onCheckedChange={(notExpired) =>
                    onSetValidationRules(selectedField.key, {
                      required: selectedField.required,
                      matchProfiles: activeMatches,
                      notExpired,
                    })
                  }
                />
                <span className="text-meta text-brand-navy">
                  Must not be expired
                </span>
              </label>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-meta text-neutral-500">
              Must match what the resident typed
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MATCH_OPTIONS.map(([profileKey, label]) => {
                const active = activeMatches.includes(profileKey)
                return (
                  <button
                    type="button"
                    key={profileKey}
                    onClick={() => {
                      const next = active
                        ? activeMatches.filter((item) => item !== profileKey)
                        : [...activeMatches, profileKey]
                      onSetValidationRules(selectedField.key, {
                        required: selectedField.required,
                        matchProfiles: next,
                        notExpired: fieldHasNotExpired(selectedField.key),
                      })
                    }}
                    className={cn(
                      "rounded-full px-3 py-1 text-meta transition-colors",
                      active
                        ? "bg-brand-navy text-white"
                        : "bg-neutral-100 text-neutral-600 hover:text-brand-navy"
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <details className={cn("group rounded-lg border", PROOF_THEME.border)}>
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-semibold",
                PROOF_THEME.title
              )}
            >
              Advanced
              <span
                className={cn(
                  "text-[11px] font-medium transition group-open:hidden",
                  PROOF_THEME.muted
                )}
              >
                Show
              </span>
              <span
                className={cn(
                  "hidden text-[11px] font-medium transition group-open:inline",
                  PROOF_THEME.muted
                )}
              >
                Hide
              </span>
            </summary>
            <div
              className={cn(
                "space-y-3 border-t px-3 py-3",
                PROOF_THEME.border
              )}
            >
              <label className="block">
                <span
                  className={cn(
                    "mb-1 block text-[11px] font-semibold",
                    PROOF_THEME.muted
                  )}
                >
                  Must contain
                </span>
                <Input
                  value={hintsOf(selectedField).regex_pattern || ""}
                  onChange={(event) =>
                    onUpdateHints(selectedField.key, {
                      regex_pattern: event.target.value,
                    })
                  }
                  placeholder="Marikina  or  MH\d{4}-\d+"
                  className="h-9 font-mono text-xs"
                />
                <span
                  className={cn(
                    "mt-1 block text-[11px] font-medium",
                    PROOF_THEME.muted
                  )}
                >
                  Plain text or regex. Value must contain this to pass.
                </span>
              </label>

              <label className="block">
                <span
                  className={cn(
                    "mb-1 block text-[11px] font-semibold",
                    PROOF_THEME.muted
                  )}
                >
                  Failure message
                </span>
                <Input
                  value={hintsOf(selectedField).failure_message || ""}
                  onChange={(event) =>
                    onUpdateHints(selectedField.key, {
                      failure_message: event.target.value,
                    })
                  }
                  placeholder="Address is outside Marikina."
                  className="h-9 text-xs"
                />
                <span
                  className={cn(
                    "mt-1 block text-[11px] font-medium",
                    PROOF_THEME.muted
                  )}
                >
                  Shown when this field fails. Leave blank for the default message.
                </span>
              </label>

              <label className="block">
                <span
                  className={cn(
                    "mb-1 block text-[11px] font-semibold",
                    PROOF_THEME.muted
                  )}
                >
                  Letter casing
                </span>
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

              <label className="flex cursor-pointer items-start gap-2">
                <Switch
                  checked={Boolean(hintsOf(selectedField).remove_special_chars)}
                  onCheckedChange={(remove_special_chars) =>
                    onUpdateHints(selectedField.key, { remove_special_chars })
                  }
                />
                <span className="block">
                  <span
                    className={cn("block text-xs font-medium", PROOF_THEME.title)}
                  >
                    Remove symbols
                  </span>
                  <span
                    className={cn(
                      "block text-[11px] font-medium",
                      PROOF_THEME.muted
                    )}
                  >
                    Strip punctuation and special characters.
                  </span>
                </span>
              </label>
            </div>
          </details>

          <div
            className={cn(
              "flex items-center justify-between gap-2 border-t pt-3 text-xs",
              PROOF_THEME.border
            )}
          >
            <span className={cn("font-medium", PROOF_THEME.muted)}>
              Last read
            </span>
            <span
              className={cn(
                "max-w-[60%] truncate text-right font-semibold",
                PROOF_THEME.title
              )}
            >
              {selectedDetected?.value || "Not tested yet"}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}