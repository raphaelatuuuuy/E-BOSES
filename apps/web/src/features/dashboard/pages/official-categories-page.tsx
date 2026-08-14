import { useCallback, useEffect, useState } from "react"
import {
  ArrowRightIcon,
  DropletsIcon,
  HomeIcon,
  LeafIcon,
  LightbulbIcon,
  MapPinIcon,
  MegaphoneIcon,
  PawPrintIcon,
  PlusIcon,
  ShieldAlertIcon,
  TagsIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Checkbox } from "@workspace/ui/components/checkbox"

import { apiRequest } from "@/lib/api"
import { DataTable, type Column } from "@/features/dashboard/components/record/data-table"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"

/**
 * Concern categories and the unit each one routes to.
 *
 * Categories and routing are one screen rather than two, because they are one
 * decision: a category with no responsible unit is a category whose concerns
 * land with nobody. Splitting them across tabs is what allowed the gap to exist
 * unnoticed — the Configuration hub flags it, and this is where it gets closed.
 */

interface Unit {
  id: number
  name: string
  short_name: string
  is_active: boolean
}

interface Category {
  id: number
  name: string
  code: string
  description: string
  icon_key: string
  custom_icon_label: string
  icon_image: string
  icon_image_url: string
  department: number | null
  department_detail: Unit | null
  photo_required: boolean
  description_required: boolean
  location_required: boolean
  is_active: boolean
}

interface RoutingRule {
  id: number
  name: string
  category: number
  department: number
  priority: number
  is_active: boolean
  department_detail: Unit | null
}

type Draft = Partial<Category> & { iconFile?: File | null }

const ICONS = [
  ["tag", "Tag", TagsIcon],
  ["wrench", "Wrench", WrenchIcon],
  ["leaf", "Leaf", LeafIcon],
  ["shield-alert", "Safety", ShieldAlertIcon],
  ["trash", "Trash", Trash2Icon],
  ["lightbulb", "Light", LightbulbIcon],
  ["road", "Road", ArrowRightIcon],
  ["droplets", "Water", DropletsIcon],
  ["home", "Home", HomeIcon],
  ["map-pin", "Map pin", MapPinIcon],
  ["paw-print", "Animal", PawPrintIcon],
  ["megaphone", "Notice", MegaphoneIcon],
] as const

function iconFor(key: string | undefined) {
  return ICONS.find(([value]) => value === key)?.[2] ?? TagsIcon
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function RequirementToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-card-line bg-card px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        <span className="block text-xs font-medium text-muted-foreground">{hint}</span>
      </span>
      <Checkbox checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} aria-label={label} />
    </label>
  )
}

