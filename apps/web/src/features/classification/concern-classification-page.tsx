import { useEffect, useMemo, useState } from "react"
import {
  BotIcon,
  CircleQuestionMarkIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SearchIcon,
  TestTube2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigShell, ConfigHeroAction } from "@/features/dashboard/components/config/config-shell"
import {
  SheetDialog,
  SheetIconButton,
  SheetList,
  SheetOptionRow,
  SheetPrimaryButton,
  SheetSecondaryButton,
  SheetSectionLabel,
  SheetToggleRow,
} from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"

import {
  RuleMenu,
} from "./shared"
import {
  getConcernClassificationConfig,
  getLlmDecisionLog,
  getValidationActivity,
  saveConcernClassificationConfig,
  type ConcernClassificationConfig,
  type ValidationActivityResponse,
} from "./api"
import {
  applyStrictness,
  detectStrictness,
  EMERGENCY_MEDIA_INTEGRITY_OPTIONS,
  MEDIA_INTEGRITY_OPTIONS,
  MISMATCH_OPTIONS,
  STRICTNESS_PRESETS,
} from "./strictness"
import { ConcernTestWorkspace } from "./test-workspace-concerns"
import { EmergencyTestWorkspace } from "./test-workspace-emergencies"
import { SmsChatInput, SmsChatPanel, SmsCommandGuide, SmsTestWorkspace, SenderPill } from "./test-workspace-sms"
import { testSmsSimulation } from "./api"
import { CommunityModerationTestWorkspace } from "./test-workspace-community"
import { DecisionLogTab } from "./decision-log-tab"

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
  street_imagery_enabled: false,
  street_imagery_categories: [],
  street_imagery_radius_meters: 50,
  street_imagery_action: "request_resubmission",
  photo_duplicate_llm_enabled: true,
  photo_duplicate_candidate_limit: 3,
  flag_irrelevant: true,
  suspicious_terms: ["test", "testing", "asdf", "qwerty", "12345"],
  category_keywords: {},
  categories: [],
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
  onOpenTest,
}: {
  open: boolean
  onClose: () => void
  config: ConcernClassificationConfig
  onUpdate: <K extends keyof ConcernClassificationConfig>(key: K, value: ConcernClassificationConfig[K]) => void
  onSave: () => void
  busy: boolean
  dirty: boolean
  onOpenTest: () => void
}) {
  const strictness = detectStrictness(config)

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="Validation rules"
      description="Set how the system handles reports before they reach your queue."
      size="wide"
      actions={
        <button
          type="button"
          aria-label="Test a sample report"
          title="Test a sample report"
          onClick={() => { onOpenTest(); onClose() }}
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
            <RuleMenu
              value={config.content_safety_spam_action ?? "auto_reject"}
              options={[
                { value: "auto_reject", label: "Reject automatically" },
                { value: "hold", label: "Hold for review" },
              ]}
              onChange={(value) => onUpdate("content_safety_spam_action", value as ConcernClassificationConfig["content_safety_spam_action"])}
            />
          }
        />
        <SheetOptionRow
          title="Abusive or harassing language"
          trailing={
            <RuleMenu
              value={config.content_safety_abusive_action ?? "hold"}
              options={[
                { value: "hold", label: "Hold for review" },
                { value: "auto_reject", label: "Reject automatically" },
              ]}
              onChange={(value) => onUpdate("content_safety_abusive_action", value as ConcernClassificationConfig["content_safety_abusive_action"])}
            />
          }
        />
        <SheetOptionRow
          title="Possible threat or danger"
          trailing={
            <RuleMenu
              value={config.content_safety_threat_action ?? "accept_flag_notify"}
              options={[
                { value: "accept_flag_notify", label: "Accept, flag & notify" },
                { value: "hold", label: "Hold for review" },
              ]}
              onChange={(value) => onUpdate("content_safety_threat_action", value as ConcernClassificationConfig["content_safety_threat_action"])}
            />
          }
        />
        <SheetOptionRow
          title="Sensitive or graphic content"
          trailing={
            <RuleMenu
              value={config.content_safety_sensitive_action ?? "restrict_hold"}
              options={[
                { value: "restrict_hold", label: "Restrict & hold for review" },
                { value: "auto_blur_accept", label: "Auto-blur & accept" },
              ]}
              onChange={(value) => onUpdate("content_safety_sensitive_action", value as ConcernClassificationConfig["content_safety_sensitive_action"])}
            />
          }
        />
        <SheetOptionRow
          title="Edited or AI-made photo"
          description="Reads the picture itself, not the file. Catches a screenshot of an AI image, an object pasted into a real scene, or a photo of a screen."
          trailing={
            <RuleMenu
              value={config.media_integrity_action ?? "hold"}
              options={MEDIA_INTEGRITY_OPTIONS.map(({ value, label }) => ({ value, label }))}
              onChange={(value) => onUpdate("media_integrity_action", value as ConcernClassificationConfig["media_integrity_action"])}
            />
          }
        />
      </SheetList>
      <SheetToggleRow
        id="media-integrity-enabled"
        label="Check photos for editing"
        description="Turn off to skip the picture check entirely."
        checked={config.media_integrity_enabled ?? true}
        onChange={(checked) => onUpdate("media_integrity_enabled", checked)}
      />
      {config.media_integrity_enabled === false ? null : (
        <>
          <SheetToggleRow
            id="media-integrity-second-opinion"
            label="Check a flagged photo twice"
            description="A flagged photo is looked at again before anything happens. Fewer wrong flags, one extra check."
            checked={config.media_integrity_second_opinion_enabled ?? true}
            onChange={(checked) => onUpdate("media_integrity_second_opinion_enabled", checked)}
          />
          <SheetList>
            <SheetOptionRow
              title="Emergency photos"
              description="An emergency is always sent to responders first. This check runs after, and can never hold or reject an alert."
              trailing={
                <RuleMenu
                  value={config.media_integrity_emergency_action ?? "flag_notify"}
                  options={EMERGENCY_MEDIA_INTEGRITY_OPTIONS.map(({ value, label }) => ({ value, label }))}
                  onChange={(value) => onUpdate("media_integrity_emergency_action", value as ConcernClassificationConfig["media_integrity_emergency_action"])}
                />
              }
            />
          </SheetList>
        </>
      )}

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
        <SheetToggleRow
          id="photo-duplicate-llm"
          label="Compare photos with AI"
          description="When a likely match is found, the AI also compares the photos to confirm it is the same issue."
          checked={config.photo_duplicate_llm_enabled !== false}
          onChange={(checked) => onUpdate("photo_duplicate_llm_enabled", checked)}
        />
        {config.photo_duplicate_llm_enabled !== false ? (
          <SheetOptionRow
            title="Photos compared per check"
            trailing={
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={config.photo_duplicate_candidate_limit ?? 3}
                  onChange={(e) => onUpdate("photo_duplicate_candidate_limit", Number(e.target.value))}
                  className="h-8 w-16 rounded-full border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-neutral-400"
                />
                <span className="text-xs text-neutral-500">max</span>
              </div>
            }
          />
        ) : null}
      </SheetList>

      {/* Street view verification */}
      <SheetSectionLabel>Street view verification</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">
        For selected categories, the system fetches the newest street-level photo of the pinned location and compares it with the submitted photo.
      </p>
      <SheetToggleRow
        id="street-imagery-enabled"
        label="Verify reports against street imagery"
        description="Runs only for the categories chosen below and only when a photo and pin are present."
        checked={config.street_imagery_enabled === true}
        onChange={(checked) => onUpdate("street_imagery_enabled", checked)}
      />
      {config.street_imagery_enabled === true ? (
        <SheetList className="mt-3">
          <div className="px-4 py-3">
            <p className="mb-2 text-xs font-medium text-neutral-600">Categories to verify</p>
            <div className="flex flex-wrap gap-1.5">
              {config.categories.filter((c) => c.enabled).map((category) => {
                const active = (config.street_imagery_categories ?? []).includes(category.key)
                return (
                  <button
                    key={category.key}
                    type="button"
                    onClick={() => {
                      const current = config.street_imagery_categories ?? []
                      onUpdate(
                        "street_imagery_categories",
                        active ? current.filter((key) => key !== category.key) : [...current, category.key],
                      )
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "border-brand-navy bg-brand-navy text-white"
                        : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-800",
                    )}
                  >
                    {category.label}
                  </button>
                )
              })}
            </div>
          </div>
          <SheetOptionRow
            title="Search radius"
            trailing={
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  value={config.street_imagery_radius_meters ?? 50}
                  onChange={(e) => onUpdate("street_imagery_radius_meters", Number(e.target.value))}
                  className="h-8 w-16 rounded-full border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-neutral-400"
                />
                <span className="text-xs text-neutral-500">meters</span>
              </div>
            }
          />
          <SheetOptionRow
            title="When the street photo does not show the issue"
            trailing={
              <RuleMenu
                value={config.street_imagery_action ?? "request_resubmission"}
                options={[
                  { value: "warn", label: "Warn reviewer only" },
                  { value: "request_resubmission", label: "Request resubmission" },
                  { value: "reject", label: "Reject automatically" },
                ]}
                onChange={(value) => onUpdate("street_imagery_action", value as ConcernClassificationConfig["street_imagery_action"])}
              />
            }
          />
        </SheetList>
      ) : null}

      {/* Emergency triage */}
      <SheetSectionLabel>Emergency triage</SheetSectionLabel>
      <p className="mb-2 text-xs text-neutral-500">How the system confirms a matched emergency before routing it.</p>
      <SheetToggleRow
        id="ongoing-emergency-confirmation"
        label="Ask if this is an ongoing emergency"
        description="Before routing a matched emergency type to a responder, confirm with the resident that it is still happening."
        checked={config.require_ongoing_emergency_confirmation !== false}
        onChange={(checked) => onUpdate("require_ongoing_emergency_confirmation", checked)}
      />

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

    </SheetDialog>
  )
}

