import type { ReactNode } from "react"

import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, OcrFieldHints, OcrTestField } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import type { ProfileMatchKey } from "@/features/ocr/hooks/use-ocr-template-state"
import {
  fieldDisplayColor,
  fieldDisplayNumber,
  hintsOf,
} from "@/features/ocr/lib/create-document-defaults"

import { AdvancedReadingOptions } from "@/features/ocr/components/steps/advanced-reading-options"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
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

interface RulesEditorProps {
  selectedField: OcrFieldDefinition
  fields: OcrFieldDefinition[]
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
}

export function RulesEditor({
  selectedField,
  fields,
  onUpdateField,
  onRenameField,
  onUpdateHints,
  onSetValidationRules,
  fieldMatchProfiles,
  fieldHasNotExpired,
  selectedDetected,
}: RulesEditorProps) {
  return (
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
        hint='If OCR finds nothing in the marked box, feedback is "ID mismatched."'
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
          Tick the registration fields this OCR value must match. Example: a "Full name" box
          often matches First name + Last name; "Address" matches Address.
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
                    ? "border-[#145be7] bg-blue-50 text-brand-navy"
                    : "border-[#dfe7f5] text-brand-navy hover:bg-[#f8fafc]",
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

      <AdvancedReadingOptions
        selectedField={selectedField}
        onUpdateField={onUpdateField}
        onUpdateHints={onUpdateHints}
      />

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
  )
}
