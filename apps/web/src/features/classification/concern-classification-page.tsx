import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BotIcon,
  LoaderCircleIcon,
  SearchIcon,
  TestTube2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigShell, ConfigHeroAction } from "@/features/dashboard/components/config/config-shell"
import { SheetDialog, SheetList, SheetOptionRow, SheetSectionLabel, SheetToggleRow } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"

import {
  getConcernClassificationConfig,
  getValidationActivity,
  saveConcernClassificationConfig,
  testConcernSubmission,
  type ConcernClassificationConfig,
  type ReportValidationResult,
  type ValidationActivityResponse,
} from "./api"
import {
  applyStrictness,
  detectStrictness,
  MISMATCH_OPTIONS,
  STRICTNESS_PRESETS,
} from "./strictness"

const defaults: ConcernClassificationConfig = {
  revision: 0,
  text_model: "gemma4:31b",
  text_relevance_threshold: 0.65,
  duplicate_similarity_threshold: 0.85,
  minimum_description_length: 20,
  mismatch_action: "auto_correct",
  flag_suspicious: true,
  flag_duplicates: true,
  report_duplicate_detection_enabled: true,
  report_duplicate_action: "warn",
  report_duplicate_lookback_days: 180,
  report_duplicate_distance_meters: 100,
  report_duplicate_similarity_threshold: 0.88,
  report_duplicate_location_precision: 4,
  flag_irrelevant: true,
  suspicious_terms: ["test", "testing", "asdf", "qwerty", "12345"],
  category_keywords: {},
  categories: [],
}

/* ─── Result badges ─── */

function ResultBadges({ result }: { result: ReportValidationResult }) {
  const badges: { label: string; tone: "good" | "warn" | "alert" | "neutral" }[] = []
  if (result.evidence_relationship === "supports_report") badges.push({ label: "Supports report", tone: "good" })
  if (result.evidence_relationship === "partially_supports_report") badges.push({ label: "Supports report in part", tone: "neutral" })
  if (result.evidence_relationship === "contradicts_report") badges.push({ label: "Possible mismatch", tone: "warn" })
  if (result.evidence_relationship === "no_useful_image_evidence") badges.push({ label: "Photo evidence inconclusive", tone: "warn" })
  if (result.evidence_relationship === "image_review_failed") badges.push({ label: "Photo review unavailable", tone: "warn" })
  if (result.evidence_relationship === "image_unavailable") badges.push({ label: "Text-only report", tone: "neutral" })
  if (result.urgent_attention) badges.push({ label: "Urgent attention", tone: "alert" })
  if (result.category_match === false) badges.push({ label: "Category corrected", tone: "warn" })
  if (result.duplicate) badges.push({ label: "Possible duplicate", tone: "warn" })

  if (!badges.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-bold",
            badge.tone === "good" && "text-neutral-500",
            badge.tone === "warn" && "text-neutral-600",
            badge.tone === "alert" && "text-sos",
            badge.tone === "neutral" && "bg-canvas text-muted-foreground",
          )}
        >
          {badge.label}
        </span>
      ))}
    </div>
  )
}

