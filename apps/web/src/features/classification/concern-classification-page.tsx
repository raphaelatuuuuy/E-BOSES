import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BrainCircuitIcon,
  LoaderCircleIcon,
  SaveIcon,
  TestTube2Icon,
  UploadCloudIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigShell } from "@/features/dashboard/components/config/config-shell"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import {
  getConcernClassificationConfig,
  saveConcernClassificationConfig,
  testConcernSubmission,
  type ConcernClassificationConfig,
  type ReportValidationResult,
  type ServiceStatus,
} from "./api"
import {
  applyStrictness,
  detectStrictness,
  MISMATCH_OPTIONS,
  STRICTNESS_PRESETS,
} from "./strictness"

/**
 * How submitted reports are checked before an official sees them.
 *
 * This screen used to ask officials to set an "image confidence threshold" and a
 * "relevance threshold" as decimals, beside a list of 80 COCO class names and a
 * "category mapping" table whose rows read `car → public safety`. That is the
 * vocabulary of a model, not of the person doing barangay work — and the mapping
 * itself was fiction, since COCO's classes have nothing to do with barangay
 * concerns. It is gone: the review model looks at the photo and names what it
 * sees, so there is no table to maintain.
 *
 * What replaces it is an explanation of what the review actually does, and a
 * plain statement of whether each service is currently working.
 */

const defaults: ConcernClassificationConfig = {
  revision: 0,
  text_model: "gemma4:31b",
  text_relevance_threshold: 0.65,
  duplicate_similarity_threshold: 0.85,
  minimum_description_length: 20,
  mismatch_action: "manual_review",
  flag_suspicious: true,
  flag_duplicates: true,
  report_duplicate_detection_enabled: true,
  report_duplicate_action: "warn",
  report_duplicate_lookback_days: 180,
  report_duplicate_distance_meters: 100,
  report_duplicate_similarity_threshold: 0.88,
  report_duplicate_location_precision: 4,
  flag_irrelevant: true,
  notify_reviewer: true,
  suspicious_terms: ["test", "testing", "asdf", "qwerty", "12345"],
  category_keywords: {},
  categories: [],
}

const SERVICE_STATUS_COPY: Record<string, { label: string; dot: string; text: string }> = {
  available: { label: "Working", dot: "bg-status-closed", text: "text-status-closed-ink" },
  limited: { label: "Slow", dot: "bg-severity-moderate", text: "text-severity-moderate-ink" },
  unavailable: { label: "Not working", dot: "bg-severity-critical", text: "text-severity-critical-ink" },
}

function ServiceRow({
  title,
  detail,
  status,
}: {
  title: string
  detail: string
  status: ServiceStatus | undefined
}) {
  const copy = SERVICE_STATUS_COPY[status?.status ?? "unavailable"] ?? SERVICE_STATUS_COPY.unavailable
  return (
    <div className="flex items-center gap-3 rounded-xl border border-card-line bg-canvas px-3 py-3">
      <span className={cn("size-2.5 shrink-0 rounded-full", copy.dot)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span className={cn("shrink-0 text-xs font-semibold", copy.text)}>{copy.label}</span>
    </div>
  )
}

function Card({
  title,
  hint,
  children,
  className = "",
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-2xl border border-card-line bg-card p-4", className)}>
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      {hint ? (
        <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}


/**
 * Badges, not a verdict.
 *
 * This used to be a single banner reading "Approved" or "Flagged". It was
 * wrong twice over: the spec forbids ever presenting the review as Approved,
 * Rejected or a Final Decision, and in practice a sample whose own findings
 * said "the photo shows a person's face and does not show any garbage",
 * "text and photo may not match" and "review the report manually" was crowned
 * with a green Approved. These say what was noticed and nothing more.
 */
function ResultBadges({ result }: { result: ReportValidationResult }) {
  const badges: { label: string; tone: "good" | "warn" | "alert" | "neutral" }[] = []
  if (result.evidence_relationship === "supports_report") badges.push({ label: "Supports report", tone: "good" })
  if (result.evidence_relationship === "partially_supports_report") badges.push({ label: "Supports report in part", tone: "neutral" })
  if (result.evidence_relationship === "contradicts_report") badges.push({ label: "Possible mismatch", tone: "warn" })
  if (result.evidence_relationship === "no_useful_image_evidence") badges.push({ label: "Photo evidence inconclusive", tone: "warn" })
  if (result.evidence_relationship === "image_review_failed") badges.push({ label: "Photo review unavailable", tone: "warn" })
  if (result.evidence_relationship === "image_unavailable") badges.push({ label: "Text-only report", tone: "neutral" })
  if (result.urgent_attention) badges.push({ label: "Urgent attention", tone: "alert" })
  if (result.category_match === false) badges.push({ label: "Needs review", tone: "warn" })
  if (result.duplicate) badges.push({ label: "Possible duplicate", tone: "warn" })

  if (!badges.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-bold",
            badge.tone === "good" && "bg-status-closed-surface text-status-closed-ink",
            badge.tone === "warn" && "bg-severity-moderate-surface text-severity-moderate-ink",
            badge.tone === "alert" && "bg-severity-critical-surface text-severity-critical-ink",
            badge.tone === "neutral" && "bg-canvas text-muted-foreground",
          )}
        >
          {badge.label}
        </span>
      ))}
    </div>
  )
}