/* ─── Test dialog ─── */

const TEST_TABS = [
  { key: "concerns", label: "Concerns" },
  { key: "emergencies", label: "Emergencies" },
  { key: "sms", label: "SMS" },
  { key: "community", label: "Community content" },
  { key: "log", label: "Log" },
] as const
type TestTabKey = (typeof TEST_TABS)[number]["key"]

function TestDialog({
  open,
  onClose,
  config,
}: {
  open: boolean
  onClose: () => void
  config: ConcernClassificationConfig
}) {
  const [tab, setTab] = useState<TestTabKey>("concerns")
  const [smsPanelOpen, setSmsPanelOpen] = useState(false)
  const [smsHelpOpen, setSmsHelpOpen] = useState(false)
  const [smsMessage, setSmsMessage] = useState("")
  const [smsSender, setSmsSender] = useState<"registered" | "unknown">("registered")
  const [smsResult, setSmsResult] = useState<import("./api").SmsSimulationResult | null>(null)
  const [smsBusy, setSmsBusy] = useState(false)

  async function runSms() {
    const text = smsMessage.trim()
    if (!text) return
    setSmsBusy(true)
    try {
      setSmsResult(await testSmsSimulation({ message: text, sender: smsSender }))
    } catch (error) {
      toast.error(describeApiError(error, "The sample text could not be processed."))
    } finally {
      setSmsBusy(false)
    }
  }

  function resetSms() {
    setSmsMessage("")
    setSmsSender("registered")
    setSmsResult(null)
    setSmsBusy(false)
  }

  return (
    <>
    <SheetDialog
      open={open}
      onClose={() => {
        setTab("concerns")
        resetSms()
        setSmsPanelOpen(false)
        setSmsHelpOpen(false)
        onClose()
      }}
      title="LLM Decisions"
      description="Test how automatic review classifies concerns, emergencies, SMS texts, and community content — nothing here is filed."
      size="wide"
      actions={
        tab === "sms" ? (
          <button
            type="button"
            onClick={() => setSmsPanelOpen(true)}
            aria-label="Open SMS preview"
            title="Open SMS preview"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            <MessageSquareIcon className="size-[18px]" strokeWidth={2} />
          </button>
        ) : null
      }
    >
      <div className="mb-5 flex gap-0.5 rounded-full bg-neutral-100 p-1">
        {TEST_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); if (t.key !== "sms") setSmsPanelOpen(false) }}
            className={cn(
              "flex-1 rounded-full py-2 text-[13px] font-medium transition-colors",
              tab === t.key ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "concerns" ? <ConcernTestWorkspace config={config} /> : null}
      {tab === "emergencies" ? <EmergencyTestWorkspace /> : null}
      {tab === "sms" ? (
        <SmsTestWorkspace
          message={smsMessage}
          setMessage={setSmsMessage}
          sender={smsSender}
          setSender={setSmsSender}
          result={smsResult}
          busy={smsBusy}
        />
      ) : null}
      {tab === "community" ? <CommunityModerationTestWorkspace /> : null}
      {tab === "log" ? <DecisionLogTab /> : null}
    </SheetDialog>

    <SheetDialog
      open={smsPanelOpen}
      onClose={() => setSmsPanelOpen(false)}
      onBack={() => setSmsPanelOpen(false)}
      title="SMS Preview"
      size="wide"
      actions={
        <>
          <SenderPill sender={smsSender} setSender={setSmsSender} />
          <SheetIconButton label="Sample commands" onClick={() => setSmsHelpOpen(true)} className="bg-transparent text-neutral-400 hover:bg-transparent hover:text-neutral-700">
            <CircleQuestionMarkIcon className="size-6" strokeWidth={2} />
          </SheetIconButton>
          <SheetIconButton label="Reset simulation" onClick={resetSms} className="bg-transparent text-neutral-400 hover:bg-transparent hover:text-neutral-700">
            <RotateCcwIcon className="size-6" strokeWidth={2} />
          </SheetIconButton>
        </>
      }
      footer={
        <SmsChatInput
          message={smsMessage}
          setMessage={setSmsMessage}
          busy={smsBusy}
          onSend={() => void runSms()}
        />
      }
    >
      <SmsChatPanel message={smsMessage} result={smsResult} busy={smsBusy} />
    </SheetDialog>

    <SheetDialog
      open={smsHelpOpen}
      onClose={() => setSmsHelpOpen(false)}
      onBack={() => setSmsHelpOpen(false)}
      title="Sample commands"
      description="What a resident can text the hotline."
    >
      <SmsCommandGuide />
    </SheetDialog>
    </>
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

/* ─── Main page ─── */

export default function ConcernClassificationPage() {
  usePageTitle("Report checking")
  const [config, setConfig] = useState<ConcernClassificationConfig>(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [logCount, setLogCount] = useState<number | null>(null)

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

  useEffect(() => {
    let cancelled = false
    void getLlmDecisionLog({ page: 1, page_size: 1 })
      .then((response) => {
        if (!cancelled) setLogCount(response.count)
      })
      .catch(() => {
        // Non-critical: the stat just stays blank if the log can't be reached.
      })
    return () => {
      cancelled = true
    }
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
        { label: "Logged decisions", value: logCount ?? "—" },
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
        onOpenTest={() => setTestOpen(true)}
      />

      <TestDialog open={testOpen} onClose={() => setTestOpen(false)} config={config} />
    </ConfigShell>
  )
}