export default function OfficialCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    Promise.all([
      apiRequest<Category[]>("/concerns/admin/categories/"),
      apiRequest<RoutingRule[]>("/concerns/admin/routing-rules/"),
      apiRequest<Unit[]>("/concerns/admin/departments/"),
    ])
      .then(([nextCategories, nextRules, nextUnits]) => {
        setCategories(nextCategories)
        setRules(nextRules)
        setUnits(nextUnits)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load categories.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** The unit that actually answers a category: an explicit rule wins, then the
   *  category's own department. Mirrors how the backend resolves it. */
  function routedUnit(category: Category): Unit | null {
    const rule = rules
      .filter((item) => item.category === category.id && item.is_active)
      .sort((a, b) => b.priority - a.priority)[0]
    return rule?.department_detail ?? category.department_detail ?? null
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const isNew = !draft.id
      const payload = new FormData()
      payload.append("name", (draft.name || "").trim())
      payload.append("code", draft.code || slugify(draft.name || ""))
      payload.append("description", draft.description || "")
      payload.append("icon_key", draft.icon_key || "tag")
      payload.append("custom_icon_label", (draft.custom_icon_label || "").trim())
      payload.append("photo_required", String(draft.photo_required ?? true))
      payload.append("description_required", String(draft.description_required ?? true))
      payload.append("location_required", String(draft.location_required ?? true))
      payload.append("is_active", String(draft.is_active ?? true))
      if (draft.department) payload.append("department", String(draft.department))
      if (draft.iconFile) payload.append("icon_image", draft.iconFile)
      await apiRequest(
        isNew ? "/concerns/admin/categories/" : `/concerns/admin/categories/${draft.id}/`,
        {
          method: isNew ? "POST" : "PATCH",
          body: payload,
        },
      )
      toast.success(isNew ? "Category created" : "Category updated")
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the category."))
    } finally {
      setSaving(false)
    }
  }

  async function removeCategory(category: Category) {
    const confirmed = window.confirm(
      `Delete “${category.name}”? Concerns already filed under it keep their history; ` +
        "if any exist, it is deactivated instead of deleted.",
    )
    if (!confirmed) return
    try {
      const result = await apiRequest<{ deleted: boolean; in_use: number }>(
        `/concerns/admin/categories/${category.id}/`,
        { method: "DELETE" },
      )
      toast.success(
        result.deleted
          ? "Category deleted"
          : `Category deactivated — ${result.in_use} concern${result.in_use === 1 ? "" : "s"} still use it`,
      )
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove the category."))
    }
  }

  async function route(category: Category, departmentId: string) {
    try {
      await apiRequest(`/concerns/admin/categories/${category.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ department: departmentId ? Number(departmentId) : null }),
      })
      toast.success(departmentId ? "Routing updated" : "Routing cleared")
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not update routing."))
    }
  }

  const unrouted = categories.filter((category) => category.is_active && !routedUnit(category))

  const columns: Column<Category>[] = [
    {
      key: "name",
      header: "Category",
      sortValue: (category) => category.name.toLowerCase(),
      render: (category) => (
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-brand-navy ring-1 ring-accent/15">
            {category.icon_image_url ? (
              <img src={category.icon_image_url} alt="" className="size-full rounded-xl object-cover" />
            ) : category.custom_icon_label ? (
              <span className="text-xs font-semibold">{category.custom_icon_label}</span>
            ) : (() => {
              const Icon = iconFor(category.icon_key)
              return <Icon className="size-4" />
            })()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{category.name}</p>
            <p className="truncate text-xs font-medium text-muted-foreground">
              {category.description || category.code}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "routing",
      header: "Assigned Unit",
      render: (category) => {
        const current = routedUnit(category)
        return (
          <div className="flex items-center gap-2">
            <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Unit for {category.name}</span>
              <select
                value={category.department ? String(category.department) : ""}
                onChange={(event) => void route(category, event.target.value)}
                className={`w-full rounded-lg border bg-card px-2 py-1.5 text-xs font-semibold outline-none focus:border-accent ${
                  current
                    ? "border-card-line text-foreground"
                    : "border-status-open text-status-open-ink"
                }`}
              >
                <option value="">Nobody assigned</option>
                {units
                  .filter((unit) => unit.is_active)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (category) => (
        <span className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setDraft(category)}
            className="rounded-lg px-2 py-1 text-xs font-bold text-brand-navy transition hover:bg-tint"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void removeCategory(category)}
            className="rounded-lg px-2 py-1 text-xs font-bold text-severity-critical-ink transition hover:bg-severity-critical-surface"
          >
            Delete
          </button>
        </span>
      ),
    },
  ]

  const active = categories.filter((category) => category.is_active)

  return (
    <ConfigShell
      icon={TagsIcon}
      eyebrow="Intake & routing"
      title="Concern categories"
      description="What residents can report, and which barangay unit answers each one. Routing lives here rather than on its own screen — a category and the unit behind it are one decision."
      stats={[
        { label: "Categories", value: active.length },
        {
          label: "No unit assigned",
          value: unrouted.length,
          alarm: unrouted.length > 0,
        },
        { label: "Units available", value: units.filter((unit) => unit.is_active).length },
      ]}
      action={
        !draft ? (
          <ConfigHeroAction icon={PlusIcon} onClick={() => setDraft({ name: "", code: "", icon_key: "tag" })}>
            New category
          </ConfigHeroAction>
        ) : null
      }
    >
      {!loading && unrouted.length > 0 ? (
        <ConfigAlarm>
          {unrouted.length} categor{unrouted.length === 1 ? "y has" : "ies have"} no unit assigned:{" "}
          {unrouted.map((category) => category.name).join(", ")}. Concerns filed under
          {unrouted.length === 1 ? " it" : " them"} will not reach anyone.
        </ConfigAlarm>
      ) : null}

      {draft ? (
        <div className="space-y-3 rounded-2xl border border-card-line bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">
                Category name
              </span>
              <input
                value={draft.name ?? ""}
                onChange={(event) => {
                  const name = event.target.value
                  setDraft(
                    draft.id ? { ...draft, name } : { ...draft, name, code: slugify(name) },
                  )
                }}
                placeholder="Illegal dumping"
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">
                Assigned Unit
              </span>
              <select
                value={draft.department ? String(draft.department) : ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    department: event.target.value ? Number(event.target.value) : null,
                  })
                }
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent"
              >
                <option value="">Choose a unit</option>
                {units
                  .filter((unit) => unit.is_active)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] font-bold text-muted-foreground">
              What belongs here
            </span>
            <input
              value={draft.description ?? ""}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="Garbage dumped outside collection points"
              className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent"
            />
          </label>

          <div className="space-y-2 rounded-2xl border border-card-line bg-canvas p-3">
            <p className="text-[11px] font-bold text-muted-foreground">Report requirements</p>
            <RequirementToggle
              label="Description required"
              hint="Residents must describe the issue before filing"
              checked={draft.description_required ?? true}
              onChange={(value) => setDraft({ ...draft, description_required: value })}
            />
            <RequirementToggle
              label="Photo required"
              hint="Residents must attach at least one photo"
              checked={draft.photo_required ?? true}
              onChange={(value) => setDraft({ ...draft, photo_required: value })}
            />
            <RequirementToggle
              label="Location required"
              hint="Residents must pin where the issue is"
              checked={draft.location_required ?? true}
              onChange={(value) => setDraft({ ...draft, location_required: value })}
            />
          </div>

          <div className="space-y-3 rounded-2xl border border-card-line bg-canvas p-3">
            <p className="text-[11px] font-bold text-muted-foreground">Icon</p>
            <div className="flex flex-wrap gap-2">
              {ICONS.map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon_key: key })}
                  className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-bold ${draft.icon_key === key ? "border-accent bg-accent/10 text-brand-navy" : "border-card-line bg-card text-muted-foreground"}`}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">Custom icon text</span>
              <input
                value={draft.custom_icon_label ?? ""}
                onChange={(event) => setDraft({ ...draft, custom_icon_label: event.target.value })}
                placeholder="BD"
                maxLength={8}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent"
              />
            </label>
            <label className="block rounded-2xl border border-dashed border-accent/40 bg-card p-3">
              <span className="text-[11px] font-bold text-muted-foreground">Custom image / .ico</span>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {draft.iconFile ? (
                  <img src={URL.createObjectURL(draft.iconFile)} alt="" className="size-12 rounded-xl object-cover" />
                ) : draft.icon_image_url ? (
                  <img src={draft.icon_image_url} alt="" className="size-12 rounded-xl object-cover" />
                ) : null}
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon"
                  onChange={(event) => setDraft({ ...draft, iconFile: event.target.files?.[0] ?? null })}
                  className="text-sm font-semibold text-foreground"
                />
              </div>
              <span className="mt-2 block text-xs font-medium text-muted-foreground">Optional. PNG, JPG, WEBP, or ICO up to 512 KB.</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !draft.name}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {saving ? "Saving…" : draft.id ? "Save changes" : "Create category"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={saving}
              className="rounded-xl border border-card-line bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-tint"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <DataTable
        rows={categories.filter((category) => category.is_active)}
        columns={columns}
        rowKey={(category) => String(category.id)}
        loading={loading}
        searchPlaceholder="Search categories"
        searchMatches={(category, query) =>
          `${category.name} ${category.code} ${category.description}`.toLowerCase().includes(query)
        }
        emptyTitle="No categories yet"
        emptyHint="Use “New category” above to add what residents can report."
      />
    </ConfigShell>
  )
}
