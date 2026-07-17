import type { ReactNode } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, Check, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType } from "@/features/ocr/api"
import type { WizardStepId } from "@/features/ocr/hooks/use-ocr-template-state"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

const STEPS = [
  { id: 1 as const, label: "Proof details" },
  { id: 2 as const, label: "Mark areas" },
  { id: 3 as const, label: "Rules" },
  { id: 4 as const, label: "Try a sample" },
]

function documentHasSample(doc: OcrDocumentType): boolean {
  const sides = doc.required_sides?.length ? doc.required_sides : ["single"]
  const required =
    sides.includes("front") && sides.includes("back")
      ? (["front", "back"] as const)
      : sides.includes("back")
        ? (["back"] as const)
        : sides.includes("front")
          ? (["front"] as const)
          : (["single"] as const)
  const listed = doc.samples ?? []
  return required.every((side) => {
    if (listed.some((sample) => sample.side === side && Boolean(sample.url))) return true
    if (
      (side === "front" || side === "single") &&
      (doc.sample_url ||
        listed.some(
          (sample) =>
            (sample.side === "front" || sample.side === "single") && Boolean(sample.url),
        ))
    ) {
      return true
    }
    return false
  })
}

export function ProofSetupWizard(props: {
  document: OcrDocumentType
  step: WizardStepId
  saving: boolean
  onStepChange: (step: WizardStepId) => void
  onBackToList: () => void
  onDone: () => void
  children: ReactNode
  availableEnabled: boolean
  onToggleAvailable: (enabled: boolean) => void
  /** Return false to block leaving Mark areas without required samples. */
  onValidateBeforeNext?: (fromStep: WizardStepId) => boolean
  /** Missing required sample sides (front / back) for footer messaging. */
  missingSampleSides?: string[]
}) {
  const {
    document,
    step,
    saving,
    onStepChange,
    onBackToList,
    onDone,
    children,
    availableEnabled,
    onToggleAvailable,
    onValidateBeforeNext,
    missingSampleSides = [],
  } = props

  const displayName =
    document.template_name?.trim() || document.name?.trim() || "Untitled proof type"
  const showSampleTip = step === 2 && (!documentHasSample(document) || missingSampleSides.length > 0)

  function goBack() {
    if (step <= 1) return
    onStepChange((step - 1) as WizardStepId)
  }

  function goNext() {
    if (step >= 4) return
    if (onValidateBeforeNext && !onValidateBeforeNext(step)) return
    onStepChange((step + 1) as WizardStepId)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto w-full max-w-[1700px] flex-1 space-y-5 p-4 pb-28 md:p-7 md:pb-32">
        <header className="min-w-0">
          <button
            type="button"
            onClick={onBackToList}
            className={cn(
              "mb-3 inline-flex items-center gap-1.5 text-sm font-bold transition hover:text-[#145be7]",
              PROOF_THEME.muted,
            )}
          >
            <ArrowLeft className="size-4" />
            All proof types
          </button>
          <p className={cn("text-xs font-bold uppercase tracking-wide", PROOF_THEME.muted)}>
            Set up proof type
          </p>
          <h1 className={cn("mt-1 text-2xl font-black md:text-3xl", PROOF_THEME.title)}>
            {displayName}
          </h1>
          {saving ? (
            <p className={cn("mt-2 inline-flex items-center gap-2 text-xs font-bold", PROOF_THEME.muted)}>
              <LoaderCircle className="size-3.5 animate-spin text-[#145be7]" />
              Updating sign-up…
            </p>
          ) : null}
        </header>

        {/* Progress pills */}
        <nav aria-label="Setup steps" className="overflow-x-auto">
          <ol className="flex min-w-max items-center gap-2 sm:gap-3">
            {STEPS.map((item, index) => {
              const active = item.id === step
              const completed = item.id < step
              return (
                <li key={item.id} className="flex items-center gap-2 sm:gap-3">
                  {index > 0 ? (
                    <span
                      className={cn(
                        "hidden h-px w-4 sm:block sm:w-6",
                        completed || active ? "bg-[#145be7]/40" : "bg-[#dfe7f5]",
                      )}
                      aria-hidden
                    />
                  ) : null}
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition sm:text-sm",
                      active &&
                        "border-[#145be7] bg-[#145be7] text-white shadow-sm shadow-blue-200/60",
                      completed &&
                        !active &&
                        "border-[#b7cefb] bg-[#e8f0ff] text-[#145be7]",
                      !active &&
                        !completed &&
                        "border-[#dfe7f5] bg-white text-[#68739c]",
                    )}
                    aria-current={active ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                        active && "bg-white/20 text-white",
                        completed && !active && "bg-[#145be7] text-white",
                        !active && !completed && "bg-[#f2f6ff] text-[#68739c]",
                      )}
                    >
                      {completed && !active ? <Check className="size-3.5" strokeWidth={3} /> : item.id}
                    </span>
                    <span className="whitespace-nowrap">{item.label}</span>
                  </div>
                </li>
              )
            })}
          </ol>
          <p className={cn("mt-2 text-xs font-semibold", PROOF_THEME.muted)}>
            Step {step} of {STEPS.length}
          </p>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>

      {/* Sticky footer */}
      <footer
        className={cn(
          "sticky bottom-0 z-30 border-t bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90",
          PROOF_THEME.border,
        )}
      >
        <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-3 px-4 py-3 md:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="font-bold"
              disabled={step === 1}
              onClick={goBack}
            >
              <ChevronLeft className="size-4" />
              Back
            </Button>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {step < 4 ? (
                <Button
                  type="button"
                  className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
                  onClick={goNext}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              ) : (
                <>
                  <label className="flex items-center gap-2 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] px-3 py-2 text-xs font-semibold">
                    <Switch
                      checked={availableEnabled}
                      disabled={saving}
                      onCheckedChange={onToggleAvailable}
                    />
                    <span className="min-w-0">
                      <span className={cn("block font-black", PROOF_THEME.title)}>
                        {availableEnabled ? "Available on sign-up" : "Hidden from sign-up"}
                      </span>
                      <span className={cn("mt-0.5 block text-[11px] font-semibold", PROOF_THEME.muted)}>
                        {saving
                          ? "Updating resident list…"
                          : availableEnabled
                            ? "Residents can pick this document now"
                            : "Turn on to show this on resident registration"}
                      </span>
                    </span>
                  </label>
                  <Button
                    type="button"
                    className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
                    onClick={onDone}
                  >
                    Done
                  </Button>
                </>
              )}
            </div>
          </div>

          {showSampleTip ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              {missingSampleSides.length > 0
                ? `Upload required sample photo${missingSampleSides.length > 1 ? "s" : ""}: ${missingSampleSides.join(" and ")}.`
                : "Tip: upload a clear sample photo so you can mark areas."}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
