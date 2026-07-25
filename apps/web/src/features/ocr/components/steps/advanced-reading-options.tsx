import type { ReactNode } from "react"

import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrFieldDefinition, OcrFieldHints } from "@/features/ocr/api"
import { PROOF_THEME, proofSelectClass } from "@/features/ocr/components/proof-theme"
import { hintsOf } from "@/features/ocr/lib/create-document-defaults"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "\u2014"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
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

interface AdvancedReadingOptionsProps {
  selectedField: OcrFieldDefinition
  onUpdateField: (fieldKey: string, updater: (f: OcrFieldDefinition) => OcrFieldDefinition) => void
  onUpdateHints: (fieldKey: string, patch: Partial<OcrFieldHints>) => void
}

export function AdvancedReadingOptions({
  selectedField,
  onUpdateField,
  onUpdateHints,
}: AdvancedReadingOptionsProps) {
  return (
    <details className="rounded-xl border border-dashed border-[#cbd8ee] p-3">
      <summary className={cn("cursor-pointer text-xs font-black", PROOF_THEME.muted)}>
        Optional: advanced reading options
      </summary>
      <div className="mt-3 space-y-3">
        <p className={cn("text-xs font-black", PROOF_THEME.title)}>Reading options</p>
        <label className="block">
          <FieldLabel hint="Advanced \u2014 require a specific pattern in the value">
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
            like MH2024-5148. Also turn on \u201cMust appear on the proof.\u201d
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
            aria-label="Adjust minimum confidence threshold"
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
  )
}
