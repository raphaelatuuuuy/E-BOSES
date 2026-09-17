import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon, BellIcon, Building2Icon, CheckIcon, ChevronDownIcon, ChevronUpIcon,
  CircleXIcon, ClipboardListIcon, FolderOpenIcon, MapPinIcon, PencilLineIcon, PlusIcon,
  Share2Icon, ShieldAlertIcon, SirenIcon, TagsIcon, Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiRequest, unwrapList, type ListEnvelope } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import type { EmergencyCategory, EmergencyQuickQuestion } from "@/features/dashboard/emergency-api"
import { ListDropdown } from "@/components/ui/list-controls"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationInfoRow, ConfigurationTable } from "@/features/dashboard/components/config/configuration-table"
import { SheetActionRow, SheetDialog, SheetIconButton, SheetList, SheetOptionRow, SheetPrimaryButton, SheetSecondaryButton, SheetToggleRow } from "@/features/dashboard/components/sheet-dialog"
import { ConfigAlarm, ConfigHeroAction, ConfigShell } from "@/features/dashboard/components/config/config-shell"

interface Unit {
  id: number; name: string; short_name: string; is_active: boolean
  responds_to_emergencies?: boolean; emergency_types?: string[]
}
interface ConcernCategory {
  id: number; name: string; code: string; description: string; icon_key: string
  department: number | null; department_detail: Unit | null; photo_required: boolean
  description_required: boolean; location_required: boolean; public_feed_allowed: boolean
  is_active: boolean
}
interface RoleMap {
  id: number; emergency_type: string; department: number | null
  priority: number; requires_shift: boolean; is_active: boolean
}
interface CatalogRow {
  key: string; concern: ConcernCategory | null; emergency: EmergencyCategory | null
  name: string; description: string; code: string; iconKey: string; unit: Unit | null
  availableInReports: boolean; availableInSos: boolean; active: boolean
}
interface Draft {
  key?: string; concernId?: number; emergencyId?: number; code: string; name: string
  description: string; iconKey: string; unitId: number | null
  availableInReports: boolean; availableInSos: boolean; descriptionRequired: boolean
  photoRequired: boolean; locationRequired: boolean; publicFeedAllowed: boolean
  sosDescription: string; sosVisibleOnMap: boolean; questions: EmergencyQuickQuestion[]
  active: boolean
}

const inputClass = "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/10"
const labelClass = "text-[13px] font-semibold text-neutral-600"
const ICONS = [
  ["bell", "General", BellIcon], ["shield-alert", "Safety", ShieldAlertIcon],
  ["map-pin", "Location", MapPinIcon], ["siren", "Emergency", SirenIcon],
  ["zap", "Urgent", AlertTriangleIcon],
] as const

function normalize(value: string) { return value.trim().toLowerCase().replace(/[-\s]+/g, "_") }
function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) }
function questionsError(questions: EmergencyQuickQuestion[]) {
  for (const item of questions) {
    if (!item.question.trim()) return "Give every SOS question clear wording."
    const valid = item.choices.filter((choice) => choice.label.trim() && choice.value.trim())
    if (valid.length < 2) return "Give every SOS question at least two answers."
    if (new Set(valid.map((choice) => choice.value.trim().toLowerCase())).size !== valid.length) return "SOS answer values must be different."
  }
  return ""
}

function Requirement({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint: string }) {
  return <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-neutral-50"><span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-neutral-900">{label}</span><span className="block text-[12px] text-neutral-500">{hint}</span></span>{checked ? <CheckIcon className="size-5 text-accent" /> : null}</button>
}

