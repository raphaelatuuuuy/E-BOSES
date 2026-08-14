import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  ActivityIcon,
  AmbulanceIcon,
  BabyIcon,
  BadgeAlertIcon,
  BellIcon,
  CloudRainWindIcon,
  FlameIcon,
  HeartCrackIcon,
  HomeIcon,
  MapPinIcon,
  PillIcon,
  PlusIcon,
  ShieldAlertIcon,
  SirenIcon,
  StethoscopeIcon,
  WavesIcon,
  ZapIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { DataTable, type Column } from "@/features/dashboard/components/record/data-table"
import { ConfigAlarm, ConfigHeroAction, ConfigShell } from "@/features/dashboard/components/config/config-shell"
import type { EmergencyCategory } from "@/features/dashboard/emergency-api"
import { StateMarker } from "@/components/ui/state-marker"

const ICONS = [
  ["siren", "Siren", SirenIcon],
  ["activity", "Activity", ActivityIcon],
  ["ambulance", "Ambulance", AmbulanceIcon],
  ["baby", "Baby", BabyIcon],
  ["badge-alert", "Badge alert", BadgeAlertIcon],
  ["bell", "Bell", BellIcon],
  ["cloud-rain-wind", "Rain / wind", CloudRainWindIcon],
  ["flame", "Flame", FlameIcon],
  ["heart-crack", "Heart crack", HeartCrackIcon],
  ["home", "Home", HomeIcon],
  ["map-pin", "Map pin", MapPinIcon],
  ["pill", "Pill", PillIcon],
  ["shield-alert", "Shield alert", ShieldAlertIcon],
  ["stethoscope", "Stethoscope", StethoscopeIcon],
  ["waves", "Waves", WavesIcon],
  ["zap", "Zap", ZapIcon],
] as const

interface Unit {
  id: number
  name: string
  short_name: string
  is_active: boolean
  responds_to_emergencies: boolean
  emergency_types: string[]
}

interface RoleMap {
  id: number
  emergency_type: string
  department: number | null
  department_name?: string
  priority: number
  requires_shift: boolean
  is_active: boolean
}

type Draft = Partial<EmergencyCategory> & { iconFile?: File | null }

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
}

function iconFor(key: string) {
  return ICONS.find(([value]) => value === key)?.[2] ?? SirenIcon
}

