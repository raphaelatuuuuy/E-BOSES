import { useState } from "react"
import { Ban, CircleCheck, ImagePlus, TriangleAlert, XIcon } from "lucide-react"
import { toast } from "sonner"

import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
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
  const [image, setImage] = useState<File | null>(null)
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
          image,
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
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Image attached to the post or comment <span className="font-normal text-neutral-400">(optional)</span></label>
        {image ? (
          <div className="flex items-center justify-between rounded-[14px] border border-neutral-200 bg-neutral-50 px-3.5 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <ImagePlus className="size-4 shrink-0 text-neutral-500" aria-hidden />
              <span className="truncate text-[13px] font-medium text-neutral-700">{image.name}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setImage(null)
                setResult(null)
              }}
              className="ml-3 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-white hover:text-neutral-800"
              aria-label="Remove image"
              title="Remove image"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          </div>
        ) : (
          <label className="flex cursor-pointer items-center gap-2 rounded-[14px] border border-dashed border-neutral-300 px-3.5 py-3 text-[13px] font-medium text-neutral-600 transition-colors hover:border-neutral-500 hover:bg-neutral-50">
            <ImagePlus className="size-4 text-neutral-500" aria-hidden />
            Add an image so the check can review the post and its photo
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                setImage(event.target.files?.[0] ?? null)
                setResult(null)
                event.currentTarget.value = ""
              }}
            />
          </label>
        )}
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
        <SheetDialog
          open
          onClose={() => setResult(null)}
          title="Community content result"
          description="This is a test result. No post or comment was changed."
          size="wide"
          bodyClassName="pb-5"
        >
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              <meta.icon className={`mt-0.5 size-5 shrink-0 ${meta.tone}`} strokeWidth={2} aria-hidden />
              <div>
                <p className="text-[16px] font-bold leading-snug text-neutral-900">{meta.label}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{result.short_explanation}</p>
              </div>
            </div>
            <div className="rounded-[14px] border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">How the system acted</p>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-700">
                The model compared the flagged post or comment with the selected reason and returned a recommendation. No automatic reply is sent, and no content is removed from this preview.
              </p>
            </div>
            <dl className="grid gap-3 rounded-[14px] border border-neutral-200 p-4 sm:grid-cols-2">
              <div><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Model</dt><dd className="mt-1 text-[13px] font-semibold text-neutral-900">{result.model_version || "Configured model"}</dd></div>
              <div><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Human control</dt><dd className="mt-1 text-[13px] font-semibold text-neutral-900">Staff confirms or overrides</dd></div>
              {result.image_review ? (
                <div><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Image check</dt><dd className="mt-1 text-[13px] font-semibold text-neutral-900">{result.image_review.status.replaceAll("_", " ")}</dd></div>
              ) : null}
            </dl>
            <div className="rounded-[14px] border border-amber-200 bg-amber-50 p-4">
              <p className="text-[13px] font-medium leading-relaxed text-amber-900">
                This is an automatic first check, not a final staff decision. An official can dismiss the recommendation or take the action after reviewing the content.
              </p>
            </div>
          </div>
        </SheetDialog>
      ) : null}
    </div>
  )
}
