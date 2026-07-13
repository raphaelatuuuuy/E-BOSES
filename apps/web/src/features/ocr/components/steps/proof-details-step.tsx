import { IdCard } from "lucide-react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
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

export function ProofDetailsStep(props: {
  document: OcrDocumentType
  onChange: (
    patch: Partial<
      Pick<
        OcrDocumentType,
        "name" | "template_name" | "description" | "required_sides" | "min_files" | "max_files"
      >
    >,
  ) => void
  onBlurSave?: () => void
  /** Sample photo count — used to disable Front only ↔ Front+back when two samples exist. */
  samplePhotoCount?: number
  /** Prefer over raw side patches so capture-mode rules (toasts, sample remap) stay centralized. */
  onChangeCaptureMode?: (mode: "one" | "both") => void
}) {
  const {
    document,
    onChange,
    onBlurSave,
    samplePhotoCount = 0,
    onChangeCaptureMode,
  } = props

  const nameValue =
    document.template_name !== undefined && document.template_name !== null
      ? document.template_name
      : document.name || ""

  const current = document.required_sides ?? ["single"]
  const needsBoth = current.includes("front") && current.includes("back")

  return (
    <section className={cn(PROOF_THEME.card, "p-5")}>
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className={cn("text-base font-black", PROOF_THEME.title)}>Proof type settings</h2>
          <p className={cn("mt-1 text-xs font-semibold", PROOF_THEME.body)}>
            Name the ID or document, choose how many photos residents take, and turn it on for
            sign-up.
          </p>
        </div>
        <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-semibold leading-4 text-[#145be7]">
          Use <strong>Available on sign-up</strong> on the last step to show or hide this proof for
          residents. Changes apply automatically.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <label className="block">
            <FieldLabel hint="What residents see when choosing their ID (example: Barangay ID)">
              Name of this proof
            </FieldLabel>
            <Input
              value={nameValue}
              onChange={(event) => {
                const value = event.target.value
                // Single source of truth: keep name and template_name in sync every keystroke
                // (empty string allowed — no snap-back while typing).
                onChange({ name: value, template_name: value })
              }}
              onBlur={() => onBlurSave?.()}
              className={cn("h-10 font-bold", PROOF_THEME.title)}
              placeholder="e.g. Barangay ID, Utility bill"
            />
          </label>
          <label className="block">
            <FieldLabel hint="Shown under the name when residents choose their document">
              Description for sign-up
            </FieldLabel>
            <textarea
              value={document.description || ""}
              onChange={(event) =>
                onChange({ description: event.target.value.slice(0, 255) })
              }
              onBlur={() => onBlurSave?.()}
              rows={2}
              maxLength={255}
              className="min-h-[4.5rem] w-full resize-y rounded-lg border border-[#cbd8ee] bg-white px-3 py-2 text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8] focus:border-[#145be7] focus-visible:ring-[3px] focus-visible:ring-[#145be7]/20"
              placeholder="e.g. Barangay-issued resident identification card."
            />
            <span className={cn("mt-1 block text-[11px] font-semibold", PROOF_THEME.muted)}>
              {(document.description || "").length}/255 · Example on sign-up: “Choose your document”
            </span>
          </label>
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-dashed border-[#cbd8ee] bg-[#f8fafc] p-4">
            <p className={cn("text-[11px] font-black uppercase tracking-wide", PROOF_THEME.muted)}>
              Sign-up preview
            </p>
            <p className={cn("mt-2 text-sm font-black", PROOF_THEME.title)}>Choose your document</p>
            <p className={cn("mt-0.5 text-xs font-semibold", PROOF_THEME.body)}>
              Select the ID or bill you will capture or upload. We will verify it against the
              approved Barangay templates.
            </p>
            <div
              className={cn(
                "mt-3 flex items-start gap-3 rounded-2xl border bg-white p-4",
                document.enabled !== false ? "border-[#dfe7f5]" : "border-amber-200 opacity-70",
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#145be7]">
                <IdCard className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-black", PROOF_THEME.title)}>
                  {document.template_name || document.name || "Proof name"}
                </span>
                <span className={cn("mt-0.5 block text-xs font-semibold", PROOF_THEME.muted)}>
                  {document.description?.trim() ||
                    (needsBoth
                      ? "Front and back required — you will capture both"
                      : "One clear photo of the document")}
                </span>
                {document.enabled === false ? (
                  <span className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                    Hidden — not shown to residents
                  </span>
                ) : (
                  <span className="mt-2 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    Visible on sign-up
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <FieldLabel hint="How many photos a resident must take of this proof">
          Photos required at sign-up
        </FieldLabel>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                id: "one" as const,
                label: "Front only",
                hint: "Resident uploads one clear photo — works for bills, certificates, and IDs that only need one side",
              },
              {
                id: "both" as const,
                label: "Front and back",
                hint: "Resident takes two photos — front of the ID first, then the back",
              },
            ] as const
          ).map((option) => {
            const selected = option.id === "both" ? needsBoth : !needsBoth
            const blockedByTwoSamples = !selected && samplePhotoCount >= 2
            return (
              <label
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3.5 text-left transition",
                  selected
                    ? "border-[#145be7] bg-blue-50/60 ring-1 ring-[#145be7]/25"
                    : blockedByTwoSamples
                      ? "cursor-not-allowed border-[#dfe7f5] bg-[#f1f4f9] opacity-70"
                      : "border-[#dfe7f5] bg-[#f8fafc] hover:border-[#cbd8ee] hover:bg-white",
                )}
              >
                <input
                  type="radio"
                  name="capture-sides"
                  className="mt-1 accent-[#145be7]"
                  checked={selected}
                  disabled={blockedByTwoSamples}
                  onChange={() => {
                    if (onChangeCaptureMode) {
                      onChangeCaptureMode(option.id)
                      return
                    }
                    if (option.id === "both") {
                      onChange({
                        required_sides: ["front", "back"],
                        min_files: 2,
                        max_files: 2,
                      })
                    } else {
                      onChange({
                        required_sides: ["single"],
                        min_files: 1,
                        max_files: 1,
                      })
                    }
                  }}
                />
                <span>
                  <span className={cn("block text-sm font-black", PROOF_THEME.title)}>
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] font-semibold leading-4",
                      PROOF_THEME.muted,
                    )}
                  >
                    {option.hint}
                  </span>
                  {blockedByTwoSamples ? (
                    <span className="mt-1 block text-[11px] font-bold text-amber-800">
                      Remove one sample photo first to switch.
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
      </div>
    </section>
  )
}
