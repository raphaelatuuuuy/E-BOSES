import { useEffect, useMemo, useState } from "react"
import { CheckCircle2Icon, ChevronRightIcon, CircleXIcon, Clock3Icon, PencilLineIcon, ShieldAlertIcon, TestTube2Icon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { apiRequest } from "@/lib/api"
import { usePageTitle } from "@/hooks/use-page-title"
import { ConfigBreadcrumb, ConfigHeroAction } from "@/features/dashboard/components/config/config-shell"
import { SheetDialog, SheetIconButton } from "@/features/dashboard/components/sheet-dialog"
import { FilterRow, ListSearch, PAGE_SIZE } from "@/components/ui/list-controls"
import { ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationTable, ConfigurationTableRow } from "@/features/dashboard/components/config/configuration-table"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"
import { AuditTestDialog } from "@/features/classification/audit-test-dialog"
import { DecisionDetailsDialog, type DisplayLogEntry } from "@/features/classification/decision-log-tab"
import { getLlmDecisionLog, type LlmDecisionLogDomain } from "@/features/classification/api"

interface Person { id: number; name: string; email: string }
interface Entry { id: number; action: string; label: string; category: string; sensitive: boolean; actor: Person | null; target: Person | null; ip_address: string; metadata: Record<string, unknown>; created_at: string }
interface AuditResponse { total: number; categories: { key: string; label: string }[]; entries: Entry[] }
type UnifiedEntry = { key: string; kind: "audit"; created_at: string; entry: Entry } | { key: string; kind: "llm"; created_at: string; entry: DisplayLogEntry }

const RANGES = [{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "all", label: "All time" }]
const FACT_LABELS: Record<string, string> = { tracking_number: "Report", tracking_id: "Report", announcement_title: "Announcement", title: "Record", document_type: "Document", emergency_type: "Emergency", category: "Category", status: "Status", unit: "Unit", role: "Role", channel: "Channel", reason: "Reason" }

function humanise(value: string) { const text = value.replace(/_/g, " ").trim(); return text.charAt(0).toUpperCase() + text.slice(1) }
function when(iso: string) {
  const date = new Date(iso); const today = new Date(); today.setHours(0, 0, 0, 0); const midnight = new Date(date); midnight.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - midnight.getTime()) / 86_400_000)
  return { day: diff === 0 ? "Today" : diff === 1 ? "Yesterday" : date.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }), time: date.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }) }
}
function primitive(value: unknown): string | null {
  if (value == null || value === "") return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "string" || typeof value === "number") return humanise(String(value))
  return null
}
function auditFacts(entry: Entry) {
  const facts: { label: string; value: string }[] = []
  if (entry.target && entry.target.id !== entry.actor?.id) facts.push({ label: "About", value: entry.target.name })
  for (const [key, label] of Object.entries(FACT_LABELS)) { const value = primitive(entry.metadata?.[key]); if (value) facts.push({ label, value }) }
  return facts.slice(0, 2)
}
function llmTitle(entry: DisplayLogEntry) { return entry.final_decision?.label || humanise(entry.recommended_action || "Automated check completed") }
function llmSubject(entry: DisplayLogEntry) { return entry.report_title || entry.tracking_id || (entry.domain === "verification" ? String(entry.input_snapshot.document_type || "ID document") : "Concern assessment") }
function rowIcon(title: string) {
  const value = title.toLowerCase()
  if (/reject|declin|fail|block/.test(value)) return { icon: CircleXIcon, tone: "text-sos bg-red-50" }
  if (/edit|update|change|publish|save|reset|restore/.test(value)) return { icon: PencilLineIcon, tone: "text-blue-700 bg-blue-50" }
  if (/accept|approv|pass|verified|created|completed/.test(value)) return { icon: CheckCircle2Icon, tone: "text-green-700 bg-green-50" }
  return { icon: Clock3Icon, tone: "text-neutral-500 bg-neutral-100" }
}

function JsonDetails({ value }: { value: unknown }) {
  if (value == null || value === "" || (Array.isArray(value) && !value.length)) return <span className="text-neutral-400">Not recorded</span>
  if (Array.isArray(value)) return <ul className="space-y-2">{value.map((item, index) => <li key={index} className="border-l-2 border-neutral-200 pl-3"><JsonDetails value={item} /></li>)}</ul>
  if (typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>).filter(([, item]) => item != null && item !== "" && (!Array.isArray(item) || item.length))
    return <dl className="space-y-3">{rows.map(([key, item]) => <div key={key}><dt className="text-meta text-neutral-400">{humanise(key)}</dt><dd className="mt-1 break-words text-meta leading-relaxed text-brand-navy"><JsonDetails value={item} /></dd></div>)}</dl>
  }
  return <>{primitive(value) ?? String(value)}</>
}

function AuditDetailsDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  if (!entry) return null
  return <SheetDialog open onClose={onClose} title="Audit details" description="The complete information recorded for this action." size="wide">
    <div className="space-y-7">
      <header className="border-b border-neutral-200 pb-6"><p className="text-[18px] font-semibold tracking-[-0.01em] text-brand-navy">{entry.label}</p><p className="mt-2 text-meta text-neutral-500">{new Date(entry.created_at).toLocaleString("en-PH")} · {entry.actor?.name || "System automation"}</p></header>
      <section><h3 className="mb-4 text-[15px] font-semibold text-brand-navy">People and access</h3><dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-meta text-neutral-400">Performed by</dt><dd className="mt-1 text-meta font-medium text-brand-navy">{entry.actor?.name || "System automation"}</dd></div>
        {entry.target ? <div><dt className="text-meta text-neutral-400">Affected account</dt><dd className="mt-1 text-meta font-medium text-brand-navy">{entry.target.name}<span className="block font-normal text-neutral-500">{entry.target.email}</span></dd></div> : null}
        {entry.ip_address ? <div><dt className="text-meta text-neutral-400">IP address</dt><dd className="mt-1 font-mono text-meta text-brand-navy">{entry.ip_address}</dd></div> : null}
        <div><dt className="text-meta text-neutral-400">Event reference</dt><dd className="mt-1 font-mono text-meta text-brand-navy">AUD-{entry.id}</dd></div>
      </dl></section>
      <section className="border-t border-neutral-200 pt-6"><h3 className="mb-4 text-[15px] font-semibold text-brand-navy">Recorded action information</h3>{Object.keys(entry.metadata || {}).length ? <JsonDetails value={entry.metadata} /> : <p className="text-meta text-neutral-500">No additional information was recorded for this older event.</p>}</section>
    </div>
  </SheetDialog>
}

