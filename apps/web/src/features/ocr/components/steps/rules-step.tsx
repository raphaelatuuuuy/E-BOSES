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
  fieldDisplayColor,
  fieldDisplayNumber,
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
  onSelectField: (key: string) => void
  onUpdateField: (
    fieldKey: string,
    updater: (f: OcrFieldDefinition) => OcrFieldDefinition
  ) => void
  onRenameField?: (fieldKey: string, label: string) => void
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
    onRenameField,
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
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 border-b px-1 pb-3 md:px-1",
          PROOF_THEME.border
        )}
      >
        <label className={cn("text-xs font-semibold", PROOF_THEME.title)}>
          Field
        </label>
        <span className="flex items-center gap-2">
          {selectedField ? (
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
              style={{
                backgroundColor: fieldDisplayColor(selectedField, fields),
              }}
            >
              {fieldDisplayNumber(selectedField, fields)}
            </span>
          ) : null}
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
        </span>
      </div>

      {!selectedField ? (
        <div className="px-1 pt-4 md:px-1">
          <p
            className={cn(
              "rounded-xl border border-dashed border-line-tint px-3 py-10 text-center text-sm font-medium",
              PROOF_THEME.muted
            )}
          >
            No information listed yet. Add items on the Mark areas step first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-1 pt-4 md:px-1">
          <label className="block">
            <span
              className={cn(
                "mb-1.5 block text-xs font-semibold",
                PROOF_THEME.title
              )}
            >
              Label
            </span>
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
              className="h-10 font-medium"
            />
          </label>

          <div className="flex flex-wrap gap-x-6 gap-y-3">
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
              <span
                className={cn("text-xs font-medium", PROOF_THEME.title)}
              >
                Required
              </span>
            </label>

            <label className="flex cursor-pointer items-center gap-2">
              <Switch
                checked={Boolean(hintsOf(selectedField).multi_line)}
                onCheckedChange={(multi_line) =>
                  onUpdateHints(selectedField.key, { multi_line })
                }
              />
              <span
                className={cn("text-xs font-medium", PROOF_THEME.title)}
              >
                Multi-line
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
                <span className="block">
                  <span
                    className={cn("block text-xs font-medium", PROOF_THEME.title)}
                  >
                    Must not be expired
                  </span>
                </span>
              </label>
            ) : null}
          </div>

          <div>
            <p
              className={cn(
                "mb-2 text-xs font-semibold",
                PROOF_THEME.title
              )}
            >
              Match against form fields
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
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-brand-blue bg-brand-blue text-white"
                        : "border-line-tint bg-white text-navy-muted hover:border-brand-blue"
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
                  Shown when this field fails. Default: ID is mismatched.
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