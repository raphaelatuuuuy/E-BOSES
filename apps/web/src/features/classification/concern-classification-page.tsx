import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Ban,
  BotIcon,
  ChevronDownIcon,
  CircleCheck,
  LoaderCircleIcon,
  SearchIcon,
  TestTube2Icon,
  TriangleAlert,
  PlusIcon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigShell, ConfigHeroAction } from "@/features/dashboard/components/config/config-shell"
import {
  SheetDialog,
  SheetList,
  SheetOptionRow,
  SheetPrimaryButton,
  SheetSecondaryButton,
  SheetSectionLabel,
  SheetToggleRow,
} from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"

import {
  getConcernClassificationConfig,
  getValidationActivity,
  saveConcernClassificationConfig,
  testConcernSubmission,
  generateSampleDescription,
  type ConcernClassificationConfig,
  type ReportValidationResult,
  type SampleLanguage,
  type ValidationActivityResponse,
} from "./api"
import {
  applyStrictness,
  detectStrictness,
  MISMATCH_OPTIONS,
  STRICTNESS_PRESETS,
} from "./strictness"
import { LocationPinMap, type LocationPin } from "./location-pin-map"

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

/* ─── Result copy ─── */

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

/* ─── Rule menu ─── */

function RuleMenu({
  value,
  options,
  onChange,
  full = false,
  label,
  className,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  full?: boolean
  label?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const current = options.find((option) => option.value === value)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white pl-3 pr-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300",
          full && "h-11 w-full rounded-[14px] border-[1.5px] border-neutral-300 px-4 text-[15px] font-medium text-neutral-900",
          open && "border-neutral-400",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{label ?? current?.label ?? value}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          className={cn(
            "absolute top-full z-[1200] mt-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-1 shadow-xl",
            full ? "left-0 right-0" : "right-0 w-60",
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value ? (
                <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ─── Configure dialog ─── */

function ConfigureDialog({
  open,
  onClose,
  config,
  onUpdate,
  onSave,
  busy,
  dirty,
}: {
  open: boolean
  onClose: () => void
  config: ConcernClassificationConfig
  onUpdate: <K extends keyof ConcernClassificationConfig>(key: K, value: ConcernClassificationConfig[K]) => void
  onSave: () => void
  busy: boolean
  dirty: boolean
}) {
  const strictness = detectStrictness(config)
  const [testOpen, setTestOpen] = useState(false)

  return (
    <SheetDialog
      open={open}
      onClose={() => {
        setTestOpen(false)
        onClose()
      }}
      title="Validation rules"
      description="Set how the system handles reports before they reach your queue."
      size="wide"
      actions={
        <button
          type="button"
          aria-label="Test a sample report"
          title="Test a sample report"
          onClick={() => setTestOpen(true)}
          className="flex size-9 items-center justify-center rounded-full text-neutral-900 transition-colors hover:bg-neutral-100"
        >
          <TestTube2Icon className="size-[18px]" />
        </button>
      }
      footer={
        <div className="flex gap-2">
          <SheetSecondaryButton onClick={onClose} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
            Discard changes
          </SheetSecondaryButton>
          <SheetPrimaryButton
            type="button"
            onClick={() => { onSave(); onClose() }}
            disabled={busy || !dirty}
            className="flex-1 bg-brand-navy text-[15px] text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
          >
            {busy ? "Saving…" : "Save changes"}
          </SheetPrimaryButton>
        </div>
      }
    >
      {/* 1. Review preset */}
      <SheetSectionLabel>Review preset</SheetSectionLabel>
      <div className="mb-4">
        <div className="flex gap-0.5 rounded-full bg-neutral-100 p-1">
          {STRICTNESS_PRESETS.map((preset) => {
            const active = strictness === preset.key
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => {
                  const next = applyStrictness(config, preset.key)
                  onUpdate("text_relevance_threshold", next.text_relevance_threshold)
                  onUpdate("duplicate_similarity_threshold", next.duplicate_similarity_threshold)
                  onUpdate("minimum_description_length", next.minimum_description_length)
                }}
                className={cn(
                  "flex-1 rounded-full py-2 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-white/70 text-neutral-900 shadow-sm"
                    : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900",
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        {strictness ? (
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">
            {STRICTNESS_PRESETS.find((preset) => preset.key === strictness)?.consequence}
          </p>
        ) : (
          <p className="mt-2 text-xs text-neutral-500">Custom values — no preset is active.</p>
        )}
      </div>

      {/* 2. Report quality rules */}
      <SheetSectionLabel>Report quality rules</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">Decide how the system handles common quality issues.</p>
      <SheetList className="mb-6">
        <SheetOptionRow
          title="Missing required information"
          description="Important details are missing."
          trailing={
            <div className="flex gap-0.5 rounded-full bg-neutral-100 p-0.5">
              {([
                ["allow", "Allow", 10],
                ["ask", "Ask", 20],
                ["reject", "Reject", 40],
              ] as const).map(([key, label, length]) => {
                const value = config.minimum_description_length > 40 ? "reject" : config.minimum_description_length > 20 ? "ask" : "allow"
                const active = value === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onUpdate("minimum_description_length", length)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "bg-white/70 text-neutral-900 shadow-sm"
                        : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900",
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          }
        />
        <SheetOptionRow
          title="Incorrect category"
          description="Selected category appears incorrect."
          trailing={
            <RuleMenu
              value={config.mismatch_action}
              options={MISMATCH_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              onChange={(value) => onUpdate("mismatch_action", value as ConcernClassificationConfig["mismatch_action"])}
            />
          }
        />
        <SheetOptionRow
          title="Description and photo do not match"
          description="Text and photo seem to show different issues."
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Ask resident to clarify
            </span>
          }
        />
        <SheetOptionRow
          title="Low-quality or unclear photo"
          description="Photo is blurry, dark, or not helpful."
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Allow with warning
            </span>
          }
        />
        <SheetOptionRow
          title="Possible urgent situation"
          description="Indicates danger, injury, or severe incident."
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Accept and flag as urgent
            </span>
          }
        />
      </SheetList>

      {/* 3. Content safety */}
      <SheetSectionLabel>Content safety</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">How the system handles unsafe or inappropriate content.</p>
      <SheetList>
        <SheetOptionRow
          title="Spam or unrelated submission"
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Reject automatically
            </span>
          }
        />
        <SheetOptionRow
          title="Abusive or harassing language"
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Hold for review
            </span>
          }
        />
        <SheetOptionRow
          title="Possible threat or danger"
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Accept, flag & notify
            </span>
          }
        />
        <SheetOptionRow
          title="Sensitive or graphic content"
          trailing={
            <span className="rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-600">
              Restrict & hold for review
            </span>
          }
        />
      </SheetList>

      {/* 4. Similar reports */}
      <SheetSectionLabel>Similar reports</SheetSectionLabel>
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
            <RuleMenu
              value={config.report_duplicate_action ?? "warn"}
              options={[
                { value: "warn", label: "Warn and show existing report" },
                { value: "block", label: "Block repeated reports" },
              ]}
              onChange={(value) => onUpdate("report_duplicate_action", value as ConcernClassificationConfig["report_duplicate_action"])}
            />
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
                className="h-8 w-16 rounded-full border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-neutral-400"
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
                className="h-8 w-16 rounded-full border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-neutral-400"
              />
              <span className="text-xs text-neutral-500">days</span>
            </div>
          }
        />
      </SheetList>

      {/* 5. Fallback */}
      <SheetSectionLabel>If automated validation is unavailable</SheetSectionLabel>
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

      <TestDialog open={testOpen} onClose={() => setTestOpen(false)} config={config} />
    </SheetDialog>
  )
}

/* ─── Test dialog ─── */

function TestDialog({
  open,
  onClose,
  config,
}: {
  open: boolean
  onClose: () => void
  config: ConcernClassificationConfig
}) {
  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Test a sample report"
      description="Use one resident-style description and an optional photo. Nothing is filed."
      size="wide"
    >
      <TestWorkspace config={config} />
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
  const [query, setQuery] = useState({ days, category })
  if (query.days !== days || query.category !== category) {
    setQuery({ days, category })
    setLoading(true)
  }

  useEffect(() => {
    let cancelled = false
    void getValidationActivity({ days: query.days, category: query.category || undefined })
      .then((result) => { if (!cancelled) setData(result) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [query])

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
            <dd className="text-[1.75rem] leading-none tabular-nums font-light tracking-tight text-brand-navy">{stat.value}</dd>
            <dt className="mt-2 text-meta text-neutral-500">{stat.label}</dt>
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
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-[220px] items-center gap-3">
          <SearchIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={1.8} aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search report, category, or location…"
            aria-label="Search activity"
            className="w-80 border-b border-neutral-200 bg-transparent py-2 text-read text-brand-navy outline-none placeholder:text-neutral-400"
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

/* ─── Test workspace ─── */

const SAMPLE_LANGUAGE_OPTIONS: { value: SampleLanguage; label: string }[] = [
  { value: "filipino", label: "Filipino" },
  { value: "english", label: "English" },
  { value: "hybrid", label: "Hybrid (Taglish)" },
  { value: "bisaya", label: "Bisaya" },
  { value: "ilocano", label: "Ilocano" },
  { value: "hiligaynon", label: "Hiligaynon" },
  { value: "kapampangan", label: "Kapampangan" },
  { value: "waray", label: "Waray" },
]

function verdictMeta(action: string | null | undefined) {
  const value = (action ?? "accept").replace(/_/g, " ")
  if (value === "reject as irrelevant") return { icon: Ban, tone: "text-sos" }
  if (["escalate as emergency", "request more information", "manual review"].includes(value)) {
    return { icon: TriangleAlert, tone: "text-amber-500" }
  }
  return { icon: CircleCheck, tone: "text-green-600" }
}

function TestWorkspace({ config }: { config: ConcernClassificationConfig }) {
  const [selectedCategory, setSelectedCategory] = useState("infrastructure")
  const [files, setFiles] = useState<File[]>([])
  const [pin, setPin] = useState<LocationPin | null>(null)
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files])
  useEffect(() => {
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [previews])
  const [description, setDescription] = useState("")
  const [sampleLanguage, setSampleLanguage] = useState<SampleLanguage>("filipino")
  const [generating, setGenerating] = useState(false)
  const [reportResult, setReportResult] = useState<ReportValidationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState(112)
  const textareaDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const MAX_PHOTOS = 3

  const activeCategories = useMemo(
    () => config.categories.filter((category) => category.enabled),
    [config.categories],
  )

  const firstActiveKey = activeCategories[0]?.key
  if (activeCategories.length && firstActiveKey && !activeCategories.some((c) => c.key === selectedCategory)) {
    setSelectedCategory(firstActiveKey)
  }

  async function runTest() {
    if (!description.trim()) return
    setBusy(true)
    setReportResult(null)
    try {
      setReportResult(
        await testConcernSubmission({
          files,
          category: selectedCategory,
          description: description.trim(),
          latitude: pin?.lat ?? null,
          longitude: pin?.lng ?? null,
        }),
      )
    } catch (error) {
      toast.error(describeApiError(error, "The sample report could not be checked."))
    } finally {
      setBusy(false)
    }
  }

  async function generateSample() {
    if (generating) return
    setGenerating(true)
    setReportResult(null)
    try {
      const { description: next } = await generateSampleDescription({
        files,
        category: selectedCategory,
        mode: "matching",
        language: sampleLanguage,
      })
      setDescription(next)
    } catch (error) {
      toast.error(describeApiError(error, "The sample could not be generated."))
    } finally {
      setGenerating(false)
    }
  }

  const verdict = verdictMeta(reportResult?.recommended_action)
  // Mirrors the category's own Report requirements (photo/description/location)
  // from the Categories screen, so the button only goes active once this
  // sample would actually satisfy what that category demands.
  const requirements = activeCategories.find((category) => category.key === selectedCategory)
  const descriptionOk =
    !requirements?.description_required || description.trim().length >= config.minimum_description_length
  const photoOk = !requirements?.photo_required || files.length > 0
  const locationOk = !requirements?.location_required || pin != null
  const canCheck = descriptionOk && photoOk && locationOk

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Filed under</label>
        <RuleMenu
          full
          value={selectedCategory}
          options={activeCategories.map((category) => ({ value: category.key, label: category.label }))}
          onChange={setSelectedCategory}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []).slice(0, MAX_PHOTOS - files.length)
          if (picked.length) {
            setFiles((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS))
            setReportResult(null)
          }
          event.target.value = ""
        }}
      />

      <div>
        <div className="grid grid-cols-3 gap-3">
          {previews.map((url, index) => (
            <div key={url} className="group relative">
              <img
                src={url}
                alt={`Sample photo ${index + 1}`}
                className="aspect-square w-full rounded-xl border border-neutral-200 object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  setFiles((prev) => prev.filter((_, i) => i !== index))
                  setReportResult(null)
                }}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-neutral-800/50 text-neutral-200 transition-colors hover:bg-neutral-800/70"
              >
                <XIcon className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          ))}
          {files.length < MAX_PHOTOS ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(
                "flex items-center justify-center rounded-xl bg-neutral-100 text-center transition-colors hover:bg-neutral-200",
                files.length === 0
                  ? "col-span-3 aspect-[3/1] w-full flex-col gap-1.5"
                  : "aspect-square w-full"
              )}
            >
              {files.length === 0 ? (
                <>
                  <UploadCloudIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
                  <span className="text-[13px] font-medium text-neutral-500">Add a sample photo</span>
                </>
              ) : (
                <PlusIcon className="size-8 text-neutral-400" strokeWidth={1.5} aria-hidden />
              )}
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <div className="relative">
          <textarea
            value={description}
            onChange={(event) => {
              setDescription(event.target.value)
              setReportResult(null)
            }}
            maxLength={255}
            placeholder="Describe what happened, where it is, and what needs attention."
            style={{ height }}
            className="w-full resize-none rounded-[14px] border-[1.5px] border-neutral-300 bg-white p-4 pb-8 text-[15px] font-medium text-neutral-900 outline-none transition-colors focus:border-neutral-500"
          />
          <span className="pointer-events-none absolute bottom-2.5 right-3 text-xs font-medium tabular-nums text-neutral-400">
            {description.length}/255
          </span>
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize touch-none"
            onPointerDown={(event) => {
              textareaDragRef.current = { startY: event.clientY, startHeight: height }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = textareaDragRef.current
              if (!drag) return
              setHeight(Math.min(320, Math.max(112, drag.startHeight + (event.clientY - drag.startY))))
            }}
            onPointerUp={() => {
              textareaDragRef.current = null
            }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-3">
          <span className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void generateSample()}
              disabled={generating}
              className="text-[13px] font-semibold text-brand-navy underline underline-offset-4 transition-opacity hover:opacity-75 disabled:opacity-60"
            >
              {generating ? "Generating…" : "Generate sample"}
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
        <label className="mb-1.5 block text-[13px] font-semibold text-neutral-500">Location</label>
        <LocationPinMap pin={pin} onPinChange={setPin} />
      </div>

      <SheetPrimaryButton
        type="button"
        onClick={() => void runTest()}
        disabled={!canCheck || busy}
        className="bg-brand-navy text-white hover:bg-brand-navy/85 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:hover:bg-neutral-200"
      >
        {busy ? "Checking…" : "Check this sample"}
      </SheetPrimaryButton>

      {reportResult ? (
        <div className="space-y-5 border-t border-neutral-200 pt-5">
          <div className="flex items-start gap-3">
            <verdict.icon className={cn("mt-0.5 size-5 shrink-0", verdict.tone)} strokeWidth={2} aria-hidden />
            <div>
              <p className="text-[16px] font-bold leading-snug text-neutral-900">
                {displayValue(reportResult.recommended_action || "accept")}
              </p>
              {reportResult.explanation ? (
                <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">{reportResult.explanation}</p>
              ) : null}
            </div>
          </div>

          {reportResult.location ? (
            <div className="flex items-start gap-3">
              {reportResult.location.accepted ? (
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-green-600" strokeWidth={2} aria-hidden />
              ) : reportResult.location.action === "block" ? (
                <Ban className="mt-0.5 size-5 shrink-0 text-sos" strokeWidth={2} aria-hidden />
              ) : (
                <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
              )}
              <p className="text-[14px] font-medium leading-relaxed text-neutral-900">
                {reportResult.location.accepted
                  ? "The pinned location passes the boundary and acceptance-zone checks."
                  : reportResult.location.summary ||
                    reportResult.location.message ||
                    "The pinned location is outside the barangay area."}
              </p>
            </div>
          ) : null}

          {reportResult.image_uploaded && reportResult.image_review_succeeded === false ? (
            <p className="text-[13px] font-medium text-neutral-500">
              The photo could not be described — this result was written from the text alone.
            </p>
          ) : null}

          {previews[0] ? (
            <div className="space-y-3">
              <figure>
                <img
                  src={previews[0]}
                  alt="The sample photo as submitted"
                  className="max-h-40 w-full rounded-[14px] border border-neutral-200 object-contain"
                />
                <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                  {reportResult.privacy?.protected_image ? "As submitted" : "Sample photo"}
                </figcaption>
              </figure>
              {reportResult.privacy?.protected_image ? (
                <figure>
                  <img
                    src={reportResult.privacy.protected_image}
                    alt="The sample photo with sensitive areas blurred"
                    className="max-h-40 w-full rounded-[14px] border border-green-200 object-contain"
                  />
                  <figcaption className="mt-1 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                    What residents would see
                  </figcaption>
                </figure>
              ) : null}
            </div>
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
                  <li key={line as string} className="flex gap-2 text-sm font-medium leading-relaxed text-neutral-900">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-neutral-400" />
                    <span className="min-w-0 break-words">{line}</span>
                  </li>
                ))}
            </ul>
          </div>

          {reportResult.detected_objects?.length ? (
            <div>
              <SectionLabel>Observed in the photo</SectionLabel>
              <p className="mt-1.5 text-sm font-medium capitalize text-neutral-900">
                {reportResult.detected_objects.join(" · ")}
              </p>
            </div>
          ) : null}

          {reportResult.image_uploaded ? (
            <div>
              <SectionLabel>Privacy protection</SectionLabel>
              <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-900">
                {SAMPLE_PRIVACY_COPY[reportResult.privacy?.state ?? "unchecked"]}
              </p>
              {reportResult.privacy?.detected_classes?.length ? (
                <p className="mt-1 text-sm font-medium text-neutral-700">
                  Sensitive areas: {reportResult.privacy.detected_classes.join(" · ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {reportResult.missing_information?.length ? (
            <div>
              <SectionLabel>Additional information needed</SectionLabel>
              <ul className="mt-1.5 space-y-1">
                {reportResult.missing_information.map((item) => (
                  <li key={item} className="text-sm font-medium text-neutral-900">· {item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ─── Main page ─── */

export default function ConcernClassificationPage() {
  usePageTitle("Report checking")
  const [config, setConfig] = useState<ConcernClassificationConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [configureOpen, setConfigureOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getConcernClassificationConfig()
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        setSavedSnapshot(JSON.stringify(next))
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load these settings.")))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const strictness = detectStrictness(config)
  const dirty = useMemo(
    () => savedSnapshot !== null && JSON.stringify(config) !== savedSnapshot,
    [config, savedSnapshot],
  )

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
      setSavedSnapshot(JSON.stringify(saved))
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
        dirty={dirty}
      />
    </ConfigShell>
  )
}
