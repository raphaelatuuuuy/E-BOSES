import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  LoaderCircleIcon,
  SaveIcon,
  TestTube2Icon,
  TriangleAlertIcon,
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
 * "category mapping" table keyed on raw YOLO labels. That is the vocabulary of
 * the model, not of the person doing barangay work.
 *
 * It now leads with three plain choices about how strict checking should be and
 * says what each means for the official's day.
 *
 * By default, only 15 supported COCO classes are kept in the detection filter
 * (person, bicycle, car, motorcycle, bus, truck, bench, parking meter, traffic
 * light, knife, dog, cat, handbag, backpack, suitcase). The full list of 80 is
 * still available in the API; the filter is applied in the AI pipeline.
 */

const defaults: ConcernClassificationConfig = {
  revision: 0,
  image_model: "yolov8m.pt",
  text_model: "gemma4:31b",
  image_confidence_threshold: 0.7,
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
  supported_classes: [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "bench",
    "parking meter",
    "traffic light",
    "knife",
    "dog",
    "cat",
    "handbag",
    "backpack",
    "suitcase",
  ],
  label_mappings: {
    "traffic light": "infrastructure",
    "bench": "infrastructure",
    "parking meter": "infrastructure",
    "garbage": "environment",
    "trash": "environment",
    "knife": "public_safety",
    "dog": "public_safety",
    "cat": "public_safety",
    "handbag": "others",
    "backpack": "others",
    "suitcase": "others",
    "car": "vehicle",
    "truck": "vehicle",
    "motorcycle": "vehicle",
    "bus": "vehicle",
    "bicycle": "vehicle",
    "person": "others",
  },
  category_keywords: {},
  mapping_targets: [],
  categories: [],
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

function ResultRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-card-line pb-2 text-sm last:border-0">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-right font-bold capitalize text-foreground">
        {displayValue(value)}
      </span>
    </div>
  )
}

