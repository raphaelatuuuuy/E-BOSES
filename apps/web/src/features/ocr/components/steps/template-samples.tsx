import { Play } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { ProofSide } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

function sideLabel(side: ProofSide) {
  if (side === "front") return "Front"
  if (side === "back") return "Back"
  return "Sample"
}

interface TemplateSamplesProps {
  templateSamples: Array<{ side: ProofSide; url: string }>
  canvasSides: ProofSide[]
  testRunning: boolean
  onRunTestFromSample: (side: ProofSide) => void
}

export function TemplateSamples({
  templateSamples,
  canvasSides,
  testRunning,
  onRunTestFromSample,
}: TemplateSamplesProps) {
  if (templateSamples.length === 0) {
    return (
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-900">
        No template sample yet. Go back to Mark areas and upload the front
        {canvasSides.includes("back") ? " (and back if required)" : ""} photo first.
      </div>
    )
  }

  return (
    <div className="mb-5 rounded-2xl border border-[#dfe7f5] bg-[#f8fafc] p-3 md:p-4">
      <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>
        Template sample from Mark areas
      </p>
      <p className={cn("mb-3 text-[11px] font-semibold", PROOF_THEME.muted)}>
        Use the photo you marked boxes on — no need to re-upload.
      </p>
      <div
        className={cn(
          "grid gap-2",
          templateSamples.length > 1 ? "sm:grid-cols-2" : "grid-cols-1",
        )}
      >
        {templateSamples.map(({ side, url }) => (
          <div
            key={side}
            className="flex items-center gap-3 rounded-xl border border-[#dfe7f5] bg-white p-2.5"
          >
            <img
              src={url}
              alt={`${sideLabel(side)} sample`}
              className="h-16 w-20 shrink-0 rounded-lg border border-[#e8eef8] object-contain"
            />
            <div className="min-w-0 flex-1">
              <p className={cn("text-xs font-black", PROOF_THEME.title)}>
                {sideLabel(side)}
              </p>
              <p className={cn("text-[11px] font-semibold", PROOF_THEME.muted)}>
                Ready to test
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              className={cn("shrink-0 font-bold text-white", PROOF_THEME.primaryBg)}
              disabled={testRunning}
              onClick={() => onRunTestFromSample(side)}
            >
              <Play className="size-3.5" />
              {testRunning ? "Reading…" : "Test"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
