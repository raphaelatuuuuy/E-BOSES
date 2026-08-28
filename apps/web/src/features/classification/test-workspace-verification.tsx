import { useEffect, useMemo, useRef, useState } from "react"
import { AlignLeftIcon, Ban, CircleCheck, LoaderCircleIcon, TriangleAlert, UploadCloudIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import {
  getOcrDraft,
  fetchTemplateSampleBlob,
  runOcrTest,
  type OcrDocumentType,
  type OcrTestResult,
  type ProofSide,
} from "@/features/ocr/api"
import { RuleMenu } from "./shared"

type Finding = {
  icon: typeof CircleCheck
  tone: "good" | "warn" | "bad" | "muted"
  text: string
}

const FINDING_TONE: Record<Finding["tone"], string> = {
  good: "text-green-600",
  warn: "text-amber-500",
  bad: "text-sos",
  muted: "text-neutral-400",
}

function ResultLabel({ children }: { children: string }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{children}</p>
}

function sideLabel(side: ProofSide) {
  return side === "front" ? "Front" : side === "back" ? "Back" : "Single image"
}

function formatVerdictSentence(verdict: string) {
  switch (verdict) {
    case "format_matches":
      return "It matches the configured document template."
    case "format_mismatch":
      return "It does not match the configured document template."
    case "no_reference":
      return "There is no configured sample to compare it against."
    default:
      return "The template comparison was inconclusive."
  }
}

function integrityVerdictSentence(verdict: string) {
  switch (verdict) {
    case "authentic":
      return "The picture looks like a genuine camera photo."
    case "suspected_edit":
      return "The picture shows signs of editing."
    case "suspected_ai":
      return "The picture shows signs of being AI-generated."
    case "impossible_content":
      return "The picture shows content that doesn't add up."
    case "photo_of_screen":
      return "The picture looks like a photo of a screen, not the physical card."
    default:
      return "The picture's authenticity could not be determined."
  }
}

function resultLabel(result: OcrTestResult) {
  if (result.status === "passed") return "Verification passed"
  if (result.status === "warning") return "Passed with warnings"
  if (result.status === "failed") return "Verification needs attention"
  return "Verification could not be completed"
}

function resultHeaderMeta(result: OcrTestResult) {
  if (result.status === "passed") return { icon: CircleCheck, tone: "text-green-600" }
  if (result.status === "warning") return { icon: TriangleAlert, tone: "text-amber-500" }
  if (result.status === "failed") return { icon: Ban, tone: "text-sos" }
  return { icon: TriangleAlert, tone: "text-amber-500" }
}

function pictureChecks(result: OcrTestResult) {
  const checks = result.id_integrity_checks?.length
    ? result.id_integrity_checks
    : result.pipeline?.integrity_checks?.length
      ? result.pipeline.integrity_checks
      : result.id_integrity
        ? [result.id_integrity]
        : []
  return checks.filter((check) => check.checked && check.format_verdict && check.integrity_verdict)
}

function sampleForSide(document: OcrDocumentType | undefined, side: ProofSide) {
  if (!document) return null
  const samples = document.samples ?? []
  return (
    samples.find((sample) => sample.side === side && sample.url) ??
    (side === "front" ? samples.find((sample) => sample.side === "single" && sample.url) : null) ??
    (side === "single" ? samples.find((sample) => sample.side === "front" && sample.url) : null) ??
    ((side === "front" || side === "single") && document.sample_url
      ? { side, url: document.sample_url, filename: document.sample_original_filename }
      : null)
  )
}

export function VerificationTestWorkspace() {
  const [documents, setDocuments] = useState<OcrDocumentType[]>([])
  const [documentKey, setDocumentKey] = useState("")
  const [side, setSide] = useState<ProofSide>("single")
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<OcrTestResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file])
  const selectedDocument = documents.find((item) => item.key === documentKey)
  const sides = selectedDocument?.required_sides?.length ? selectedDocument.required_sides : ["single" as ProofSide]
  const templateSample = sampleForSide(selectedDocument, side)
  const [templateState, setTemplateState] = useState({ url: "", preview: "", error: false })
  const templatePreview = templateState.url === templateSample?.url ? templateState.preview : ""
  const templateLoading = Boolean(templateSample?.url) && templateState.url !== templateSample?.url
  const templateError = templateState.url === templateSample?.url && templateState.error
  const [lightbox, setLightbox] = useState<string | null>(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  useEffect(() => {
    let cancelled = false
    let objectUrl = ""
    if (!templateSample?.url) return

    void fetchTemplateSampleBlob(templateSample.url)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setTemplateState({ url: templateSample.url, preview: objectUrl, error: false })
      })
      .catch(() => {
        if (!cancelled) setTemplateState({ url: templateSample.url, preview: "", error: true })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [templateSample?.url])

  useEffect(() => {
    let cancelled = false
    void getOcrDraft()
      .then((configuration) => {
        if (cancelled) return
        const enabled = configuration.document_types.filter((item) => item.enabled)
        setDocuments(enabled)
        setDocumentKey(enabled[0]?.key ?? "")
        const firstSide = enabled[0]?.required_sides?.[0]
        if (firstSide) setSide(firstSide)
      })
      .catch((error) => toast.error(describeApiError(error, "Configured verification documents could not be loaded.")))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const findings: Finding[] = []
  if (result) {
    findings.push({ icon: AlignLeftIcon, tone: "muted", text: `Checked as ${sideLabel(side)}.` })
    for (const check of pictureChecks(result)) {
      const sideText = check.side ? `${String(check.side).replace(/^./, (value) => value.toUpperCase())} side` : "Document"
      const verdictText = check.flagged
        ? check.format_verdict === "format_mismatch"
          ? "Template mismatch"
          : "Picture check failed"
        : check.integrity_advisory
          ? "Picture warning"
          : "Passed"
      findings.push({
        icon: check.flagged ? Ban : check.integrity_advisory ? TriangleAlert : CircleCheck,
        tone: check.flagged ? "bad" : check.integrity_advisory ? "warn" : "good",
        text: `${sideText}: ${verdictText}.`,
      })
      findings.push({
        icon: check.format_verdict === "format_mismatch" ? Ban : CircleCheck,
        tone: check.format_verdict === "format_mismatch" ? "bad" : check.format_verdict === "format_matches" ? "good" : "muted",
        text: formatVerdictSentence(check.format_verdict),
      })
      findings.push({
        icon: check.integrity_verdict === "authentic" ? CircleCheck : TriangleAlert,
        tone: check.integrity_verdict === "authentic" ? "good" : check.integrity_verdict === "inconclusive" ? "muted" : "warn",
        text: integrityVerdictSentence(check.integrity_verdict),
      })
      if (check.feedback) {
        findings.push({ icon: Ban, tone: "bad", text: check.feedback })
      }
    }
    if (result.pipeline?.blocked_by === "media_forensics") {
      // The picture check never ran here — the file check stopped the
      // submission first (e.g. embedded AI-generation or edit metadata), so
      // saying the picture check "did not complete" would blame the wrong
      // stage and read like a connectivity problem instead of a rejection.
      findings.push({
        icon: Ban,
        tone: "bad",
        text: result.pipeline.forensics?.message || result.pipeline.detail || "The file check rejected this image before the picture check could run.",
      })
    } else if (result.pipeline?.integrity_checked === false) {
      findings.push({
        icon: TriangleAlert,
        tone: "warn",
        text: "The picture and template check did not complete. Check the vision-model connection before relying on this result.",
      })
    }
  }
  const { icon: ResultHeaderIcon, tone: headerTone } = result
    ? resultHeaderMeta(result)
    : { icon: CircleCheck, tone: "text-green-600" }

  function chooseDocument(key: string) {
    setDocumentKey(key)
    const next = documents.find((item) => item.key === key)
    const nextSide = next?.required_sides?.[0] ?? "single"
    setSide(nextSide)
    setResult(null)
  }

  async function runTest() {
    if (!file || !documentKey) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await runOcrTest(file, documentKey, side))
    } catch (error) {
      toast.error(describeApiError(error, "The verification sample could not be processed."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {loading ? (
        <div className="flex justify-center py-10"><LoaderCircleIcon className="size-6 animate-spin text-brand-navy" /></div>
      ) : documents.length === 0 ? (
        <div className="rounded-[16px] border border-amber-200 bg-amber-50 p-4 text-[13px] leading-relaxed text-amber-900">
          No verification documents are configured yet. Add a document in ID &amp; proof setup first.
        </div>
      ) : (
        <>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Configured document</label>
            <RuleMenu
              full
              value={documentKey}
              options={documents.map((document) => ({ value: document.key, label: document.name }))}
              onChange={chooseDocument}
            />
          </div>

          {sides.length > 1 ? (
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Image side</label>
              <RuleMenu
                full
                value={side}
                options={sides.map((item) => ({ value: item, label: sideLabel(item) }))}
                onChange={(value) => { setSide(value as ProofSide); setResult(null) }}
              />
            </div>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0]
              if (picked) { setFile(picked); setResult(null) }
              event.target.value = ""
            }}
          />

          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Image to compare</label>
            {preview ? (
              <div className="relative w-40">
                <img src={preview} alt="Verification sample" className="aspect-[4/3] w-full rounded-xl border border-neutral-200 object-cover" />
                <button
                  type="button"
                  onClick={() => { setFile(null); setResult(null) }}
                  aria-label="Remove verification sample"
                  className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-neutral-800/60 text-white hover:bg-neutral-800/80"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex aspect-[3/1] w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-neutral-100 text-center transition-colors hover:bg-neutral-200"
              >
                <UploadCloudIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
                <span className="text-[13px] font-medium text-neutral-500">Add an image to compare</span>
              </button>
            )}
          </div>

          <SheetPrimaryButton
            type="button"
            onClick={() => void runTest()}
            disabled={!file || !documentKey || busy}
            className="bg-brand-navy text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
          >
            {busy ? "Checking…" : "Check this image"}
          </SheetPrimaryButton>
        </>
      )}

      {result ? (
        <SheetDialog
          open
          onClose={() => setResult(null)}
          title="Verification result"
          description="This is a test result. No account verification was changed."
          size="wide"
          bodyClassName="pb-5"
        >
          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-start gap-3">
                <ResultHeaderIcon className={cn("mt-0.5 size-5 shrink-0", headerTone)} strokeWidth={2} aria-hidden />
                <div className="min-w-0">
                  <p className="text-[16px] font-semibold leading-snug text-neutral-900">{resultLabel(result)}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-neutral-600">
                    {(selectedDocument?.name ? `${selectedDocument.name}. ` : "") +
                      (result.error || result.pipeline?.message || "The configured document rules were run against this image.")}
                  </p>
                </div>
              </div>

              {findings.length ? (
                <ul className="space-y-1.5 pl-8">
                  {findings.map((finding, index) => (
                    <li key={index} className="flex gap-2 text-[13.5px] leading-relaxed text-neutral-700">
                      <finding.icon className={cn("mt-0.5 size-4 shrink-0", FINDING_TONE[finding.tone])} strokeWidth={2} aria-hidden />
                      <span className="min-w-0 break-words">{finding.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div>
              <div className="mb-2"><ResultLabel>Image comparison</ResultLabel></div>
              <div className="flex flex-wrap justify-center gap-4">
                {preview ? (
                  <VerificationPhotoTile src={preview} label="Submitted image" onExpand={() => setLightbox(preview)} />
                ) : null}
                {templatePreview ? (
                  <VerificationPhotoTile
                    src={templatePreview}
                    label="Configured sample"
                    onExpand={() => setLightbox(templatePreview)}
                  />
                ) : (
                  <div className="flex w-56 items-center justify-center rounded-[14px] border border-dashed border-neutral-200 bg-neutral-50 px-4 py-12 text-center sm:w-72">
                    <p className="text-[13px] leading-relaxed text-neutral-400">
                      {templateLoading ? "Loading configured sample…" : templateError ? "Configured sample could not be opened." : "No configured sample available."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {lightbox ? (
              <div
                className="fixed inset-0 z-[2000] flex items-center justify-center bg-neutral-950/85 p-6"
                role="button"
                tabIndex={-1}
                onClick={() => setLightbox(null)}
              >
                <img src={lightbox} alt="Full-size verification image" className="max-h-full max-w-full rounded-lg object-contain" />
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  aria-label="Close preview"
                  className="absolute right-5 top-5 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
                >
                  <XIcon className="size-5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </SheetDialog>
      ) : null}
    </div>
  )
}

function VerificationPhotoTile({ src, label, onExpand }: { src: string; label: string; onExpand: () => void }) {
  return (
    <div className="w-56 sm:w-72">
      <button
        type="button"
        onClick={onExpand}
        className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[14px] border border-neutral-200 bg-neutral-50"
      >
        <img src={src} alt={label} className="size-full object-contain p-2 transition-opacity group-hover:opacity-80" />
      </button>
      <p className="mt-1.5 truncate text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400" title={label}>
        {label}
      </p>
    </div>
  )
}