function Outcome({ value }: { value: string }) {
  const good = value === "match" || value === "approved"
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-bold capitalize",
        good
          ? "bg-status-closed-surface text-status-closed-ink"
          : "bg-severity-moderate-surface text-severity-moderate-ink",
      )}
    >
      {good ? <CheckCircle2Icon className="size-5" /> : <TriangleAlertIcon className="size-5" />}
      {displayValue(value)}
    </div>
  )
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-card-line bg-canvas px-2.5 py-1 text-xs font-bold capitalize text-foreground">
      {children}
    </span>
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
    "image unavailable": "No photo evidence checked",
    "accept with privacy review": "Review privacy before public display",
    "manual review": "Needs official review",
    "request more information": "Ask resident for more details",
    "reject as irrelevant": "Not enough relevant report information",
    "low information text": "Description needs more detail",
    "image review limited": "Photo review unavailable",
    profanity: "Contains strong language",
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
  const [mappingLabel, setMappingLabel] = useState("")
  const [mappingCategory, setMappingCategory] = useState("")

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
        const firstTarget = next.mapping_targets?.find((target) => target.group === "concern")
        if (firstTarget) setMappingCategory(firstTarget.key)
        const firstClass = next.supported_classes?.[0]
        if (firstClass) setMappingLabel(firstClass)
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
        <LoaderCircleIcon className="size-8 animate-spin text-brand-orange" />
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
          className="rounded-xl bg-brand-orange text-white hover:bg-brand-orange-strong"
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
                    ? "border-brand-orange bg-brand-orange-soft"
                    : "border-card-line bg-card hover:border-brand-orange/40",
                )}
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 rounded-full border-2",
                      active ? "border-brand-orange bg-brand-orange" : "border-card-line",
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
                    ? "border-brand-orange bg-brand-orange-soft"
                    : "border-card-line bg-canvas hover:border-brand-orange/40",
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
                  active ? "border-brand-orange bg-brand-orange-soft" : "border-card-line bg-canvas hover:border-brand-orange/40",
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

      <div className="grid gap-2 rounded-2xl border border-card-line bg-card p-3 text-xs font-bold text-foreground sm:grid-cols-4">
        <span>1. Text meaning</span>
        <span>2. Photo evidence</span>
        <span>3. Similar reports</span>
        <span>4. Privacy review</span>
      </div>

      <Card
        title="What the system files things under"
        hint="When a photo shows the thing on the left, the report is filed under the category on the right."
      >
        <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
          {Object.entries(config.label_mappings).map(([label, category]) => (
            <div
              key={label}
              className="flex items-center gap-2 rounded-xl border border-card-line bg-canvas px-3 py-2 text-xs"
            >
              <span className="font-bold capitalize text-foreground">{label}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-bold capitalize text-brand-navy">
                {category.replace(/_/g, " ")}
              </span>
              <button
                type="button"
                aria-label={`Remove ${label}`}
                onClick={() => {
                  const next = { ...config.label_mappings }
                  delete next[label]
                  update("label_mappings", next)
                }}
                className="ml-auto font-bold text-severity-critical-ink"
              >
                ×
              </button>
            </div>
          ))}
          {Object.keys(config.label_mappings).length === 0 ? (
            <p className="text-xs font-medium text-muted-foreground">Nothing set up yet.</p>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <select
            value={mappingLabel}
            onChange={(event) => setMappingLabel(event.target.value)}
            className="h-10 min-w-48 flex-1 rounded-xl border border-card-line bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-brand-orange"
          >
            <option value="">Choose a supported class</option>
            {(config.supported_classes ?? [])
              .filter((label) => !Object.prototype.hasOwnProperty.call(config.label_mappings, label))
              .map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
          </select>
          <select
            value={mappingCategory}
            onChange={(event) => setMappingCategory(event.target.value)}
            className="h-10 rounded-xl border border-card-line bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-brand-orange"
          >
            <option value="" disabled>
              Choose a category
            </option>
            {config.mapping_targets?.length
              ? ["concern", "emergency"].map((group) => (
                  <optgroup
                    key={group}
                    label={group === "concern" ? "Concern categories" : "Emergency types"}
                  >
                    {config.mapping_targets
                      ?.filter((target) => target.group === group)
                      .map((target) => (
                        <option key={target.key} value={target.key}>
                          {target.label}
                        </option>
                      ))}
                  </optgroup>
                ))
              : config.categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label}
                  </option>
                ))}
          </select>
          <Button
            variant="outline"
            onClick={() => {
              const label = mappingLabel.trim().toLowerCase()
              if (label && mappingCategory) {
                update("label_mappings", { ...config.label_mappings, [label]: mappingCategory })
              }
              setMappingLabel("")
            }}
          >
            Add
          </Button>
        </div>
      </Card>

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
            className="mt-1 h-10 w-full rounded-xl border border-card-line bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-brand-orange"
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
            className="mt-3 flex min-h-32 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-card-line bg-canvas p-4 text-center transition hover:border-brand-orange"
          >
            {imagePreview ? (
              <img
                src={imagePreview}
                alt="Selected test photo"
                className="max-h-40 w-full rounded-lg object-contain"
              />
            ) : (
              <>
                <UploadCloudIcon className="size-7 text-brand-orange" />
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
                className="rounded-full border border-card-line bg-canvas px-3 py-1 text-xs font-bold text-foreground hover:border-brand-orange"
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
            className="mt-3 min-h-32 w-full rounded-xl border border-card-line bg-card p-3 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
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

        <Card title="Sample result" hint="This is advisory. Officials still decide what happens next.">
          {reportResult ? (
            <div className="mt-4 space-y-2">
              {reportResult.image?.annotated_image ? (
                <img
                  src={reportResult.image.annotated_image}
                  alt="The photo with what the system recognised marked on it"
                  className="max-h-56 w-full rounded-xl border border-card-line bg-ink object-contain"
                />
              ) : null}
              {reportResult.image_review_limited ? (
                <div className="rounded-xl border border-severity-moderate-ink/20 bg-severity-moderate-surface p-3 text-xs font-medium leading-relaxed text-severity-moderate-ink">
                  <span className="block font-bold">Photo review unavailable</span>
                  {reportResult.image_review_message || "The result used the description and recognized photo items instead."}
                </div>
              ) : null}
              <Outcome value={reportResult.outcome} />
              <ResultRow label="Report text" value={categoryLabel(config, reportResult.primary_category)} />
              <ResultRow label="Filed under" value={categoryLabel(config, selectedCategory)} />
              <ResultRow
                label="Photo evidence"
                value={
                  reportResult.visual_summary ||
                  reportResult.photo_assessment ||
                  reportResult.recognized_photo_items?.join(", ") ||
                  reportResult.image?.detected_label ||
                  "Not clear"
                }
              />
              <ResultRow
                label="Text and category"
                value={
                  reportResult.category_match == null
                    ? "Could not tell"
                    : reportResult.category_match
                      ? "Yes"
                      : "No"
                }
              />
              <ResultRow
                label="Evidence check"
                value={reportResult.evidence_relationship || "Not clear"}
              />
              <p className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
                {reportResult.explanation}
              </p>
              {reportResult.mismatch_reason ? (
                <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                  {reportResult.mismatch_reason}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                {reportResult.privacy_sensitive_information_detected ? <Pill>Privacy review</Pill> : null}
                {reportResult.urgent_attention ? <Pill>Urgent attention</Pill> : null}
                {reportResult.ai_result_uncertain ? <Pill>AI uncertain</Pill> : null}
                {reportResult.duplicate ? <Pill>Possible duplicate</Pill> : null}
                {(reportResult.recognized_photo_items?.length ? reportResult.recognized_photo_items : reportResult.image?.detected_label ? [reportResult.image.detected_label] : []).map((item) => (
                  <Pill key={item}>Photo: {readable(item)}</Pill>
                ))}
                {reportResult.image_flags?.map((flag) => <Pill key={flag}>{readable(flag)}</Pill>)}
                {reportResult.content_flags?.map((flag) => <Pill key={flag}>{readable(flag)}</Pill>)}
              </div>
              <ResultRow label="Official action" value={reportResult.recommended_action || "Needs official review"} />
            </div>
          ) : (
            <div className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
              The result will show category fit, photo evidence, similar-report warnings, privacy notes, and the action the AI recommends for review.
            </div>
          )}
        </Card>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-card-line bg-canvas/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <Button
          onClick={() => void save()}
          disabled={Boolean(busy)}
          className="h-11 w-full rounded-xl bg-brand-orange text-white hover:bg-brand-orange-strong"
        >
          <SaveIcon className="size-4" /> {busy === "save" ? "Saving…" : "Save"}
        </Button>
      </div>
    </ConfigShell>
  )
}