export default function OfficialAuditLogPage() {
  usePageTitle("Audit logs")
  const [data, setData] = useState<AuditResponse | null>(null); const [llmEntries, setLlmEntries] = useState<DisplayLogEntry[]>([])
  const [category, setCategory] = useState("all"); const [range, setRange] = useState("30"); const [sensitiveOnly, setSensitiveOnly] = useState(false)
  const [search, setSearch] = useState(""); const [debounced, setDebounced] = useState(""); const [offset, setOffset] = useState(0)
  const [loadedKey, setLoadedKey] = useState(""); const [error, setError] = useState(""); const [auditDetail, setAuditDetail] = useState<Entry | null>(null)
  const [llmDetail, setLlmDetail] = useState<DisplayLogEntry | null>(null); const [testOpen, setTestOpen] = useState(false); const rangeScrollRef = useWheelScroll<HTMLDivElement>()

  useEffect(() => { const timer = window.setTimeout(() => { setDebounced(search.trim()); setOffset(0) }, 250); return () => window.clearTimeout(timer) }, [search])
  const requestKey = `${category}|${range}|${sensitiveOnly}|${debounced}`
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ category, days: range, limit: "200", offset: "0" }); if (sensitiveOnly) params.set("sensitive", "1"); if (debounced) params.set("search", debounced)
    const domain: LlmDecisionLogDomain | undefined = category === "concerns" ? "concern" : category === "idchecks" ? "verification" : undefined
    const includeLlm = !sensitiveOnly && (category === "all" || category === "concerns" || category === "idchecks")
    void Promise.all([
      apiRequest<AuditResponse>(`/config/audit-log/?${params}`),
      includeLlm ? getLlmDecisionLog({ domain, run_kind: "production", page: 1, page_size: 200, search: debounced || undefined, days: range === "all" ? undefined : Number(range) }).catch(() => ({ results: [], count: 0 })) : Promise.resolve({ results: [], count: 0 }),
    ]).then(([audit, decisions]) => { if (!cancelled) { setData(audit); setLlmEntries(decisions.results); setError(""); setLoadedKey(requestKey) } }).catch(() => { if (!cancelled) { setError("The audit logs could not be read right now."); setLoadedKey(requestKey) } })
    return () => { cancelled = true }
  }, [category, range, sensitiveOnly, debounced, requestKey])

  const allEntries = useMemo<UnifiedEntry[]>(() => [
    ...(data?.entries ?? []).map((entry) => ({ key: `audit-${entry.id}`, kind: "audit" as const, created_at: entry.created_at, entry })),
    ...llmEntries.map((entry) => ({ key: `llm-${entry.id}`, kind: "llm" as const, created_at: entry.created_at, entry })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [data, llmEntries])
  const visibleEntries = allEntries.slice(offset, offset + PAGE_SIZE); const loading = loadedKey !== requestKey; const categories = data?.categories ?? [{ key: "all", label: "Everything" }]

  return <div className="min-h-full bg-white"><div className="mx-auto w-full max-w-[1100px] px-6 pt-10 pb-6 sm:px-10 lg:pb-28">
    <ConfigBreadcrumb trail={[{ label: "Configuration", to: "/dashboard/configuration" }, { label: "Monitoring", to: "/dashboard/configuration" }, { label: "Audit logs" }]} />
    <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-page-title text-brand-navy">Audit logs</h1><p className="mt-3 max-w-2xl text-read leading-relaxed text-neutral-500">Review who changed configuration, what the automated concern and ID checks decided, and when each outcome occurred. This history is read-only.</p></div><ConfigHeroAction icon={TestTube2Icon} onClick={() => setTestOpen(true)}>Test automated checks</ConfigHeroAction></header>
    <FilterRow options={categories} value={category} onChange={(value) => { setCategory(value); setOffset(0) }} className="mt-10" />
    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4"><ListSearch value={search} onChange={setSearch} placeholder="Search people, records, or actions" label="Search audit logs" className="flex-1 sm:max-w-xs" /><div ref={rangeScrollRef} className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><button type="button" onClick={() => { setSensitiveOnly((value) => !value); setOffset(0) }} aria-pressed={sensitiveOnly} className={cn("inline-flex shrink-0 items-center gap-2 text-meta transition-colors", sensitiveOnly ? "font-medium text-accent" : "text-neutral-500 hover:text-brand-navy")}><ShieldAlertIcon className="size-4" strokeWidth={1.8} aria-hidden />Private data only</button>{RANGES.map((item) => <button key={item.key} type="button" onClick={() => { setRange(item.key); setOffset(0) }} className={cn("shrink-0 text-meta transition-colors", range === item.key ? "font-medium text-brand-navy" : "text-neutral-400 hover:text-brand-navy")}>{item.label}</button>)}</div></div>
    {error ? <p className="mt-12 text-read text-neutral-500">{error}</p> : loading ? <div className="mt-8 space-y-5">{[1,2,3].map((item) => <div key={item} className="h-20 animate-pulse border-b border-neutral-200 bg-neutral-50" />)}</div> : !visibleEntries.length ? <p className="mt-12 border-y border-neutral-200 py-12 text-center text-read text-neutral-500">Nothing was recorded for this filter. Try a longer time range.</p> : <ConfigurationTable label="Audit log" className="mt-6">{visibleEntries.map((row) => {
      const stamp = when(row.created_at); const isAudit = row.kind === "audit"; const title = isAudit ? row.entry.label : llmTitle(row.entry); const actor = isAudit ? row.entry.actor?.name || "System automation" : "System automation"; const statusIcon = rowIcon(title); const StatusIcon = statusIcon.icon
      const facts = isAudit ? auditFacts(row.entry) : [{ label: row.entry.domain === "verification" ? "Document" : "Record", value: llmSubject(row.entry) }, ...(row.entry.assigned_unit?.name ? [{ label: "Assigned unit", value: row.entry.assigned_unit.name }] : [])]
      return <ConfigurationTableRow key={row.key} actions={<SheetIconButton label="View details" onClick={() => isAudit ? setAuditDetail(row.entry) : setLlmDetail(row.entry)}><ChevronRightIcon className="size-5" aria-hidden /></SheetIconButton>}><div className="flex min-w-0 items-start gap-3"><span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", statusIcon.tone)}><StatusIcon className="size-4" strokeWidth={2} aria-hidden /></span><div className="min-w-0"><p className="text-row font-normal text-brand-navy">{title}{isAudit && row.entry.sensitive ? <span className="ml-2 text-meta font-medium text-accent">private data</span> : null}</p><p className="mt-1.5 text-meta text-neutral-500">{actor}</p><p className="mt-1 text-meta tabular-nums text-neutral-400">{stamp.day} · {stamp.time}</p>{facts.length ? <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">{facts.slice(0,2).map((fact) => <div key={`${fact.label}-${fact.value}`}><dt className="text-meta text-neutral-400">{fact.label}</dt><dd className="mt-0.5 max-w-sm truncate text-meta text-brand-navy">{fact.value}</dd></div>)}</dl> : null}</div></div></ConfigurationTableRow>
    })}</ConfigurationTable>}
    {!loading ? <ConfigurationPager pageSize={PAGE_SIZE} offset={offset} total={allEntries.length} onChange={setOffset} noun="entries" /> : null}
  </div><AuditDetailsDialog entry={auditDetail} onClose={() => setAuditDetail(null)} /><DecisionDetailsDialog entry={llmDetail} street={llmDetail?.street_imagery ?? null} onClose={() => setLlmDetail(null)} onRevert={() => undefined} reverting={false} reverted={false} /><AuditTestDialog open={testOpen} onClose={() => setTestOpen(false)} /></div>
}
