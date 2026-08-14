import { IdCard } from "lucide-react"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block">
      <span className={cn("block text-xs font-semibold", PROOF_THEME.title)}>{children}</span>
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
    <section className="p-1">
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-7">
          <label className="block">
            <FieldLabel>Name</FieldLabel>
            <Input
              value={nameValue}
              onChange={(event) => {
                const value = event.target.value
                // Single source of truth: keep name and template_name in sync every keystroke
                // (empty string allowed — no snap-back while typing).
                onChange({ name: value, template_name: value })
              }}
              onBlur={() => onBlurSave?.()}
              className={cn("h-10 font-semibold", PROOF_THEME.title)}
              placeholder="e.g. Barangay ID, Utility bill"
            />
          </label>

          <label className="block">
            <FieldLabel>Description</FieldLabel>
            <Input
              value={document.description ?? ""}
              onChange={(event) => {
                onChange({ description: event.target.value })
              }}
              onBlur={() => onBlurSave?.()}
              className={cn("h-10 font-semibold", PROOF_THEME.muted)}
              placeholder="e.g. Government-issued ID with your photo"
              maxLength={255}
            />
          </label>
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-dashed border-line-tint bg-canvas p-4">
            <p className={cn("text-[11px] font-semibold uppercase tracking-wide", PROOF_THEME.muted)}>
              Sign-up preview
            </p>
            <p className={cn("mt-2 text-sm font-semibold", PROOF_THEME.title)}>
              {nameValue.trim() || "Proof type name"}
            </p>
            <div
              className={cn(
                "mt-3 flex items-start gap-3 rounded-2xl border bg-white p-4",
                document.enabled !== false ? "border-line-tint" : "border-neutral-200 opacity-70",
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-blue">
                <IdCard className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block font-semibold", PROOF_THEME.title)}>
                  {document.template_name || document.name || "Proof name"}
                </span>
                <span className={cn("mt-0.5 block text-xs font-semibold", PROOF_THEME.muted)}>
                  {document.description?.trim() ||
                    (needsBoth
                      ? "Front and back required. You will capture both."
                      : "One clear photo of the document")}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <FieldLabel>Photos required at sign-up</FieldLabel>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                id: "one" as const,
                label: "Front only",
                hint: "Resident uploads one clear photo. Works for bills, certificates, and IDs that only need one side.",
              },
              {
                id: "both" as const,
                label: "Front and back",
                hint: "Resident takes two photos. Front of the ID first, then the back.",
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
                    ? "border-brand-blue bg-tint/60 ring-1 ring-brand-blue/25"
                    : blockedByTwoSamples
                      ? "cursor-not-allowed border-line-tint bg-canvas opacity-70"
                      : "border-line-tint bg-canvas hover:border-line-tint hover:bg-white",
                )}
              >
                <input
                  type="radio"
                  name="capture-sides"
                  className="mt-1 accent-brand-blue"
                  checked={selected}
                  disabled={blockedByTwoSamples}
                  onChange={() => onChangeCaptureMode?.(option.id)}
                />
                <span>
                  <span className={cn("block text-sm font-semibold", PROOF_THEME.title)}>
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
                    <span className="mt-1 block text-[11px] font-bold text-foreground">
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