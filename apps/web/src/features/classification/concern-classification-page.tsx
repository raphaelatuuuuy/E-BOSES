import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SlidersHorizontalIcon,
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
  resetConcernClassificationConfig,
  saveConcernClassificationConfig,
  testConcernImage,
  testConcernReport,
  type ConcernClassificationConfig,
  type ImageClassificationResult,
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
 * says what each means for the official's day. The underlying numbers stay
 * reachable behind an "Advanced" disclosure, so they remain auditable for the
 * capstone write-up without being the first thing anyone meets.
 *
 * By default, only 15 supported COCO classes are kept in the detection filter
 * (person, bicycle, car, motorcycle, bus, truck, bench, parking meter, traffic
 * light, knife, dog, cat, handbag, backpack, suitcase). The full list of 80 is
 * still available in the API; the filter is applied in the AI pipeline.
 */

const defaults: ConcernClassificationConfig = {
  revision: 0,
  image_model: "yolov8m.pt",
  text_model: "multilingual-keyword-v1",
  image_confidence_threshold: 0.7,
  text_relevance_threshold: 0.65,
  duplicate_similarity_threshold: 0.85,
  minimum_description_length: 20,
  mismatch_action: "manual_review",
  flag_suspicious: true,
  flag_duplicates: true,
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

function percent(value: number | null | undefined) {
  return value == null ? "Not measured yet" : `${Math.round(value * 100)}%`
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
        {value.replace(/_/g, " ")}
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
      {value.replace(/_/g, " ")}
    </div>
  )
}

