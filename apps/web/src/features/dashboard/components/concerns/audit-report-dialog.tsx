import { useCallback, useEffect, useState } from "react"
import { Loader2Icon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { apiRequest } from "@/lib/api"
import { SheetDialog, SheetPrimaryButton, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"

type ReportScope = "current_view" | "custom" | "specific_concerns"
type ReportPreset = "summary" | "detailed" | "concern_history"
type ReportFormat = "pdf" | "csv"

interface ConcernSelectItem {
  id: string
  tracking_id: string
  category: string
  title: string
  status: string
  created_at: string
}

interface ReportConfig {
  scope: ReportScope
  preset: ReportPreset
  format: ReportFormat
  dateFrom: string
  dateTo: string
  category: string
  eventResult: string
  concernStatus: string
  trackingId: string
  actor: string
  actorRole: string
  barangay: string
  concernCategory: string
  priority: string
  actionType: string
  selectedConcerns: ConcernSelectItem[]
}

const SCOPE_OPTIONS = [
  { key: "current_view" as const, label: "Current Audit Log View" },
  { key: "custom" as const, label: "Custom Report" },
  { key: "specific_concerns" as const, label: "Specific Concerns" },
]

const RECORD_OPTIONS = [
  { key: "all" as const, label: "All Matching Records" },
  { key: "specific" as const, label: "Specific Concerns" },
]

const AUDIT_CATEGORIES = [
  { key: "all", label: "All Categories" },
  { key: "automated", label: "Automated decisions" },
  { key: "content", label: "Content & privacy" },
  { key: "access", label: "Access & identity" },
  { key: "concerns", label: "Concerns" },
  { key: "other", label: "Other" },
]

const EVENT_RESULTS = [
  { key: "all", label: "All Results" },
  { key: "success", label: "Success" },
  { key: "failure", label: "Failure" },
  { key: "pending", label: "Pending" },
]

const CONCERN_STATUSES = [
  { key: "all", label: "All Statuses" },
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Under Review" },
  { key: "assigned", label: "Assigned" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "rejected", label: "Rejected" },
  { key: "appealed", label: "Appealed" },
]

const ACTOR_ROLES = [
  { key: "all", label: "All Roles" },
  { key: "barangay_official", label: "Barangay Official" },
  { key: "first_responder", label: "First Responder" },
  { key: "resident", label: "Resident" },
]

const PRIORITIES = [
  { key: "all", label: "All Priorities" },
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
]

const ACTION_SOURCES = [
  { key: "all", label: "All Sources" },
  { key: "automated", label: "Automated" },
  { key: "manual", label: "Manual" },
]

const PRESET_LABELS: Record<ReportPreset, string> = {
  summary: "Summary",
  detailed: "Detailed",
  concern_history: "Concern History",
}

const DEFAULT_CONFIG: ReportConfig = {
  scope: "current_view",
  preset: "summary",
  format: "pdf",
  dateFrom: "",
  dateTo: "",
  category: "all",
  eventResult: "all",
  concernStatus: "all",
  trackingId: "",
  actor: "",
  actorRole: "all",
  barangay: "",
  concernCategory: "all",
  priority: "all",
  actionType: "all",
  selectedConcerns: [],
}

interface AuditReportDialogProps {
  open: boolean
  onClose: () => void
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { key: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="text-[13px] font-medium text-neutral-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function AuditReportDialog({ open, onClose }: AuditReportDialogProps) {
  const [config, setConfig] = useState<ReportConfig>(DEFAULT_CONFIG)
  const [concernSearch, setConcernSearch] = useState("")
  const [concernResults, setConcernResults] = useState<ConcernSelectItem[]>([])
  const [concernLoading, setConcernLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [noResults, setNoResults] = useState(false)
  const [error, setError] = useState("")
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const scope = config.scope

  useEffect(() => {
    if (open) {
      setConfig(DEFAULT_CONFIG)
      setConcernSearch("")
      setConcernResults([])
      setNoResults(false)
      setError("")
      setAdvancedOpen(false)
    }
  }, [open])

  const updateConfig = useCallback(<K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  const toggleConcern = useCallback((concern: ConcernSelectItem) => {
    setConfig((prev) => {
      const exists = prev.selectedConcerns.find((c) => c.id === concern.id)
      if (exists) {
        return { ...prev, selectedConcerns: prev.selectedConcerns.filter((c) => c.id !== concern.id) }
      }
      return { ...prev, selectedConcerns: [...prev.selectedConcerns, concern] }
    })
  }, [])

  const selectAllConcerns = useCallback(() => {
    setConfig((prev) => ({ ...prev, selectedConcerns: [...concernResults] }))
  }, [concernResults])

  const handleConcernSearch = useCallback(() => {
    const q = concernSearch.trim()
    if (!q) {
      setConcernResults([])
      return
    }
    setConcernLoading(true)
    setError("")
    apiRequest<{ concerns: ConcernSelectItem[] }>(`/config/concerns/search/?q=${encodeURIComponent(q)}`)
      .then((data) => {
        setConcernResults(data.concerns ?? [])
        setNoResults(data.concerns.length === 0)
      })
      .catch(() => {
        setError("Could not search concerns.")
        setConcernResults([])
      })
      .finally(() => setConcernLoading(false))
  }, [concernSearch])

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    setError("")
    const payload: Record<string, unknown> = {
      scope: config.scope,
      preset: config.preset,
      format: config.format,
      date_from: config.dateFrom || undefined,
      date_to: config.dateTo || undefined,
      category: config.category !== "all" ? config.category : undefined,
      event_result: config.eventResult !== "all" ? config.eventResult : undefined,
      concern_status: config.concernStatus !== "all" ? config.concernStatus : undefined,
      tracking_id: config.trackingId || undefined,
      actor: config.actor || undefined,
      actor_role: config.actorRole !== "all" ? config.actorRole : undefined,
      barangay: config.barangay || undefined,
      concern_category: config.concernCategory !== "all" ? config.concernCategory : undefined,
      priority: config.priority !== "all" ? config.priority : undefined,
      action_type: config.actionType !== "all" ? config.actionType : undefined,
      concern_ids: config.scope === "specific_concerns" ? config.selectedConcerns.map((c) => c.id) : undefined,
    }
    apiRequest<{ download_url: string }>("/config/audit-log/report/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((data) => {
        window.open(data.download_url, "_blank")
      })
      .catch(() => {
        setError("Report generation failed.")
      })
      .finally(() => setGenerating(false))
  }, [config])

  const matchingEvents = 0

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title={<>Generate <span className="text-brand-orange">Report</span></>}
      titleClassName="text-center"
      size="wide"
      draggable
      bodyScrollable
      className="h-auto max-h-[min(800px,92dvh)]"
      bodyClassName="px-5 sm:px-7"
    >
      <div className="space-y-5 py-1">
        <section>
          <h3 className="text-[13px] font-semibold text-neutral-500 uppercase tracking-wide">Report Scope</h3>
          <div className="mt-2 space-y-2">
            {SCOPE_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  scope === opt.key ? "border-brand-orange bg-orange-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="reportScope"
                  checked={scope === opt.key}
                  onChange={() => updateConfig("scope", opt.key)}
                  className="accent-brand-orange"
                />
                <span className="text-[15px] font-medium text-neutral-900">{opt.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[13px] font-semibold text-neutral-500 uppercase tracking-wide">Report Records</h3>
          <div className="mt-2 space-y-2">
            {RECORD_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  opt.key === "specific" ? "border-brand-orange bg-orange-50" : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
              >
                <input
                  type="radio"
                  name="reportRecords"
                  checked={config.scope === "specific_concerns"}
                  onChange={() => updateConfig("scope", opt.key === "specific" ? "specific_concerns" : "current_view")}
                  className="accent-brand-orange"
                />
                <span className="text-[15px] font-medium text-neutral-900">{opt.label}</span>
              </label>
            ))}
          </div>
        </section>

        {scope === "specific_concerns" && (
          <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <h3 className="text-[13px] font-semibold text-neutral-500 uppercase tracking-wide">Search Concerns</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={concernSearch}
                onChange={(e) => setConcernSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConcernSearch()}
                placeholder="Search by tracking ID, reporter, category, or keyword"
                className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
              />
              <button
                type="button"
                onClick={handleConcernSearch}
                disabled={concernLoading}
                className="rounded-lg bg-brand-navy px-4 py-2 text-[14px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {concernLoading ? "..." : "Search"}
              </button>
            </div>
            {concernResults.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={selectAllConcerns} className="text-[13px] font-medium text-brand-orange hover:underline">
                  Select all {concernResults.length} results
                </button>
              </div>
            )}
            {noResults && !concernLoading && (
              <p className="text-[13px] text-neutral-500">No matching concerns found.</p>
            )}
            <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto">
              {config.selectedConcerns.map((c) => (
                <span
                  key={c.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-orange/10 px-3 py-1 text-[13px] font-medium text-brand-orange"
                >
                  {c.tracking_id} · {c.category} · {c.status}
                </span>
              ))}
            </div>
            {concernResults.length > 0 && (
              <div className="space-y-1 max-h-[160px] overflow-y-auto">
                {concernResults.map((c) => {
                  const selected = config.selectedConcerns.some((sc) => sc.id === c.id)
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${
                        selected ? "bg-brand-orange/10" : "bg-white hover:bg-neutral-100"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleConcern(c)}
                        className="accent-brand-orange"
                      />
                      <span className="font-medium text-neutral-900">{c.tracking_id}</span>
                      <span className="text-neutral-500">{c.category}</span>
                      <span className="ml-auto text-neutral-400">{c.status}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </section>
        )}

        <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="text-[13px] font-semibold text-neutral-500 uppercase tracking-wide">Filters</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-[13px] font-medium text-neutral-700">
              Date Range
              <div className="flex gap-2 mt-1">
                <input
                  type="date"
                  value={config.dateFrom}
                  onChange={(e) => updateConfig("dateFrom", e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
                />
                <input
                  type="date"
                  value={config.dateTo}
                  onChange={(e) => updateConfig("dateTo", e.target.value)}
                  className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
                />
              </div>
            </label>
            <SelectRow label="Category" value={config.category} options={AUDIT_CATEGORIES} onChange={(v) => updateConfig("category", v)} />
            <SelectRow label="Result" value={config.eventResult} options={EVENT_RESULTS} onChange={(v) => updateConfig("eventResult", v)} />
            <SelectRow label="Concern Status" value={config.concernStatus} options={CONCERN_STATUSES} onChange={(v) => updateConfig("concernStatus", v)} />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex items-center gap-2 text-[13px] font-medium text-brand-orange hover:underline"
          >
            Advanced Filters {advancedOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
          </button>

          {advancedOpen && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="text-[13px] font-medium text-neutral-700">Tracking ID</label>
                <input
                  type="text"
                  value={config.trackingId}
                  onChange={(e) => updateConfig("trackingId", e.target.value)}
                  placeholder="Enter tracking ID"
                  className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-neutral-700">Reporter</label>
                <input
                  type="text"
                  value={config.actor}
                  onChange={(e) => updateConfig("actor", e.target.value)}
                  placeholder="Search reporter"
                  className="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
                />
              </div>
              <SelectRow label="Actor Role" value={config.actorRole} options={ACTOR_ROLES} onChange={(v) => updateConfig("actorRole", v)} />
              <SelectRow label="Barangay" value={config.barangay} options={[{ key: "all", label: "All Areas" }]} onChange={(v) => updateConfig("barangay", v)} />
              <SelectRow label="Concern Category" value={config.concernCategory} options={[{ key: "all", label: "All Categories" }, { key: "infrastructure", label: "Infrastructure" }, { key: "environment", label: "Environment" }, { key: "public_safety", label: "Public Safety" }, { key: "vehicle", label: "Vehicle" }, { key: "others", label: "Others" }]} onChange={(v) => updateConfig("concernCategory", v)} />
              <SelectRow label="Priority" value={config.priority} options={PRIORITIES} onChange={(v) => updateConfig("priority", v)} />
              <SelectRow label="Action Source" value={config.actionType} options={ACTION_SOURCES} onChange={(v) => updateConfig("actionType", v)} />
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <h3 className="text-[13px] font-semibold text-neutral-500 uppercase tracking-wide">Report Type</h3>
          <div className="space-y-2">
            {(["summary", "detailed", "concern_history"] as ReportPreset[]).map((preset) => (
              <label key={preset} className="flex cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name="reportPreset"
                  checked={config.preset === preset}
                  onChange={() => updateConfig("preset", preset)}
                  className="accent-brand-orange"
                />
                <span className="text-[15px] font-medium text-neutral-900">{PRESET_LABELS[preset]}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <span className="text-[13px] font-medium text-neutral-700">Format</span>
            <select
              value={config.format}
              onChange={(e) => updateConfig("format", e.target.value as ReportFormat)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-[14px] text-neutral-900 outline-none focus:border-brand-orange"
            >
              <option value="pdf">PDF</option>
            </select>
          </div>
        </section>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</p>
        )}

        <div className="flex gap-3">
          <SheetSecondaryButton onClick={onClose}>Cancel</SheetSecondaryButton>
          <SheetPrimaryButton onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden />
                Generating...
              </>
            ) : (
              "Generate Report"
            )}
          </SheetPrimaryButton>
        </div>

        {matchingEvents > 0 && (
          <p className="text-[13px] text-neutral-500 text-center">
            {matchingEvents} audit events will be included.
          </p>
        )}
      </div>
    </SheetDialog>
  )
}