const SAMPLE_PRIVACY_COPY: Record<string, string> = {
  unchecked: "The image could not be checked automatically for sensitive details, so it stays private.",
  not_required: "No sensitive details requiring automatic protection were identified during the initial review.",
  protected: "Sensitive details were protected before public display.",
  sensitive_review_required: "Possible sensitive visual content was found. The image stays restricted.",
  no_match_found: "No matching sensitive region was confirmed. The image stays restricted.",
  not_configured: "Automatic privacy protection is not switched on, so the image stays restricted.",
  failed: "Automatic privacy protection could not be completed. The original image remains restricted.",
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
    "needs review": "Automatic result uncertain",
    "supports report": "Text and photo match",
    "partially supports report": "Photo partly supports the report",
    "contradicts report": "Text and photo may not match",
    "no useful image evidence": "Photo does not confirm the report",
    "image unavailable": "No photo was submitted",
    "image review failed": "Photo could not be reviewed automatically",
    accept: "Accept and continue processing",
    "accept with privacy review": "Continue using the protected image",
    "manual review": "Apply safe intake fallback",
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

/* ─── Configure dialog ─── */

function ConfigureDialog({
  open,
  onClose,
  config,
  onUpdate,
  onSave,
  busy,
}: {
  open: boolean
  onClose: () => void
  config: ConcernClassificationConfig
  onUpdate: <K extends keyof ConcernClassificationConfig>(key: K, value: ConcernClassificationConfig[K]) => void
  onSave: () => void
  busy: boolean
}) {
  const strictness = detectStrictness(config)

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Validation rules"
      description="Set how the system handles reports before they reach your queue."
      size="wide"
      footer={
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Discard changes
          </Button>
          <Button
            onClick={() => { onSave(); onClose() }}
            disabled={busy}
            className="flex-1 bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      {/* 1. Review preset */}
      <SheetSectionLabel>1. Review preset</SheetSectionLabel>
      <div className="mb-4">
        <select
          value={strictness ?? ""}
          onChange={(event) => {
            const value = event.target.value as "lenient" | "balanced" | "strict"
            if (!value) return
            const preset = applyStrictness(config, value)
            onUpdate("text_relevance_threshold", preset.text_relevance_threshold)
            onUpdate("duplicate_similarity_threshold", preset.duplicate_similarity_threshold)
            onUpdate("minimum_description_length", preset.minimum_description_length)
          }}
          className="h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-900 outline-none focus:border-brand-navy"
        >
          {STRICTNESS_PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}{preset.key === "balanced" ? " (Recommended)" : ""}
            </option>
          ))}
          {!strictness && <option value="">Custom</option>}
        </select>
        <p className="mt-2 rounded-xl bg-blue-50 p-3 text-xs font-medium leading-relaxed text-blue-700">
          Balanced asks residents to correct important issues while allowing uncertain reports to reach an official.
        </p>
      </div>

      {/* 2. Report quality rules */}
      <SheetSectionLabel>2. Report quality rules</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">Decide how the system handles common quality issues.</p>
      <SheetList className="mb-6">
        <SheetOptionRow
          title="Missing required information"
          description="Important details are missing."
          trailing={
            <select
              value={config.minimum_description_length > 40 ? "reject" : config.minimum_description_length > 20 ? "ask" : "allow"}
              onChange={(e) => {
                const v = e.target.value
                if (v === "reject") onUpdate("minimum_description_length", 40)
                else if (v === "ask") onUpdate("minimum_description_length", 20)
                else onUpdate("minimum_description_length", 10)
              }}
              className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
            >
              <option value="allow">Allow with warning</option>
              <option value="ask">Ask resident to complete</option>
              <option value="reject">Reject automatically</option>
            </select>
          }
        />
        <SheetOptionRow
          title="Incorrect category"
          description="Selected category appears incorrect."
          trailing={
            <select
              value={config.mismatch_action}
              onChange={(e) => onUpdate("mismatch_action", e.target.value as ConcernClassificationConfig["mismatch_action"])}
              className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
            >
              {MISMATCH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          }
        />
        <SheetOptionRow
          title="Description and photo do not match"
          description="Text and photo seem to show different issues."
          trailing={
            <select
              className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
            >
              <option>Ask resident to clarify</option>
              <option>Accept with note</option>
            </select>
          }
        />
        <SheetOptionRow
          title="Low-quality or unclear photo"
          description="Photo is blurry, dark, or not helpful."
          trailing={
            <select
              className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
            >
              <option>Allow with warning</option>
              <option>Ask for a better photo</option>
            </select>
          }
        />
        <SheetOptionRow
          title="Possible urgent situation"
          description="Indicates danger, injury, or severe incident."
          trailing={
            <select
              className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
            >
              <option>Accept and flag as urgent</option>
              <option>Escalate immediately</option>
            </select>
          }
        />
      </SheetList>

      {/* 3. Content safety */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <SheetSectionLabel>3. Content safety</SheetSectionLabel>
          <p className="mb-2 text-xs text-neutral-500">How the system handles unsafe or inappropriate content.</p>
          <SheetList>
            <SheetOptionRow
              title="Spam or unrelated submission"
              trailing={
                <select className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                  <option>Reject automatically</option>
                  <option>Hold for review</option>
                </select>
              }
            />
            <SheetOptionRow
              title="Abusive or harassing language"
              trailing={
                <select className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                  <option>Hold for review</option>
                  <option>Reject automatically</option>
                </select>
              }
            />
            <SheetOptionRow
              title="Possible threat or danger"
              trailing={
                <select className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                  <option>Accept, flag & notify</option>
                  <option>Hold for review</option>
                </select>
              }
            />
            <SheetOptionRow
              title="Sensitive or graphic content"
              trailing={
                <select className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700">
                  <option>Restrict & hold for review</option>
                  <option>Accept with privacy blur</option>
                </select>
              }
            />
          </SheetList>
        </div>

        {/* 4. Similar reports */}
        <div>
          <SheetSectionLabel>4. Similar reports</SheetSectionLabel>
          <p className="mb-2 text-xs text-neutral-500">Prevent duplicates while keeping residents informed.</p>
          <SheetToggleRow
            id="duplicate-detection"
            label="Duplicate detection"
            description="Check for similar reports near the pinned location"
            checked={config.report_duplicate_detection_enabled !== false}
            onChange={(checked) => onUpdate("report_duplicate_detection_enabled", checked)}
          />
          <SheetList className="mt-3">
            <SheetOptionRow
              title="When a likely match is found"
              trailing={
                <select
                  value={config.report_duplicate_action ?? "warn"}
                  onChange={(e) => onUpdate("report_duplicate_action", e.target.value as ConcernClassificationConfig["report_duplicate_action"])}
                  className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
                >
                  <option value="warn">Warn and show existing report</option>
                  <option value="block">Block repeated reports</option>
                </select>
              }
            />
            <SheetOptionRow
              title="Search radius"
              trailing={
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={config.report_duplicate_distance_meters ?? 100}
                    onChange={(e) => onUpdate("report_duplicate_distance_meters", Number(e.target.value))}
                    className="w-16 rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
                  />
                  <span className="text-xs text-neutral-500">meters</span>
                </div>
              }
            />
            <SheetOptionRow
              title="Look-back period"
              trailing={
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={config.report_duplicate_lookback_days ?? 180}
                    onChange={(e) => onUpdate("report_duplicate_lookback_days", Number(e.target.value))}
                    className="w-16 rounded-lg border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700"
                  />
                  <span className="text-xs text-neutral-500">days</span>
                </div>
              }
            />
          </SheetList>
        </div>
      </div>

      {/* 5. Fallback */}
      <SheetSectionLabel>5. If automated validation is unavailable</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">Choose how the system should behave if the AI validation service is offline.</p>
      <SheetList>
        <SheetOptionRow
          title="Accept reports that pass basic system checks"
          description="Required fields, file validation, account restrictions, and exact-duplicate checks will continue."
          selected={config.flag_suspicious !== false}
          onClick={() => onUpdate("flag_suspicious", true)}
        />
        <SheetOptionRow
          title="Hold reports until automated validation recovers"
          description="Residents will be asked to try again later."
          selected={config.flag_suspicious === false}
          onClick={() => onUpdate("flag_suspicious", false)}
        />
      </SheetList>

      {/* 6. Test a sample report */}
      <SheetSectionLabel>6. Test a sample report</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">Use one resident-style description and an optional photo. Nothing is filed.</p>
      <TestTab config={config} />
    </SheetDialog>
  )
}