export default function OfficialDispatchRulesPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [categories, setCategories] = useState<EmergencyCategory[]>([])
  const [maps, setMaps] = useState<RoleMap[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiRequest<Unit[]>("/concerns/admin/departments/"),
      apiRequest<EmergencyCategory[]>("/emergencies/categories/"),
      apiRequest<RoleMap[]>("/emergencies/role-maps/"),
    ])
      .then(([nextUnits, nextCategories, nextMaps]) => {
        setUnits(nextUnits)
        setCategories(nextCategories)
        setMaps(nextMaps)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load dispatch rules.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Defer the initial fetch one macrotask so the mount render settles first;
    // load() sets loading synchronously (reused by refresh handlers).
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  const respondingUnits = useMemo(
    () => units.filter((unit) => unit.is_active && unit.responds_to_emergencies),
    [units],
  )

  function explicitRules(code: string) {
    return maps.filter((item) => item.emergency_type === code && item.is_active && item.department)
  }

  function declaringUnits(code: string) {
    return units.filter((unit) => unit.is_active && unit.responds_to_emergencies && (unit.emergency_types || []).includes(code))
  }

  const uncovered = categories.filter(
    (category) => category.is_active && explicitRules(category.code).length === 0 && declaringUnits(category.code).length === 0,
  )

  async function syncRules(category: EmergencyCategory, selectedIds: number[]) {
    setBusy(category.code)
    try {
      const current = explicitRules(category.code)
      const currentIds = new Set(current.map((item) => item.department).filter(Boolean) as number[])
      const selected = new Set(selectedIds)
      await Promise.all(current.filter((rule) => rule.department && !selected.has(rule.department)).map((rule) => apiRequest(`/emergencies/role-maps/${rule.id}/`, { method: "DELETE" })))
      await Promise.all(
        selectedIds
          .filter((department) => !currentIds.has(department))
          .map((department) =>
            apiRequest("/emergencies/role-maps/", {
              method: "POST",
              body: JSON.stringify({ emergency_type: category.code, department, priority: 100 }),
            }),
          ),
      )
      toast.success("Dispatch routing updated")
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not update dispatch routing."))
    } finally {
      setBusy(null)
    }
  }

  async function saveCategory() {
    if (!draft?.label?.trim()) return
    setBusy("category")
    const payload = new FormData()
    payload.append("code", draft.code || slugify(draft.label))
    payload.append("label", draft.label.trim())
    payload.append("subtext", (draft.subtext || "").trim())
    payload.append("icon_key", draft.icon_key || "siren")
    payload.append("custom_icon_label", (draft.custom_icon_label || "").trim())
    payload.append("sort_order", String(draft.sort_order ?? categories.length * 10 + 10))
    payload.append("is_active", String(draft.is_active ?? true))
    if (draft.iconFile) payload.append("icon_image", draft.iconFile)
    try {
      await apiRequest(draft.id ? `/emergencies/categories/${draft.id}/` : "/emergencies/categories/", {
        method: draft.id ? "PATCH" : "POST",
        body: payload,
      })
      toast.success(draft.id ? "Emergency category updated" : "Emergency category added")
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save emergency category."))
    } finally {
      setBusy(null)
    }
  }

  async function removeCategory(category: EmergencyCategory) {
    if (!window.confirm(`Remove “${category.label}”? Alerts already filed under it keep their history.`)) return
    setBusy(category.code)
    try {
      await apiRequest(`/emergencies/categories/${category.id}/`, { method: "DELETE" })
      toast.success("Emergency category removed")
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove emergency category."))
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<EmergencyCategory>[] = [
    {
      key: "category",
      header: "Category",
      sortValue: (category) => category.label.toLowerCase(),
      render: (category) => {
        const Icon = iconFor(category.icon_key)
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-orange-soft text-brand-navy ring-1 ring-brand-orange/15">
              {category.icon_image_url ? <img src={category.icon_image_url} alt="" className="size-full rounded-xl object-cover" /> : category.custom_icon_label ? <span className="text-xs font-semibold">{category.custom_icon_label}</span> : <Icon className="size-4" />}
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{category.label}</p>
              <p className="truncate text-xs font-medium text-muted-foreground">{category.subtext || category.code}</p>
            </div>
          </div>
        )
      },
    },
    {
      key: "assigned_units",
      header: "Assigned Units",
      render: (category) => {
        const selected = new Set(explicitRules(category.code).map((item) => item.department).filter(Boolean) as number[])
        const declared = declaringUnits(category.code)
        return (
          <div className="space-y-2">
            <div className="flex max-w-xl flex-wrap gap-1.5">
              {respondingUnits.map((unit) => (
                <label key={unit.id} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold transition ${selected.has(unit.id) ? "border-brand-orange bg-brand-orange-soft text-brand-navy" : "border-card-line bg-canvas text-muted-foreground hover:border-brand-orange/40"}`}>
                  <input
                    type="checkbox"
                    checked={selected.has(unit.id)}
                    disabled={busy === category.code}
                    onChange={(event) => {
                      const next = new Set(selected)
                      if (event.target.checked) next.add(unit.id)
                      else next.delete(unit.id)
                      void syncRules(category, [...next])
                    }}
                  />
                  {unit.short_name || unit.name}
                </label>
              ))}
            </div>
            <p className="text-[11px] font-medium text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} explicit unit${selected.size === 1 ? "" : "s"} assigned.`
                : declared.length
                  ? `Assigned unit from Units page: ${declared.map((unit) => unit.short_name || unit.name).join(", ")}.`
                  : "No unit answers this category yet."}
            </p>
          </div>
        )
      },
    },
    {
      key: "status",
      header: "Status",
      render: (category) => {
        const covered = explicitRules(category.code).length > 0 || declaringUnits(category.code).length > 0
        return (
          <StateMarker
            tone={!category.is_active ? "closed" : covered ? "active" : "open"}
            label={!category.is_active ? "Inactive" : covered ? "Covered" : "No unit"}
          />
        )
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (category) => (
        <span className="flex justify-end gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => setDraft(category)}>Edit</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void removeCategory(category)} className="text-destructive">Remove</Button>
        </span>
      ),
    },
  ]

  return (
    <ConfigShell
      icon={SirenIcon}
      eyebrow="Emergency response"
      title="Emergency categories & dispatch rules"
      description="Configure the SOS choices residents see and route each category to one or more responding units."
      action={<ConfigHeroAction icon={PlusIcon} onClick={() => setDraft({ icon_key: "siren", is_active: true })}>Add category</ConfigHeroAction>}
      stats={[
        { label: "Categories", value: categories.filter((item) => item.is_active).length },
        { label: "Unanswered", value: uncovered.length, alarm: uncovered.length > 0 },
        { label: "Responding units", value: respondingUnits.length },
      ]}
    >
      {!loading && uncovered.length > 0 ? (
        <ConfigAlarm>
          No unit answers: {uncovered.map((item) => item.label).join(", ")}. These SOS categories will escalate instead of auto-routing.
        </ConfigAlarm>
      ) : null}

      {draft ? (
        <section className="overflow-hidden rounded-3xl border border-brand-orange/20 bg-gradient-to-br from-white via-brand-orange-soft to-tint p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Label" value={draft.label || ""} onChange={(label) => setDraft((current) => ({ ...current, label, code: current?.id ? current.code : slugify(label) }))} />
            <Field label="Code" value={draft.code || ""} onChange={(code) => setDraft((current) => ({ ...current, code: slugify(code) }))} disabled={Boolean(draft.id)} />
            <Field label="Subtext" value={draft.subtext || ""} onChange={(subtext) => setDraft((current) => ({ ...current, subtext }))} />
            <Field label="Custom icon text" value={draft.custom_icon_label || ""} onChange={(custom_icon_label) => setDraft((current) => ({ ...current, custom_icon_label }))} />
          </div>
          <div className="mt-3">
            <p className="text-xs font-bold text-muted-foreground">Icon</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ICONS.map(([key, label, Icon]) => (
                <button key={key} type="button" onClick={() => setDraft((current) => ({ ...current, icon_key: key }))} className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold ${draft.icon_key === key ? "border-brand-orange bg-brand-orange-soft text-brand-navy" : "border-card-line bg-canvas text-muted-foreground"}`}>
                  <Icon className="size-4" />{label}
                </button>
              ))}
            </div>
          </div>
          <label className="mt-4 block rounded-2xl border border-dashed border-brand-orange/40 bg-white/70 p-4">
            <span className="text-xs font-bold text-muted-foreground">Custom image / .ico</span>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {draft.iconFile ? (
                <img src={URL.createObjectURL(draft.iconFile)} alt="" className="size-12 rounded-xl object-cover" />
              ) : draft.icon_image_url ? (
                <img src={draft.icon_image_url} alt="" className="size-12 rounded-xl object-cover" />
              ) : null}
              <input type="file" accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon" onChange={(event) => setDraft((current) => ({ ...current, iconFile: event.target.files?.[0] ?? null }))} className="text-sm font-semibold text-foreground" />
            </div>
            <span className="mt-2 block text-xs font-medium text-muted-foreground">Optional. PNG, JPG, WEBP, or ICO up to 512 KB. Image overrides the icon picker in resident SOS.</span>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button type="button" disabled={busy === "category" || !draft.label?.trim()} onClick={() => void saveCategory()} className="bg-brand-navy text-white hover:bg-brand-navy">Save category</Button>
          </div>
        </section>
      ) : null}

      <DataTable
        rows={categories}
        columns={columns}
        rowKey={(category) => String(category.id)}
        loading={loading}
        searchPlaceholder="Search emergency categories"
        searchMatches={(category, query) => `${category.label} ${category.code} ${category.subtext}`.toLowerCase().includes(query)}
        emptyTitle="No emergency categories"
        emptyHint="Add the SOS choices residents can use."
      />

      {respondingUnits.length === 0 && !loading ? (
        <p className="rounded-2xl border border-card-line bg-card p-6 text-center text-sm font-semibold text-muted-foreground">
          No unit is marked as an emergency responder yet. Set that up in <Link to="/dashboard/configuration/units" className="text-brand-navy underline">Configuration → Units</Link> first.
        </p>
      ) : null}
    </ConfigShell>
  )
}

function Field({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-xl border border-card-line bg-canvas px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-brand-orange disabled:opacity-60" />
    </label>
  )
}