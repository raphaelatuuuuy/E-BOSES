import { useEffect, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, CircleCheck } from "lucide-react"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type {
  OcrDocumentType,
  OcrFieldDefinition,
  OcrFieldHints,
} from "@/features/ocr/api"
import type { ProfileMatchKey } from "@/features/ocr/hooks/use-ocr-template-state"
import { hintsOf } from "@/features/ocr/lib/create-document-defaults"

function isLikelyDateField(field: OcrFieldDefinition): boolean {
  const key = `${field.key} ${field.label}`.toLowerCase()
  return field.data_type === "date" || /expir|valid|until/.test(key)
}

type CheckKey = "required" | "multi_line" | "not_expired"

/** Multi-select dropdown in the same style the units page uses. */
function ChecksDropdown({
  value,
  options,
  onChange,
}: {
  value: string[]
  options: { key: CheckKey; label: string }[]
  onChange: (next: string[]) => void
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
    .filter((option) => value.includes(option.key))
    .map((option) => option.label)

  function toggle(key: CheckKey) {
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
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400"
      >
        <span className="flex-1 truncate font-medium">
          {selectedLabels.length > 0
            ? selectedLabels.join(", ")
            : "No checks set"}
        </span>
        {open ? (
          <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" aria-hidden />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" aria-hidden />
        )}
      </button>
      {open ? (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          <div className="py-1">
            {options.map((option) => {
              const active = value.includes(option.key)
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggle(option.key)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50"
                >
                  <span className="min-w-0 flex-1 font-medium text-neutral-900">
                    {option.label}
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
  } = props

  const activeMatches = selectedField
    ? fieldMatchProfiles(selectedField.key)
    : []
  const showExpiry = selectedField ? isLikelyDateField(selectedField) : false

  const checkOptions: { key: CheckKey; label: string }[] = [
    { key: "required", label: "Must be present" },
    { key: "multi_line", label: "Can run over more than one line" },
    ...(showExpiry
      ? [{ key: "not_expired" as const, label: "Must not be expired" }]
      : []),
  ]

  const activeChecks = selectedField
    ? [
        ...(selectedField.required ? ["required" as const] : []),
        ...(hintsOf(selectedField).multi_line ? ["multi_line" as const] : []),
        ...(showExpiry && fieldHasNotExpired(selectedField.key)
          ? ["not_expired" as const]
          : []),
      ]
    : []

  function setChecks(next: string[]) {
    if (!selectedField) return
    const required = next.includes("required")
    const multi_line = next.includes("multi_line")
    const notExpired = next.includes("not_expired")
    onUpdateField(selectedField.key, (field) => ({ ...field, required }))
    onUpdateHints(selectedField.key, { multi_line })
    onSetValidationRules(selectedField.key, {
      required,
      matchProfiles: activeMatches,
      notExpired: showExpiry ? notExpired : fieldHasNotExpired(selectedField.key),
    })
  }

  return (
    <section className="flex flex-col">
      {props.showFieldPicker ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 pb-3">
          <label className="text-[13px] text-neutral-500">Detail</label>
          <select
            className="w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none focus:border-neutral-500"
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
        <p className="rounded-[14px] border-[1.5px] border-dashed border-neutral-300 px-3 py-10 text-center text-[14px] font-medium text-neutral-500">
          No information listed yet. Add items on the Mark areas step first.
        </p>
      ) : (
        <div className="flex flex-col gap-6 pt-1">
          {/* Checks live in one dropdown instead of a row of switches. */}
          <div>
            <span className="mb-2 block text-[13px] font-semibold text-neutral-500">
              Checks
            </span>
            <ChecksDropdown
              value={activeChecks}
              options={checkOptions}
              onChange={setChecks}
            />
          </div>

          {/* Everything advanced is visible at once — no nested disclosure. */}
          <div>
            <span className="mb-2 block text-[13px] font-semibold text-neutral-500">
              Advanced
            </span>
            <div className="space-y-4 rounded-[14px] border-[1.5px] border-neutral-200 bg-white p-4">
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-neutral-500">
                  Must contain
                </span>
                <input
                  value={hintsOf(selectedField).regex_pattern || ""}
                  onChange={(event) =>
                    onUpdateHints(selectedField.key, {
                      regex_pattern: event.target.value,
                    })
                  }
                  placeholder="Marikina  or  MH\d{4}-\d+"
                  className="w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500 placeholder:text-neutral-400"
                />
                <span className="mt-1 block text-[13px] text-neutral-500">
                  Plain text or regex. Value must contain this to pass.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-neutral-500">
                  Failure message
                </span>
                <input
                  value={hintsOf(selectedField).failure_message || ""}
                  onChange={(event) =>
                    onUpdateHints(selectedField.key, {
                      failure_message: event.target.value,
                    })
                  }
                  placeholder="Address is outside Marikina."
                  className="w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500 placeholder:text-neutral-400"
                />
                <span className="mt-1 block text-[13px] text-neutral-500">
                  Shown when this field fails. Leave blank for the default message.
                </span>
              </label>

              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-neutral-500">
                  Letter casing
                </span>
                <div className="relative">
                  <select
                    className="w-full appearance-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 pr-10 text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400 focus:border-neutral-500"
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
                  <ChevronDownIcon
                    className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-neutral-400"
                    aria-hidden
                  />
                </div>
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-4">
                <span className="block">
                  <span className="block text-[14px] font-medium leading-snug text-neutral-900">
                    Remove symbols
                  </span>
                  <span className="mt-0.5 block text-[13px] text-neutral-500">
                    Strip punctuation and special characters.
                  </span>
                </span>
                <Switch
                  checked={Boolean(hintsOf(selectedField).remove_special_chars)}
                  onCheckedChange={(remove_special_chars) =>
                    onUpdateHints(selectedField.key, { remove_special_chars })
                  }
                  className={cn(
                    "shrink-0",
                    hintsOf(selectedField).remove_special_chars
                      ? "bg-brand-orange"
                      : "bg-neutral-200"
                  )}
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
