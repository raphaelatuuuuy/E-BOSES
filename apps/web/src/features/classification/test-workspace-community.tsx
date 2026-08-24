import { useState } from "react"
import { Ban, CircleCheck, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"

import {
  testCommunityModeration,
  generateCommunitySampleContent,
  CONTENT_FLAG_REASON_OPTIONS,
  type CommunityModerationResult,
  type ContentFlagReason,
  type SampleLanguage,
} from "./api"
import { RuleMenu } from "./shared"

const ASSESSMENT_META: Record<CommunityModerationResult["assessment"], { icon: typeof Ban; tone: string; label: string }> = {
  clearly_violates: { icon: Ban, tone: "text-sos", label: "Recommended: Take down" },
  borderline: { icon: TriangleAlert, tone: "text-amber-500", label: "Borderline — hold for review" },
  likely_acceptable: { icon: CircleCheck, tone: "text-green-600", label: "Recommended: Dismiss" },
}

const SAMPLE_LANGUAGE_OPTIONS: { value: SampleLanguage; label: string }[] = [
  { value: "filipino", label: "Filipino" },
  { value: "english", label: "English" },
  { value: "hybrid", label: "Taglish" },
  { value: "bisaya", label: "Bisaya" },
  { value: "ilocano", label: "Ilocano" },
  { value: "hiligaynon", label: "Hiligaynon" },
  { value: "kapampangan", label: "Kapampangan" },
  { value: "waray", label: "Waray" },
]

export function CommunityModerationTestWorkspace() {
  const [contentText, setContentText] = useState("")
  const [reason, setReason] = useState<ContentFlagReason>("abusive")
  const [sampleLanguage, setSampleLanguage] = useState<SampleLanguage>("filipino")
  const [generating, setGenerating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CommunityModerationResult | null>(null)

  const canCheck = contentText.trim().length > 0

  async function runTest() {
    if (!contentText.trim()) return
    setBusy(true)
    setResult(null)
    try {
      setResult(
        await testCommunityModeration({
          content_text: contentText.trim(),
          reason,
        }),
      )
    } catch (error) {
      toast.error(describeApiError(error, "The sample content could not be checked."))
    } finally {
      setBusy(false)
    }
  }

  async function generateSample() {
    if (generating) return
    setGenerating(true)
    setResult(null)
    try {
      const { description } = await generateCommunitySampleContent({ reason, language: sampleLanguage })
      setContentText(description)
    } catch (error) {
      toast.error(describeApiError(error, "The sample could not be generated."))
    } finally {
      setGenerating(false)
    }
  }

  const meta = result ? ASSESSMENT_META[result.assessment] : null

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Flagged content</label>
        <textarea
          value={contentText}
          onChange={(event) => {
            setContentText(event.target.value)
            setResult(null)
          }}
          maxLength={2000}
          placeholder="Paste the comment or post text being flagged."
          className="h-28 w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white p-4 text-[15px] font-medium text-neutral-900 outline-none transition-colors focus:border-neutral-500"
        />
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-3">
          <span className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generateSample()}
              disabled={generating}
              className="text-xs font-medium text-neutral-700 transition-opacity hover:opacity-75 disabled:opacity-60"
            >
              {generating ? "Generating…" : "Generate sample content"}
            </button>
            <RuleMenu
              className="border-transparent bg-transparent hover:border-transparent"
              value={sampleLanguage}
              options={SAMPLE_LANGUAGE_OPTIONS}
              onChange={(value) => setSampleLanguage(value as SampleLanguage)}
            />
          </span>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Reporter's selected reason</label>
        <RuleMenu
          full
          value={reason}
          options={CONTENT_FLAG_REASON_OPTIONS}
          onChange={(value) => setReason(value as ContentFlagReason)}
        />
      </div>

      <SheetPrimaryButton
        type="button"
        onClick={() => void runTest()}
        disabled={!canCheck || busy}
        className="bg-brand-navy text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
      >
        {busy ? "Checking…" : "Check this sample"}
      </SheetPrimaryButton>

      {result && meta ? (
        <div className="space-y-4 border-t border-neutral-200 pt-5">
          <div className="flex items-start gap-3">
            <meta.icon className={`mt-0.5 size-5 shrink-0 ${meta.tone}`} strokeWidth={2} aria-hidden />
            <div>
              <p className="text-[16px] font-bold leading-snug text-neutral-900">{meta.label}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{result.short_explanation}</p>
            </div>
          </div>
          <div className="rounded-[14px] border border-neutral-200 bg-neutral-50 p-4">
            <p className="text-[13px] font-medium leading-relaxed text-neutral-600">
              No automatic message for this domain yet — community moderation stays a staff decision. This preview
              only shows what the model would recommend, for a human to confirm or override.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