export default function ConcernClassificationPage() {
  usePageTitle("Report checking")
  const [config, setConfig] = useState<ConcernClassificationConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [advanced, setAdvanced] = useState(false)

  const [term, setTerm] = useState("")
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
  const [imageResult, setImageResult] = useState<ImageClassificationResult | null>(null)
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

  async function reset() {
    setBusy("reset")
    try {
      setConfig(await resetConcernClassificationConfig())
      toast.success("Recommended settings restored")
    } catch (error) {
      toast.error(describeApiError(error, "Could not restore the settings."))
    } finally {
      setBusy("")
    }
  }

  async function runImageTest() {
    if (!imageFile) return
    setBusy("image")
    setImageResult(null)
    try {
      setImageResult(await testConcernImage(imageFile, selectedCategory))
    } catch (error) {
      toast.error(describeApiError(error, "The photo could not be checked."))
    } finally {
      setBusy("")
    }
  }

  async function runReportTest() {
    if (!description.trim()) return
    setBusy("report")
    setReportResult(null)
    try {
      setReportResult(await testConcernReport(selectedCategory, description.trim()))
    } catch (error) {
      toast.error(describeApiError(error, "The written report could not be checked."))
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
          title="Words that mark a report as junk"
          hint="A report containing any of these is held for review. It is never turned down on this alone."
        >
          <div className="flex flex-wrap gap-2">
            {config.suspicious_terms.map((word) => (
              <button
                key={word}
                type="button"
                onClick={() =>
                  update(
                    "suspicious_terms",
                    config.suspicious_terms.filter((item) => item !== word),
                  )
                }
                className="rounded-full bg-severity-critical-surface px-3 py-1.5 text-xs font-bold text-severity-critical-ink"
                aria-label={`Remove ${word}`}
              >
                {word} ×
              </button>
            ))}
            {config.suspicious_terms.length === 0 ? (
              <p className="text-xs font-medium text-muted-foreground">Nothing added yet.</p>
            ) : null}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Add a word"
              className="h-10 min-w-0 flex-1 rounded-xl border border-card-line bg-card px-3 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
            />
            <Button
              variant="outline"
              onClick={() => {
                const next = term.trim().toLowerCase()
                if (next && !config.suspicious_terms.includes(next)) {
                  update("suspicious_terms", [...config.suspicious_terms, next])
                }
                setTerm("")
              }}
            >
              <PlusIcon className="size-4" /> Add
            </Button>
          </div>
        </Card>
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
            <PlusIcon className="size-4" /> Add
          </Button>
        </div>
      </Card>

      {/* The fastest way to understand a setting is to watch it decide on a
          real example, so the testers sit beside the settings rather than
          behind a separate tab. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Try a photo" hint="See what the system would decide, without filing anything.">
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
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              setImageFile(event.target.files?.[0] ?? null)
              setImageResult(null)
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
                <span className="text-xs font-medium text-muted-foreground">JPG, PNG or WebP</span>
              </>
            )}
          </button>
          <Button
            onClick={() => void runImageTest()}
            disabled={!imageFile || Boolean(busy)}
            className="mt-3 w-full rounded-xl bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            <TestTube2Icon className="size-4" />
            {busy === "image" ? "Checking…" : "Check this photo"}
          </Button>

          {imageResult ? (
            <div className="mt-4 space-y-2">
              {imageResult.annotated_image ? (
                <img
                  src={imageResult.annotated_image}
                  alt="The photo with what the system recognised marked on it"
                  className="max-h-56 w-full rounded-xl border border-card-line bg-ink object-contain"
                />
              ) : null}
              <ResultRow label="Recognised as" value={imageResult.detected_label || "Nothing"} />
              <ResultRow
                label="Would file under"
                value={imageResult.detected_category || "No matching category"}
              />
              <ResultRow label="How sure" value={percent(imageResult.confidence)} />
              <Outcome value={imageResult.outcome} />
              <p className="text-xs font-medium leading-relaxed text-muted-foreground">
                {imageResult.message}
              </p>
            </div>
          ) : null}
        </Card>

        <Card title="Try a description" hint="Paste something a resident might write.">
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
              setReportResult(null)
            }}
            placeholder="Maraming nakatambak na basura sa Sampaguita Street malapit sa covered court."
            className="min-h-32 w-full rounded-xl border border-card-line bg-card p-3 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
          />
          <div className="mt-1 text-right text-xs font-medium text-muted-foreground">
            {description.length} characters · {config.minimum_description_length} needed
          </div>
          <Button
            onClick={() => void runReportTest()}
            disabled={!description.trim() || Boolean(busy)}
            className="mt-2 w-full rounded-xl bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            <TestTube2Icon className="size-4" />
            {busy === "report" ? "Checking…" : "Check this description"}
          </Button>

          {reportResult ? (
            <div className="mt-4 space-y-2">
              <ResultRow label="Reads as" value={reportResult.classification} />
              <ResultRow label="How sure" value={percent(reportResult.confidence)} />
              <ResultRow
                label="Matches the category"
                value={
                  reportResult.category_match == null
                    ? "Could not tell"
                    : reportResult.category_match
                      ? "Yes"
                      : "No"
                }
              />
              <ResultRow
                label="Already reported"
                value={reportResult.duplicate ? "Looks like a duplicate" : "No match found"}
              />
              <Outcome value={reportResult.outcome} />
              <p className="rounded-xl bg-tint p-3 text-xs font-medium leading-relaxed text-foreground">
                {reportResult.explanation}
              </p>
            </div>
          ) : null}
        </Card>
      </div>

      {/* The raw numbers stay reachable — the capstone write-up has to cite them
          — but they are not the first thing anyone meets. */}
      <section className="overflow-hidden rounded-2xl border border-card-line bg-card">
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          aria-expanded={advanced}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-tint"
        >
          <SlidersHorizontalIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm font-bold text-foreground">Advanced settings</span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
            fine-tune the exact numbers behind the choices above
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "ml-auto size-4 text-muted-foreground transition-transform",
              advanced ? "" : "-rotate-90",
            )}
          />
        </button>

        {advanced ? (
          <div className="space-y-4 border-t border-card-line p-4">
            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  [
                    "image_confidence_threshold",
                    "How sure about the photo",
                    "The system must be at least this sure it recognised the photo. Higher means more photos get sent to you as “unclear”.",
                  ],
                  [
                    "text_relevance_threshold",
                    "How well the words must fit",
                    "How closely the description must match the chosen category. Higher means more reports get sent to you as “off-topic”.",
                  ],
                  [
                    "duplicate_similarity_threshold",
                    "How alike counts as the same issue",
                    "Two nearby reports this similar are flagged as one issue. Lower catches more duplicates but may join unrelated reports.",
                  ],
                ] as const
              ).map(([key, label, hint]) => (
                <label key={key} className="block rounded-xl border border-card-line bg-canvas p-3">
                  <span className="flex items-center justify-between text-xs font-bold text-foreground">
                    {label}
                    <span className="tabular-nums text-brand-navy">
                      {Math.round(config[key] * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0.3}
                    max={0.95}
                    step={0.01}
                    value={config[key]}
                    onChange={(event) => update(key, Number(event.target.value))}
                    className="mt-2 w-full accent-brand-orange"
                  />
                  <span className="mt-1 block text-[11px] font-medium leading-relaxed text-muted-foreground">
                    {hint}
                  </span>
                </label>
              ))}

              <label className="block rounded-xl border border-card-line bg-canvas p-3">
                <span className="flex items-center justify-between text-xs font-bold text-foreground">
                  Shortest description allowed
                  <span className="tabular-nums text-brand-navy">
                    {config.minimum_description_length}
                  </span>
                </span>
                <input
                  type="range"
                  min={10}
                  max={150}
                  step={5}
                  value={config.minimum_description_length}
                  onChange={(event) =>
                    update("minimum_description_length", Number(event.target.value))
                  }
                  className="mt-2 w-full accent-brand-orange"
                />
                <span className="mt-1 block text-[11px] font-medium leading-relaxed text-muted-foreground">
                  Shorter reports are held for review.
                </span>
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["flag_suspicious", "Hold reports that look like junk"],
                  ["flag_duplicates", "Hold reports that look like duplicates"],
                  ["flag_irrelevant", "Hold reports that look off-topic"],
                  ["notify_reviewer", "Notify an official when something is held"],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-start gap-2 rounded-xl border border-card-line bg-canvas p-3 text-xs font-semibold text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(config[key])}
                    onChange={(event) => update(key, event.target.checked)}
                    className="mt-0.5 size-4 accent-brand-orange"
                  />
                  {label}
                </label>
              ))}
            </div>

            <dl className="grid gap-2 rounded-xl bg-tint p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="font-bold text-muted-foreground">Photo model</dt>
                <dd className="font-semibold text-foreground">
                  {config.image_model}
                  {config.image_available === false ? " · unavailable" : ""}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-muted-foreground">Text model</dt>
                <dd className="font-semibold text-foreground">{config.text_model}</dd>
              </div>
            </dl>

            <Button variant="outline" onClick={() => void reset()} disabled={Boolean(busy)}>
              <RotateCcwIcon className="size-4" /> Restore recommended settings
            </Button>
          </div>
        ) : null}
      </section>

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