/** Mirrors the Privacy Protection wording in the official Review Assistant. */
const SAMPLE_PRIVACY_COPY: Record<string, string> = {
  unchecked:
    "The image could not be checked automatically for sensitive details. Manual privacy review is required.",
  not_required:
    "No sensitive details requiring automatic protection were identified during the initial review.",
  protected: "Sensitive details were protected before public display.",
  sensitive_review_required:
    "Possible sensitive visual content was found. The image should remain restricted until an authorized official reviews it.",
  no_match_found:
    "No matching sensitive region was confirmed. Manual review may still be required.",
  not_configured:
    "Automatic privacy protection is not switched on, so the image would stay restricted pending review.",
  failed:
    "Automatic privacy protection could not be completed. The original image remains restricted pending review.",
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{children}</p>
  )
}


function readable(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not provided"
}

function displayValue(value: string | null | undefined) {
  const normalized = readable(value)
  const labels: Record<string, string> = {
    "needs review": "Needs official review",
    "supports report": "Text and photo match",
    "partially supports report": "Photo partly supports the report",
    "contradicts report": "Text and photo may not match",
    "no useful image evidence": "Photo does not confirm the report",
    "image unavailable": "No photo was submitted",
    "image review failed": "Photo could not be reviewed automatically",
    accept: "Accept and continue processing",
    "accept with privacy review": "Continue using the protected image",
    "manual review": "Review the report manually",
    "request more information": "Request additional details",
    "escalate as emergency": "Notify the appropriate emergency personnel",
    "reject as irrelevant": "Review as a potentially unrelated submission",
  }
  return labels[normalized] ?? normalized
}

function categoryLabel(config: ConcernClassificationConfig, key: string | null | undefined) {
  if (!key) return "Not clear"
  return config.categories.find((category) => category.key === key)?.label ?? readable(key)
}