function QuestionsEditor({ questions, onChange }: { questions: EmergencyQuickQuestion[]; onChange: (questions: EmergencyQuickQuestion[]) => void }) {
  const update = (index: number, value: EmergencyQuickQuestion) => onChange(questions.map((item, i) => i === index ? value : item))
  function move(index: number, amount: -1 | 1) {
    const target = index + amount
    if (target < 0 || target >= questions.length) return
    const next = [...questions]; [next[index], next[target]] = [next[target]!, next[index]!]; onChange(next)
  }
  return <div className="space-y-3">
    <div className="flex items-start justify-between gap-4"><div><p className={labelClass}>SOS follow-up questions</p><p className="mt-1 text-[13px] text-neutral-500">Ask only for details responders need before arrival.</p></div><button type="button" onClick={() => onChange([...questions, { key: `question_${questions.length + 1}`, question: "", choices: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }])} className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50">Add question</button></div>
    {questions.length === 0 ? <p className="rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-[13px] text-neutral-500">No follow-up questions. Residents can continue directly to the SOS details.</p> : null}
    {questions.map((question, index) => <section key={question.key} className="rounded-2xl bg-neutral-50 p-4">
      <div className="flex gap-2"><input aria-label={`Question ${index + 1}`} value={question.question} onChange={(event) => update(index, { ...question, question: event.target.value, key: slugify(event.target.value).replace(/-/g, "_") || `question_${index + 1}` })} className={inputClass.replace("mt-1.5 ", "min-w-0 flex-1 ")} placeholder="What should responders know?" /><button type="button" aria-label="Move question up" disabled={index === 0} onClick={() => move(index, -1)} className="rounded-lg p-2 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronUpIcon className="size-4" /></button><button type="button" aria-label="Move question down" disabled={index === questions.length - 1} onClick={() => move(index, 1)} className="rounded-lg p-2 text-neutral-500 hover:bg-white disabled:opacity-30"><ChevronDownIcon className="size-4" /></button><button type="button" aria-label="Remove question" onClick={() => onChange(questions.filter((_, i) => i !== index))} className="rounded-lg p-2 text-neutral-500 hover:bg-white hover:text-sos"><CircleXIcon className="size-4" /></button></div>
      <div className="mt-3 space-y-2 sm:pl-3">{question.choices.map((choice, choiceIndex) => <div key={`${choice.value}-${choiceIndex}`} className="flex items-center gap-2"><input aria-label={`Answer ${choiceIndex + 1}`} value={choice.label} onChange={(event) => { const label = event.target.value; update(index, { ...question, choices: question.choices.map((item, i) => i === choiceIndex ? { label, value: slugify(label).replace(/-/g, "_") } : item) }) }} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-brand-navy" placeholder="Answer shown to residents" /><button type="button" aria-label={`Remove answer ${choiceIndex + 1}`} onClick={() => update(index, { ...question, choices: question.choices.filter((_, i) => i !== choiceIndex) })} className="rounded-lg p-2 text-neutral-400 hover:bg-white hover:text-sos"><CircleXIcon className="size-4" /></button></div>)}<button type="button" onClick={() => update(index, { ...question, choices: [...question.choices, { value: `answer_${question.choices.length + 1}`, label: "" }] })} className="text-[12px] font-semibold text-neutral-600 hover:text-brand-navy">Add answer</button></div>
    </section>)}
  </div>
}

export default function OfficialCategoriesPage({ embedded = false }: { embedded?: boolean }) {
  const [concerns, setConcerns] = useState<ConcernCategory[]>([])
  const [emergencies, setEmergencies] = useState<EmergencyCategory[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [maps, setMaps] = useState<RoleMap[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("active")
  const [offset, setOffset] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dialogSection, setDialogSection] = useState<"overview" | "details" | "routing" | "settings">("overview")
  const [original, setOriginal] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setLoadError("")
    try {
      const [a, b, c, d] = await Promise.all([
        apiRequest<ConcernCategory[]>("/concerns/admin/categories/"), apiRequest<EmergencyCategory[]>("/emergencies/categories/"),
        apiRequest<Unit[]>("/concerns/admin/departments/"), apiRequest<RoleMap[] | ListEnvelope<RoleMap>>("/emergencies/role-maps/").then(unwrapList),
      ])
      setConcerns(a); setEmergencies(b); setUnits(c); setMaps(d)
    } catch (error) { setLoadError(describeApiError(error, "Categories could not be loaded.")) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const rows = useMemo<CatalogRow[]>(() => {
    const concernMap = new Map(concerns.map((item) => [normalize(item.code), item]))
    const emergencyMap = new Map(emergencies.map((item) => [normalize(item.code), item]))
    const unitMap = new Map(units.map((item) => [item.id, item]))
    return [...new Set([...concernMap.keys(), ...emergencyMap.keys()])].map((key) => {
      const concern = concernMap.get(key) ?? null; const emergency = emergencyMap.get(key) ?? null
      const route = maps.filter((item) => item.is_active && normalize(item.emergency_type) === key).sort((x, y) => y.priority - x.priority)[0]
      const unit = concern?.department_detail ?? (route?.department ? unitMap.get(route.department) ?? null : null)
      return { key, concern, emergency, name: concern?.name ?? emergency?.label ?? key, description: concern?.description ?? emergency?.subtext ?? "", code: concern?.code ?? emergency?.code ?? key, iconKey: concern?.icon_key ?? emergency?.icon_key ?? "tags", unit, availableInReports: Boolean(concern?.is_active), availableInSos: Boolean(emergency?.is_active), active: Boolean(concern?.is_active || emergency?.is_active) }
    }).sort((x, y) => x.name.localeCompare(y.name))
  }, [concerns, emergencies, maps, units])
  const statusOf = (row: CatalogRow) => !row.active ? "inactive" : !row.unit?.is_active || (row.availableInSos && Boolean(questionsError(row.emergency?.quick_questions ?? []))) ? "needs-setup" : "active"
  const filtered = useMemo(() => { const needle = query.trim().toLowerCase(); return rows.filter((row) => {
    if (needle && !`${row.name} ${row.description} ${row.unit?.name ?? ""} ${row.unit?.short_name ?? ""}`.toLowerCase().includes(needle)) return false
    return statusFilter === "all" || statusOf(row) === statusFilter
  }) }, [query, rows, statusFilter])
  const page = filtered.slice(offset, offset + CONFIGURATION_PAGE_SIZE)
  const needsSetup = rows.filter((row) => statusOf(row) === "needs-setup").length
  const statusCounts = useMemo(() => ({
    active: rows.filter((row) => statusOf(row) === "active").length,
    "needs-setup": rows.filter((row) => statusOf(row) === "needs-setup").length,
    inactive: rows.filter((row) => statusOf(row) === "inactive").length,
    all: rows.length,
  }), [rows])

  const emptyDraft = (): Draft => ({ code: "", name: "", description: "", iconKey: "tags", unitId: null, availableInReports: true, availableInSos: false, descriptionRequired: true, photoRequired: false, locationRequired: true, publicFeedAllowed: true, sosDescription: "", sosVisibleOnMap: true, questions: [], active: true })
  function openRow(row: CatalogRow) { const next: Draft = { key: row.key, concernId: row.concern?.id, emergencyId: row.emergency?.id, code: row.code, name: row.name, description: row.description, iconKey: row.iconKey, unitId: row.unit?.id ?? null, availableInReports: row.availableInReports, availableInSos: row.availableInSos, descriptionRequired: row.concern?.description_required ?? true, photoRequired: row.concern?.photo_required ?? false, locationRequired: row.concern?.location_required ?? true, publicFeedAllowed: row.concern?.public_feed_allowed ?? true, sosDescription: row.emergency?.subtext ?? "", sosVisibleOnMap: row.emergency?.visible_to_residents ?? true, questions: row.emergency?.quick_questions ?? [], active: row.active }; setDraft(next); setOriginal(JSON.stringify(next)) }
  const openNew = () => { setDraft(emptyDraft()); setOriginal(""); setDialogSection("overview") }
  const clearFilters = () => { setQuery(""); setStatusFilter("active") }

  useEffect(() => {
    if (!embedded) return
    window.addEventListener("configuration-primary-action", openNew)
    return () => window.removeEventListener("configuration-primary-action", openNew)
  }, [embedded, openNew])

  async function syncRoute(code: string, unitId: number, enabled: boolean) {
    const existing = maps.filter((item) => normalize(item.emergency_type) === normalize(code))
    const normalized = normalize(code)
    const unitUpdates = units.flatMap((unit) => {
      const current = unit.emergency_types ?? []
      const without = current.filter((item) => normalize(item) !== normalized)
      const next = enabled && unit.id === unitId ? [...without, normalized] : without
      if (JSON.stringify(next) === JSON.stringify(current)) return []
      return [apiRequest(`/concerns/admin/departments/${unit.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emergency_types: next, responds_to_emergencies: next.length > 0 }),
      })]
    })
    if (!enabled) { await Promise.all([...unitUpdates, ...existing.filter((item) => item.is_active).map((item) => apiRequest(`/emergencies/role-maps/${item.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) }))]); return }
    const matching = existing.find((item) => item.department === unitId)
    await Promise.all(existing.filter((item) => item.id !== matching?.id && item.is_active).map((item) => apiRequest(`/emergencies/role-maps/${item.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: false }) })))
    if (matching) { if (!matching.is_active) await apiRequest(`/emergencies/role-maps/${matching.id}/`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: true, priority: 100 }) }) }
    else await apiRequest("/emergencies/role-maps/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emergency_type: normalize(code), department: unitId, priority: 100, requires_shift: true, is_active: true }) })
    await Promise.all(unitUpdates)
  }

  async function save() {
    if (!draft) return
    if (!draft.name.trim() || !draft.description.trim()) return toast.error("Add a category name and a short resident-facing description.")
    if (draft.active && !draft.unitId) return toast.error("Assign an active unit before making this category available to residents.")
    const issue = draft.availableInSos ? questionsError(draft.questions) : ""; if (issue) return toast.error(issue)
    setSaving(true); const code = draft.code || slugify(draft.name)
    try {
      const concernData = new FormData(); Object.entries({ name: draft.name.trim(), code, description: draft.description.trim(), icon_key: draft.iconKey, department: draft.unitId ? String(draft.unitId) : "", description_required: String(draft.descriptionRequired), photo_required: String(draft.photoRequired), location_required: String(draft.locationRequired), public_feed_allowed: String(draft.publicFeedAllowed), is_active: String(draft.active && !draft.availableInSos) }).forEach(([key, value]) => concernData.append(key, value))
      await apiRequest(draft.concernId ? `/concerns/admin/categories/${draft.concernId}/` : "/concerns/admin/categories/", { method: draft.concernId ? "PATCH" : "POST", body: concernData })
      const emergencyData = new FormData(); Object.entries({ code: normalize(code), label: draft.name.trim(), subtext: (draft.sosDescription || draft.description).trim(), icon_key: draft.iconKey === "tags" ? "siren" : draft.iconKey, is_active: String(draft.active && draft.availableInSos), visible_to_residents: String(draft.sosVisibleOnMap), quick_questions: JSON.stringify(draft.questions), sort_order: String(emergencies.length * 10 + 10) }).forEach(([key, value]) => emergencyData.append(key, value))
      await apiRequest(draft.emergencyId ? `/emergencies/categories/${draft.emergencyId}/` : "/emergencies/categories/", { method: draft.emergencyId ? "PATCH" : "POST", body: emergencyData })
      if (draft.unitId) await syncRoute(code, draft.unitId, draft.active && draft.availableInSos)
      toast.success(draft.key ? "Category updated" : "Category created"); setDraft(null); setOriginal(""); await load()
    } catch (error) { toast.error(describeApiError(error, "The category could not be saved.")) }
    finally { setSaving(false) }
  }
  async function remove() { if (!deleteTarget) return; setDeleting(true); try { const ops: Promise<unknown>[] = []; if (deleteTarget.concern) ops.push(apiRequest(`/concerns/admin/categories/${deleteTarget.concern.id}/`, { method: "DELETE" })); if (deleteTarget.emergency) ops.push(apiRequest(`/emergencies/categories/${deleteTarget.emergency.id}/`, { method: "DELETE" })); await Promise.all(ops); toast.success("Category removed"); setDeleteTarget(null); await load() } catch (error) { toast.error(describeApiError(error, "The category could not be removed.")) } finally { setDeleting(false) } }

  return <ConfigShell embedded={embedded} hideEmbeddedAction={embedded} icon={FolderOpenIcon} eyebrow="Operations" title="Report categories" description="Manage what residents can report, where reports are sent, and which categories are available during an SOS." stats={[{ label: "Active categories", value: rows.filter((row) => row.active).length }, { label: "Available in SOS", value: rows.filter((row) => row.availableInSos).length }, { label: "Need setup", value: needsSetup, alarm: needsSetup > 0 }]} action={<ConfigHeroAction icon={PlusIcon} onClick={openNew}>Add category</ConfigHeroAction>}>
    {needsSetup ? <ConfigAlarm><strong>{needsSetup} {needsSetup === 1 ? "category needs" : "categories need"} setup.</strong> Assign an active unit before residents can use {needsSetup === 1 ? "it" : "them"}. <button type="button" onClick={() => setStatusFilter("needs-setup")} className="font-semibold underline underline-offset-4">Show categories</button></ConfigAlarm> : null}
    <ConfigurationListToolbar
      search={query}
      onSearch={(value) => { setQuery(value); setOffset(0) }}
      placeholder="Search categories"
      filters={[{ key: "active", label: "Active", count: statusCounts.active }, { key: "needs-setup", label: "Needs setup", count: statusCounts["needs-setup"] }, { key: "inactive", label: "Inactive", count: statusCounts.inactive }, { key: "all", label: "Any status", count: statusCounts.all }]}
      activeFilter={statusFilter}
      onFilter={(value) => { setStatusFilter(value); setOffset(0) }}
    />
    {loadError ? <div className="rounded-2xl border border-neutral-200 px-6 py-10 text-center"><AlertTriangleIcon className="mx-auto size-6 text-sos" /><h2 className="mt-4 text-row font-semibold text-brand-navy">Categories could not be loaded</h2><p className="mt-2 text-read text-neutral-500">{loadError}</p><button type="button" onClick={() => void load()} className="mt-5 rounded-full bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white">Try again</button></div> : loading ? <div className="divide-y divide-neutral-200" aria-label="Loading categories">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-6 py-5"><span className="h-4 w-32 animate-pulse rounded bg-neutral-100" /><span className="h-4 w-16 animate-pulse rounded bg-neutral-100" /></div>)}</div> : page.length === 0 ? <div className="py-16 text-center"><FolderOpenIcon className="mx-auto size-7 text-neutral-300" /><h2 className="mt-4 text-row font-semibold text-brand-navy">{rows.length ? "No categories match this view" : "No report categories yet"}</h2><p className="mt-2 text-read text-neutral-500">{rows.length ? "Try another search or status." : "Add the first category residents can use when submitting a report."}</p><button type="button" onClick={rows.length ? clearFilters : openNew} className="mt-5 font-semibold text-brand-navy underline underline-offset-4">{rows.length ? "Show active categories" : "Add category"}</button></div> : <ConfigurationTable label="Report categories" hideHeader>{page.map((row) => { const Icon = resolveIconByKey(row.iconKey) ?? TagsIcon; const status = statusOf(row); return <ConfigurationInfoRow key={row.key} icon={Icon} title={row.name} subtext={row.unit?.name ?? <span className="text-sos">No unit assigned</span>} description={row.description || "No description"} actions={<><SheetIconButton label={`Edit ${row.name}`} onClick={() => openRow(row)}><PencilLineIcon className="size-5" strokeWidth={1.8} aria-hidden /></SheetIconButton><SheetIconButton label={`Remove ${row.name}`} onClick={() => setDeleteTarget(row)} className="text-neutral-500 hover:text-sos"><Trash2Icon className="size-5" strokeWidth={1.8} aria-hidden /></SheetIconButton></>} />})}</ConfigurationTable>}
    {!loading && !loadError && filtered.length ? <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="categories" /> : null}
    {draft ? <SheetDialog
      open
      onClose={() => { if (!saving) { setDraft(null); setOriginal(""); setDialogSection("overview") } }}
      title={draft.key ? `Edit ${draft.name}` : "Add category"}
      description={dialogSection === "overview" ? "Set the category details and choose where it goes." : undefined}
      size="wide"
      actions={<><SheetIconButton label={draft.availableInSos ? "Remove from SOS" : "Add to SOS"} onClick={() => setDraft({ ...draft, availableInSos: !draft.availableInSos, availableInReports: draft.availableInSos })} className={draft.availableInSos ? "bg-sos/10 text-sos" : undefined}><SirenIcon className="size-5" strokeWidth={2} /></SheetIconButton><SheetIconButton label={draft.publicFeedAllowed ? "Turn off public sharing" : "Turn on public sharing"} onClick={() => setDraft({ ...draft, publicFeedAllowed: !draft.publicFeedAllowed })} className={draft.publicFeedAllowed ? "bg-brand-orange/10 text-brand-orange" : undefined}><Share2Icon className="size-5" strokeWidth={2} /></SheetIconButton></>}
      footer={dialogSection === "overview" ? <SheetActionRow><SheetSecondaryButton disabled={saving} onClick={() => { setDraft(null); setOriginal("") }}>Cancel</SheetSecondaryButton><SheetPrimaryButton tone="accent" disabled={saving || !draft.name.trim() || !draft.description.trim() || Boolean(draft.key && original === JSON.stringify(draft))} onClick={() => void save()}>{saving ? "Saving…" : draft.key ? "Save changes" : "Create category"}</SheetPrimaryButton></SheetActionRow> : <SheetSecondaryButton onClick={() => setDialogSection("overview")}>Back</SheetSecondaryButton>}
    >
      {dialogSection === "overview" ? <div className="space-y-5 pt-2">
        <SheetList>
          <SheetOptionRow title="Category details" description={draft.name || "Name, description and icon"} leading={<PencilLineIcon className="size-5" />} showChevron onClick={() => setDialogSection("details")} />
          <SheetOptionRow title="Assigned unit" description={units.find((unit) => unit.id === draft.unitId)?.name || "Choose where this category goes"} leading={<Building2Icon className="size-5" />} showChevron onClick={() => setDialogSection("routing")} />
          <SheetOptionRow title={draft.availableInSos ? "SOS settings" : "Report settings"} description={draft.availableInSos ? `${draft.questions.length} follow-up ${draft.questions.length === 1 ? "question" : "questions"}` : "Description, photo and location"} leading={draft.availableInSos ? <SirenIcon className="size-5" /> : <ClipboardListIcon className="size-5" />} showChevron onClick={() => setDialogSection("settings")} />
        </SheetList>
        {draft.key ? <SheetList><SheetToggleRow id="category-active" checked={draft.active} onChange={(checked) => setDraft({ ...draft, active: checked })} label="Active" description="Show this category to residents." /></SheetList> : null}
      </div> : null}
      {dialogSection === "details" ? <section className="space-y-5 pt-2"><label className="block"><span className={labelClass}>Category name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value, code: draft.concernId || draft.emergencyId ? draft.code : slugify(e.target.value) })} className={inputClass} placeholder="Illegal dumping" /></label><label className="block"><span className={labelClass}>Description</span><textarea value={draft.description} maxLength={255} rows={3} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className={inputClass} placeholder="Garbage left outside approved collection points" /></label><div><p className={labelClass}>Icon</p><div className="mt-2 grid grid-cols-5 gap-2">{ICONS.map(([key, label, Icon]) => <button key={key} type="button" aria-label={label} aria-pressed={draft.iconKey === key} onClick={() => setDraft({ ...draft, iconKey: key })} className={`flex h-12 items-center justify-center rounded-xl border ${draft.iconKey === key ? "border-brand-navy bg-brand-navy text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"}`}><Icon className="size-5" /></button>)}</div></div></section> : null}
      {dialogSection === "routing" ? <section className="pt-2"><ListDropdown label="Assigned unit" value={draft.unitId ? String(draft.unitId) : ""} onChange={(value) => setDraft({ ...draft, unitId: value ? Number(value) : null })} options={[{ value: "", label: "Choose a unit" }, ...units.filter((unit) => unit.is_active).map((unit) => ({ value: String(unit.id), label: unit.name, description: unit.short_name }))]} /></section> : null}
      {dialogSection === "settings" ? <section className="space-y-5 pt-2">{!draft.availableInSos ? <div className="grid gap-1 sm:grid-cols-3"><Requirement checked={draft.descriptionRequired} onChange={(checked) => setDraft({ ...draft, descriptionRequired: checked })} label="Description" hint="Ask what happened." /><Requirement checked={draft.photoRequired} onChange={(checked) => setDraft({ ...draft, photoRequired: checked })} label="Photo" hint="Ask for an image." /><Requirement checked={draft.locationRequired} onChange={(checked) => setDraft({ ...draft, locationRequired: checked })} label="Location" hint="Ask for the place." /></div> : <div className="space-y-5"><label className="block"><span className={labelClass}>SOS description</span><input value={draft.sosDescription} onChange={(e) => setDraft({ ...draft, sosDescription: e.target.value })} className={inputClass} placeholder={draft.description} /></label><QuestionsEditor questions={draft.questions} onChange={(questions) => setDraft({ ...draft, questions })} /><SheetList><SheetToggleRow id="category-sos-map" checked={draft.sosVisibleOnMap} onChange={(checked) => setDraft({ ...draft, sosVisibleOnMap: checked })} label="Show on alerts map" /></SheetList></div>}</section> : null}
    </SheetDialog> : null}
    <SheetDialog open={Boolean(deleteTarget)} onClose={() => { if (!deleting) setDeleteTarget(null) }} title={deleteTarget ? `Remove ${deleteTarget.name}?` : ""} description="Residents will no longer be able to use this category. Existing reports and SOS incidents will keep their history." footer={<SheetActionRow><SheetSecondaryButton disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</SheetSecondaryButton><SheetPrimaryButton tone="danger" disabled={deleting} onClick={() => void remove()}>{deleting ? "Removing…" : "Remove category"}</SheetPrimaryButton></SheetActionRow>} />
  </ConfigShell>
}