/* ─── Activity tab ─── */

function ActivityTab({ config }: { config: ConcernClassificationConfig }) {
  const [data, setData] = useState<ValidationActivityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [category, setCategory] = useState("")
  const [search, setSearch] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getValidationActivity({ days, category: category || undefined })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days, category])

  const stats = data?.stats

  const categories = [{ key: "", label: "All" }, ...config.categories.filter((c) => c.enabled)]
  const timeRanges = [
    { key: 7, label: "7 days" },
    { key: 30, label: "30 days" },
    { key: 90, label: "90 days" },
  ]

  const filteredResults = data?.results?.filter((item) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      item.description.toLowerCase().includes(q) ||
      item.category_label.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q)
    )
  })

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <dl className="flex flex-wrap gap-x-12 gap-y-6">
        {[
          { label: "Scanned", value: stats?.scanned ?? 0 },
          { label: "Auto-accepted", value: stats?.auto_validated ?? 0 },
          { label: "Flagged", value: stats?.flagged ?? 0 },
          { label: "Held for review", value: stats?.held_for_review ?? 0 },
          { label: "Rejected", value: stats?.rejected ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dd className="text-section tabular-nums text-brand-navy">{stat.value}</dd>
            <dt className="mt-1 text-meta text-neutral-500">{stat.label}</dt>
          </div>
        ))}
      </dl>

      {/* Category chips */}
      <div className="flex items-center gap-7 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setCategory(cat.key)}
            className={cn(
              "shrink-0 text-read transition-colors",
              category === cat.key
                ? "font-medium text-brand-navy"
                : "text-neutral-400 hover:text-brand-navy",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search + time range */}
      <div className="flex flex-wrap items-center gap-6 border-b border-neutral-200 pb-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-3">
          <SearchIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={1.8} aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report, category, or location…"
            aria-label="Search activity"
            className="w-full bg-transparent py-2 text-read text-brand-navy outline-none placeholder:text-neutral-400"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="flex shrink-0 items-center justify-center text-neutral-400 transition-colors hover:text-brand-navy"
            >
              <XIcon className="size-5" strokeWidth={1.8} aria-hidden />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-6">
          {timeRanges.map((range) => (
            <button
              key={range.key}
              type="button"
              onClick={() => setDays(range.key)}
              className={cn(
                "shrink-0 whitespace-nowrap text-read transition-colors",
                days === range.key
                  ? "font-medium text-brand-navy"
                  : "text-neutral-400 hover:text-brand-navy",
              )}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      {/* Activity table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <LoaderCircleIcon className="size-6 animate-spin text-brand-navy" />
        </div>
      ) : !filteredResults?.length ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-neutral-500">No validation activity in this period.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="px-4 py-3 text-xs font-semibold text-neutral-500">Submitted</th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-500">Report</th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-500">Category</th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-500">Location</th>
                <th className="px-4 py-3 text-xs font-semibold text-neutral-500">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {filteredResults!.map((item) => (
                <tr key={item.id} className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                    {new Date(item.submitted_at).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
                    <br />
                    <span className="text-neutral-400">
                      {new Date(item.submitted_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                    </span>
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-xs font-medium text-neutral-900">
                    {item.description}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
                      {item.category_label}
                    </span>
                  </td>
                  <td className="max-w-[160px] truncate px-4 py-3 text-xs text-neutral-500">
                    {item.location}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold",
                        item.outcome === "accepted" && "bg-green-50 text-green-700",
                        item.outcome === "flagged" && "bg-amber-50 text-amber-700",
                        item.outcome === "rejected" && "bg-red-50 text-red-700",
                        item.outcome === "held" && "bg-blue-50 text-blue-700",
                      )}
                    >
                      {item.outcome_label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/* ─── Test tab ─── */

function TestTab({ config }: { config: ConcernClassificationConfig }) {
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
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const activeCategories = useMemo(
    () => config.categories.filter((category) => category.enabled),
    [config.categories],
  )

  useEffect(() => {
    if (activeCategories.length && !activeCategories.find((c) => c.key === selectedCategory)) {
      setSelectedCategory(activeCategories[0]!.key)
    }
  }, [activeCategories, selectedCategory])

  async function runTest() {
    if (!description.trim()) return
    setBusy(true)
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
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Input */}
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-bold text-neutral-900">Test a sample report</h3>
          <p className="mt-1 text-xs text-neutral-500">Use one resident-style description and an optional photo. Nothing is filed.</p>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-neutral-500">Filed under</label>
          <select
            value={selectedCategory}
            onChange={(event) => setSelectedCategory(event.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-semibold text-neutral-900 outline-none focus:border-brand-navy"
          >
            {activeCategories.map((category) => (
              <option key={category.key} value={category.key}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

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
          className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 p-4 text-center transition hover:border-brand-navy"
        >
          {imagePreview ? (
            <img
              src={imagePreview}
              alt="Selected test photo"
              className="max-h-36 w-full rounded-lg object-contain"
            />
          ) : (
            <>
              <UploadCloudIcon className="size-6 text-brand-navy" />
              <span className="mt-2 text-sm font-bold text-neutral-900">Choose a photo</span>
              <span className="text-xs text-neutral-500">JPG or PNG</span>
            </>
          )}
        </button>

        <div className="flex flex-wrap gap-2">
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
              className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-bold text-neutral-700 hover:border-brand-navy"
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
          className="min-h-28 w-full rounded-xl border border-neutral-200 bg-white p-3 text-sm font-medium text-neutral-900 outline-none focus:border-brand-navy"
        />
        <div className="text-right text-xs text-neutral-400">
          {description.length} characters · {config.minimum_description_length} needed
        </div>
        <Button
          onClick={() => void runTest()}
          disabled={!description.trim() || busy}
          className="w-full rounded-xl bg-brand-navy text-white hover:bg-brand-navy/90"
        >
          <TestTube2Icon className="size-4" />
          {busy ? "Checking…" : description.trim() ? "Check this sample" : "Enter a description first"}
        </Button>
      </div>

      {/* Result */}
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-bold text-neutral-900">Test result</h3>
          <p className="mt-1 text-xs text-neutral-500">Laid out the way officials see it on a real report.</p>
        </div>

        {reportResult ? (
          <div className="space-y-4">
            {imagePreview && (
              <div className={cn("grid gap-2", reportResult.privacy?.protected_image && "grid-cols-2")}>
                <figure>
                  <img
                    src={imagePreview}
                    alt="The sample photo as submitted"
                    className="max-h-40 w-full rounded-xl border border-neutral-200 object-contain"
                  />
                  <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                    {reportResult.privacy?.protected_image ? "As submitted" : "Sample photo"}
                  </figcaption>
                </figure>
                {reportResult.privacy?.protected_image && (
                  <figure>
                    <img
                      src={reportResult.privacy.protected_image}
                      alt="The sample photo with sensitive areas blurred"
                      className="max-h-40 w-full rounded-xl border border-green-200 object-contain"
                    />
                    <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                      What residents would see
                    </figcaption>
                  </figure>
                )}
              </div>
            )}

            <ResultBadges result={reportResult} />

            {reportResult.image_uploaded && reportResult.image_review_succeeded === false && (
              <div className="rounded-xl border border-neutral-200 p-3 text-xs font-medium leading-relaxed text-neutral-600">
                <span className="block font-bold">Photo could not be described</span>
                The description below was written from the text alone.
              </div>
            )}

            {reportResult.explanation && (
              <p className="text-sm font-medium leading-relaxed text-neutral-900">{reportResult.explanation}</p>
            )}

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
                    <li key={line as string} className="flex gap-2 text-sm font-medium leading-relaxed text-neutral-900">
                      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-neutral-400" />
                      <span className="min-w-0 break-words">{line}</span>
                    </li>
                  ))}
              </ul>
            </div>

            {reportResult.detected_objects?.length && (
              <div>
                <SectionLabel>Observed in the photo</SectionLabel>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {reportResult.detected_objects.map((item) => (
                    <span key={item} className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-bold capitalize text-neutral-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {reportResult.image_uploaded && (
              <div>
                <SectionLabel>Privacy protection</SectionLabel>
                <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-900">
                  {SAMPLE_PRIVACY_COPY[reportResult.privacy?.state ?? "unchecked"]}
                </p>
                {reportResult.privacy?.detected_classes?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {reportResult.privacy.detected_classes.map((item) => (
                      <span key={item} className="rounded-full px-2.5 py-1 text-xs font-bold capitalize text-neutral-600">
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {reportResult.missing_information?.length && (
              <div>
                <SectionLabel>Additional information needed</SectionLabel>
                <ul className="mt-1.5 space-y-1">
                  {reportResult.missing_information.map((item) => (
                    <li key={item} className="text-sm font-medium text-neutral-900">· {item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <SectionLabel>Recommended next step</SectionLabel>
              <p className="mt-1.5 text-sm font-bold text-neutral-900">
                {displayValue(reportResult.recommended_action || "accept")}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-neutral-50 p-4 text-xs font-medium leading-relaxed text-neutral-500">
            The result will show category fit, photo evidence, similar-report warnings, privacy notes and — when a
            face or plate is found — the actual blurred image residents would see.
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Main page ─── */

export default function ConcernClassificationPage() {
  usePageTitle("Report checking")
  const [config, setConfig] = useState<ConcernClassificationConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const savedSnapshotRef = useRef<string | null>(null)
  const [configureOpen, setConfigureOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getConcernClassificationConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        savedSnapshotRef.current = JSON.stringify(next)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load these settings.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

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
      const saved = await saveConcernClassificationConfig(config)
      setConfig(saved)
      savedSnapshotRef.current = JSON.stringify(saved)
      toast.success("Settings saved")
    } catch (error) {
      toast.error(describeApiError(error, "Could not save these settings."))
    } finally {
      setBusy("")
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <LoaderCircleIcon className="size-8 animate-spin text-brand-navy" />
      </div>
    )
  }

  return (
    <ConfigShell
      icon={BotIcon}
      eyebrow="Operations"
      title="Report checking"
      description="Configure how the system reviews incoming reports — text, photos, duplicates — before they reach your queue."
      stats={[
        {
          label: "Review mode",
          value: STRICTNESS_PRESETS.find((preset) => preset.key === strictness)?.label ?? "Custom",
        },
        { label: "Reports checked", value: config.metrics?.tested ?? 0 },
        { label: "Went straight through", value: config.metrics?.auto_validated ?? 0 },
        { label: "Rejected by rules", value: config.metrics?.rejected ?? 0 },
      ]}
      action={
        <ConfigHeroAction onClick={() => setConfigureOpen(true)}>
          Configure
        </ConfigHeroAction>
      }
    >
      <ActivityTab config={config} />

      <ConfigureDialog
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        config={config}
        onUpdate={update}
        onSave={() => void save()}
        busy={busy === "save"}
      />
    </ConfigShell>
  )
}