export default function ConcernClassificationPage() {
  usePageTitle("Report checking")
  const [config, setConfig] = useState<ConcernClassificationConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")

  const [selectedCategory, setSelectedCategory] = useState("infrastructure")
  const [imageFile, setImageFile] = useState<File | null>(null)
  const imagePreview = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : ""),
    [imageFile],
  )
  useEffect(() => {
    if (!imagePreview) return
    return () => URL.revokeObjectURL(imagePreview)
  }, [imagePreview])
  const [description, setDescription] = useState("")
  const [reportResult, setReportResult] = useState<ReportValidationResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void getConcernClassificationConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        const first = next.categories.find((category) => category.enabled)
        if (first) setSelectedCategory(first.key)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load these settings.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])


  const activeCategories = useMemo(
    () => config.categories.filter((category) => category.enabled),
    [config.categories],
  )
  const strictness = detectStrictness(config)

  function update<K extends keyof ConcernClassificationConfig>(
    key: K,
    value: ConcernClassificationConfig[K],
  ) {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setBusy("save")
    try {
      setConfig(await saveConcernClassificationConfig(config))
      toast.success("Settings saved")
    } catch (error) {
      toast.error(describeApiError(error, "Could not save these settings."))
    } finally {
      setBusy("")
    }
  }

  async function runSubmissionTest() {
    if (!description.trim()) return
    setBusy("submission")
    setReportResult(null)
    try {
      setReportResult(
        await testConcernSubmission({
          file: imageFile,
          category: selectedCategory,
          description: description.trim(),
        }),
      )
    } catch (error) {
      toast.error(describeApiError(error, "The sample report could not be checked."))
    } finally {
      setBusy("")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <LoaderCircleIcon className="size-8 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <ConfigShell
      icon={BrainCircuitIcon}
      eyebrow="Intake & routing"
      title="Report checking"
      description="Before a report reaches your queue, the system looks at the photo, reads the description, and checks whether the same thing was already reported. Anything it is unsure about waits for you instead of going straight through."
      stats={[
        {
          label: "Currently set to",
          value:
            STRICTNESS_PRESETS.find((preset) => preset.key === strictness)?.label ?? "Custom",
        },
        { label: "Reports checked", value: config.metrics?.tested ?? 0 },
        { label: "Went straight through", value: config.metrics?.auto_validated ?? 0 },
        { label: "Waited for an official", value: config.metrics?.flagged ?? 0 },
      ]}
      action={
        <Button
          onClick={() => void save()}
          disabled={Boolean(busy)}
          className="rounded-xl bg-accent text-white hover:bg-accent/90"
        >
          <SaveIcon className="size-4" />
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
      }
    >
      {/* The primary control: three named choices instead of four decimals. */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          How strict should checking be?
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {STRICTNESS_PRESETS.map((preset) => {
            const active = strictness === preset.key
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => setConfig(applyStrictness(config, preset.key))}
                aria-pressed={active}
                className={cn(
                  "rounded-2xl border p-4 text-left transition",
                  active
                    ? "border-accent bg-accent/10"
                    : "border-card-line bg-card hover:border-accent/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 rounded-full border-2",
                      active ? "border-accent bg-accent" : "border-card-line",
                    )}
                  />
                  <span className="text-sm font-bold text-foreground">{preset.label}</span>
                </span>
                <span className="mt-2 block text-xs font-semibold text-foreground">
                  {preset.summary}
                </span>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-muted-foreground">
                  {preset.consequence}
                </span>
              </button>
            )
          })}
        </div>
        {!strictness ? (
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            These settings were adjusted by hand. Choosing an option above replaces them.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="When the photo doesn’t match the category"
          hint="A resident files under “Flood” but the photo shows rubbish, for example."
        >
          <div className="grid gap-2">
            {MISMATCH_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 transition",
                  config.mismatch_action === option.value
                    ? "border-accent bg-accent/10"
                    : "border-card-line bg-canvas hover:border-accent/40",
                )}
              >
                <input
                  type="radio"
                  name="mismatch"
                  className="sr-only"
                  checked={config.mismatch_action === option.value}
                  onChange={() => update("mismatch_action", option.value)}
                />
                <span className="block text-sm font-bold text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-xs font-medium text-muted-foreground">
                  {option.hint}
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card
          title="Unsafe or bad-faith content"
          hint="The model checks the report meaning for spam, harassment, threats, sexual content, profanity, fake reports, and irrelevant messages. It no longer depends on a fixed word list."
        >
          <p className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
            Flagged content waits for official review. E-Boses does not automatically reject reports or emergencies from this check alone.
          </p>
        </Card>
      </div>

      <Card
        title="Similar report handling"
        hint="These checks compare a resident's text, category, and pinned location with recent reports. Duplicate photos are still blocked separately."
      >
        <div className="grid gap-2 md:grid-cols-3">
          {[
            ["warn", "Warn resident", "Tell residents a similar report may exist, but let them continue."],
            ["block", "Block repeated reports", "Stop reports that match an existing nearby report."],
            ["official_review", "Allow but flag", "Let residents submit, then show the warning to officials."],
          ].map(([value, label, hint]) => {
            const active = (config.report_duplicate_action ?? "warn") === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => update("report_duplicate_action", value as ConcernClassificationConfig["report_duplicate_action"])}
                className={cn(
                  "rounded-xl border p-3 text-left transition",
                  active ? "border-accent bg-accent/10" : "border-card-line bg-canvas hover:border-accent/40",
                )}
              >
                <span className="block text-sm font-bold text-foreground">{label}</span>
                <span className="mt-1 block text-xs font-medium leading-relaxed text-muted-foreground">{hint}</span>
              </button>
            )
          })}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <input
            type="checkbox"
            checked={config.report_duplicate_detection_enabled !== false}
            onChange={(event) => update("report_duplicate_detection_enabled", event.target.checked)}
          />
          Check for similar reports near the pinned location
        </label>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="How AI reviews reports"
          hint="The review assistant looks at each report before it reaches your queue."
        >
          <ul className="space-y-1.5">
            {[
              "The resident's description",
              "The uploaded photo",
              "The selected category",
              "Possible urgency",
              "Missing information",
              "Possible privacy-sensitive content",
            ].map((item) => (
              <li key={item} className="flex gap-2 text-sm font-medium text-foreground">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
            The assistant recommends a category and a next step. Authorized officials make the final decision.
          </p>
        </Card>

        <Card title="Service status" hint="Whether each part of the review is working right now.">
          <div className="space-y-2">
            <ServiceRow
              title="Report review"
              detail="Checks report text and photo before it reaches you"
              status={config.services?.report_review}
            />
            <ServiceRow
              title="Privacy protection"
              detail="Hides faces and plates in photos before publishing"
              status={config.services?.media_protection}
            />
          </div>
          <p className="mt-3 text-xs font-medium leading-relaxed text-muted-foreground">
            When something is unavailable, reports still arrive normally — they simply wait for your review instead
            of being checked first.
          </p>
        </Card>
      </div>

      {/* The fastest way to understand a setting is to watch it decide on a
          real example, so the testers sit beside the settings rather than
          behind a separate tab. */}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card
          title="Test a sample report"
          hint="Use one resident-style description and an optional photo. Nothing is filed."
        >
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Filed under
          </label>
          <select
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-card-line bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-accent"
          >
            {activeCategories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(event) => {
              setImageFile(event.target.files?.[0] ?? null)
              setReportResult(null)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-3 flex min-h-32 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-card-line bg-canvas p-4 text-center transition hover:border-accent"
          >
            {imagePreview ? (
              <img
                src={imagePreview}
                alt="Selected test photo"
                className="max-h-40 w-full rounded-lg object-contain"
              />
            ) : (
              <>
                <UploadCloudIcon className="size-7 text-accent" />
                <span className="mt-2 text-sm font-bold text-foreground">Choose a photo</span>
                <span className="text-xs font-medium text-muted-foreground">JPG or PNG</span>
              </>
            )}
          </button>

          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["Vehicle sample", "May sasakyang nakaharang sa driveway sa Rosal Street mula kaninang umaga. Hindi makalabas ang residente."],
              ["Trash sample", "May tambak na basura sa gilid ng Sampaguita Street malapit sa covered court. Mabaho na ito at dinadapuan ng langaw."],
              ["Safety sample", "May asong pagala-gala sa daan at muntik nang makakagat ng bata sa may playground."],
            ].map(([label, sample]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setDescription(sample)
                  setReportResult(null)
                }}
                className="rounded-full border border-card-line bg-canvas px-3 py-1 text-xs font-bold text-foreground hover:border-accent"
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
              setReportResult(null)
            }}
            placeholder="Describe what happened, where it is, and what needs attention."
            className="mt-3 min-h-32 w-full rounded-xl border border-card-line bg-card p-3 text-sm font-medium text-foreground outline-none focus:border-accent"
          />
          <div className="mt-1 text-right text-xs font-medium text-muted-foreground">
            {description.length} characters · {config.minimum_description_length} needed
          </div>
          <Button
            onClick={() => void runSubmissionTest()}
            disabled={!description.trim() || Boolean(busy)}
            className="mt-3 w-full rounded-xl bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            <TestTube2Icon className="size-4" />
            {busy === "submission" ? "Checking…" : description.trim() ? "Check this sample" : "Enter a description first"}
          </Button>
        </Card>

        <Card
          title="Sample result"
          hint="Laid out the way officials see it on a real report, so what you check here is what they will read."
        >
          {reportResult ? (
            <div className="space-y-4">
              {/* The photo under discussion, shown next to the protected copy
                  when one was produced. Reading "sensitive details were
                  protected" with no image to look at is not something an
                  official can verify. */}
              {imagePreview ? (
                <div className={cn("grid gap-2", reportResult.privacy?.protected_image && "grid-cols-2")}>
                  <figure>
                    <img
                      src={imagePreview}
                      alt="The sample photo as submitted"
                      className="max-h-48 w-full rounded-xl border border-card-line object-contain"
                    />
                    <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {reportResult.privacy?.protected_image ? "As submitted" : "Sample photo"}
                    </figcaption>
                  </figure>
                  {reportResult.privacy?.protected_image ? (
                    <figure>
                      <img
                        src={reportResult.privacy.protected_image}
                        alt="The sample photo with sensitive areas blurred"
                        className="max-h-48 w-full rounded-xl border border-status-closed/40 object-contain"
                      />
                      <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-status-closed-ink">
                        What residents would see
                      </figcaption>
                    </figure>
                  ) : null}
                </div>
              ) : null}

              <ResultBadges result={reportResult} />

              {/* Uploaded but unreadable is not the same as not uploaded — and
                  it is not the same as unprotected either. Describing the photo
                  and scanning it for faces are two different systems, so saying
                  only "could not be reviewed" next to a visibly blurred face
                  read as a contradiction. */}
              {reportResult.image_uploaded && reportResult.image_review_succeeded === false ? (
                <div className="rounded-xl border border-severity-moderate-ink/20 bg-severity-moderate-surface p-3 text-xs font-medium leading-relaxed text-severity-moderate-ink">
                  <span className="block font-bold">Photo could not be described</span>
                  The description below was written from the text alone.
                  {reportResult.privacy?.state === "protected"
                    ? " The photo was still scanned for faces and plates, and what it found was blurred."
                    : reportResult.privacy?.state === "no_match_found"
                      ? " The photo was still scanned for faces and plates; none were found."
                      : " Try again — this fails intermittently."}
                </div>
              ) : null}

              {reportResult.explanation ? (
                <p className="text-sm font-medium leading-relaxed text-foreground">{reportResult.explanation}</p>
              ) : null}

              <div>
                <SectionLabel>What was found</SectionLabel>
                <ul className="mt-1.5 space-y-1">
                  {[
                    reportResult.text_assessment,
                    reportResult.category_match === true
                      ? "The selected category matches the concern."
                      : reportResult.category_match === false
                        ? `The report reads more like ${categoryLabel(config, reportResult.primary_category)} than ${categoryLabel(config, selectedCategory)}.`
                        : "",
                    reportResult.image_uploaded
                      ? displayValue(reportResult.evidence_relationship)
                      : "No photo was submitted.",
                    reportResult.urgent_attention
                      ? "This may describe immediate danger."
                      : "No immediate danger was identified.",
                    reportResult.duplicate ? "A very similar report was filed recently." : "",
                  ]
                    .filter(Boolean)
                    .map((line) => (
                      <li key={line as string} className="flex gap-2 text-sm font-medium leading-relaxed text-foreground">
                        <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                        <span className="min-w-0 break-words">{line}</span>
                      </li>
                    ))}
                </ul>
              </div>

              {reportResult.detected_objects?.length ? (
                <div>
                  <SectionLabel>Observed in the photo</SectionLabel>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {reportResult.detected_objects.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-canvas px-2.5 py-1 text-xs font-bold capitalize text-foreground"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {reportResult.image_uploaded ? (
                <div>
                  <SectionLabel>Privacy protection</SectionLabel>
                  <p className="mt-1.5 text-sm font-medium leading-relaxed text-foreground">
                    {SAMPLE_PRIVACY_COPY[reportResult.privacy?.state ?? "unchecked"]}
                  </p>
                  {reportResult.privacy?.detected_classes?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {reportResult.privacy.detected_classes.map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-status-closed-surface px-2.5 py-1 text-xs font-bold capitalize text-status-closed-ink"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {reportResult.privacy?.protected_image ? (
                    <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">
                      The blurred copy is shown above. Nothing was saved.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {reportResult.missing_information?.length ? (
                <div>
                  <SectionLabel>Additional information needed</SectionLabel>
                  <ul className="mt-1.5 space-y-1">
                    {reportResult.missing_information.map((item) => (
                      <li key={item} className="text-sm font-medium text-foreground">
                        · {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div>
                <SectionLabel>Recommended next step</SectionLabel>
                <p className="mt-1.5 text-sm font-bold text-foreground">
                  {displayValue(reportResult.recommended_action || "manual_review")}
                </p>
              </div>

              <p className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
                This review is advisory. Authorized officials make the final decision.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
              The result will show category fit, photo evidence, similar-report warnings, privacy notes and — when a
              face or plate is found — the actual blurred image residents would see.
            </div>
          )}
        </Card>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-card-line bg-canvas/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Button
          onClick={() => void save()}
          disabled={Boolean(busy)}
          className="h-11 w-full rounded-xl bg-accent text-white hover:bg-accent/90"
        >
          <SaveIcon className="size-4" /> {busy === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
    </ConfigShell>
  )
}
