import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRightIcon,
  CircleCheck,
  ChevronDownIcon,
  ChevronUpIcon,
  DropletsIcon,
  FolderOpenIcon,
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
  CircleX,
} from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"

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
  public_feed_allowed: boolean
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

const inputCls = "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
const labelCls = "text-[13px] font-semibold text-neutral-500"

function UnitDropdown({
  units,
  value,
  onChange,
}: {
  units: Unit[]
  value: number | null
  onChange: (id: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const current = units.find((u) => u.id === value)

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400">
        <span className={current ? "flex-1 truncate font-medium" : "flex-1 truncate font-medium text-neutral-400"}>
          {current ? current.name : "Choose a unit"}
        </span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          <div className="py-1">
            <button type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50">
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-neutral-900">No unit</span>
                <span className="block text-[13px] text-neutral-500">Concerns will not be routed to anyone</span>
              </span>
              {value == null && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
            </button>
            {units.filter((u) => u.is_active).map((u) => (
              <button key={u.id} type="button"
                onClick={() => { onChange(u.id); setOpen(false) }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50">
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-neutral-900">{u.name}</span>
                  {u.short_name && <span className="block text-[13px] text-neutral-500">{u.short_name}</span>}
                </span>
                {value === u.id && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const REQUIREMENTS = [
  { key: "description_required", label: "Description required", hint: "Residents must describe the issue" },
  { key: "photo_required", label: "Photo required", hint: "Residents must attach at least one photo" },
  { key: "location_required", label: "Location required", hint: "Residents must pin where the issue is" },
] as const

function RequirementDropdown({
  draft,
  onChange,
}: {
  draft: Draft
  onChange: (next: Draft) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const onCount = REQUIREMENTS.filter((item) => Boolean(draft[item.key])).length

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400">
        <span className="flex-1 truncate font-medium">
          Set a requirement
          <span className="ml-2 text-[13px] font-normal text-neutral-500">
            {onCount} of {REQUIREMENTS.length}
          </span>
        </span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          <div className="py-1">
            {REQUIREMENTS.map((item) => {
              const checked = Boolean(draft[item.key])
              return (
                <button key={item.key} type="button"
                  onClick={() => onChange({ ...draft, [item.key]: !checked })}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50">
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-neutral-900">{item.label}</span>
                    <span className="block text-[13px] text-neutral-500">{item.hint}</span>
                  </span>
                  {checked ? (
                    <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
                  ) : (
                    <span className="size-4 shrink-0 rounded-full border-[1.5px] border-neutral-300" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function IconDropdown({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const current = ICONS.find(([k]) => k === value) ?? ICONS[0]
  const CurrentIcon = current[2]

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
          <CurrentIcon className="size-4" strokeWidth={1.7} />
        </span>
        <span className="flex-1 truncate font-medium">{current[1]}</span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '110px', overflowY: 'auto' }}>
          <div className="py-1">
            {ICONS.map(([key, name, Icon]) => (
              <button key={key} type="button"
                onClick={() => { onChange(key); setOpen(false) }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-navy text-white">
                  <Icon className="size-3.5" strokeWidth={1.7} />
                </span>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function OfficialCategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)

  const draftSnapshot = (value: Draft | null) => JSON.stringify({
    id: value?.id ?? null,
    name: value?.name ?? "",
    code: value?.code ?? "",
    description: value?.description ?? "",
    department: value?.department ?? null,
    icon_key: value?.icon_key ?? "tag",
    custom_icon_label: value?.custom_icon_label ?? "",
    photo_required: value?.photo_required ?? true,
    description_required: value?.description_required ?? true,
    location_required: value?.location_required ?? true,
    public_feed_allowed: value?.public_feed_allowed ?? true,
    is_active: value?.is_active ?? true,
  })

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

  function routedUnit(category: Category): Unit | null {
    const rule = rules
      .filter((item) => item.category === category.id && item.is_active)
      .sort((a, b) => b.priority - a.priority)[0]
    const unit = rule?.department_detail ?? category.department_detail ?? null
    return unit?.is_active ? unit : null
  }

  const filtered = useMemo(() => {
    if (!query) return categories.filter((c) => c.is_active)
    const q = query.toLowerCase()
    return categories
      .filter((c) => c.is_active)
      .filter((c) => `${c.name} ${c.code} ${c.description}`.toLowerCase().includes(q))
  }, [categories, query])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

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
      payload.append("public_feed_allowed", String(draft.public_feed_allowed ?? true))
      payload.append("is_active", String(draft.is_active ?? true))
      if (draft.department) payload.append("department", String(draft.department))
      if (draft.iconFile) payload.append("icon_image", draft.iconFile)
      await apiRequest(
        isNew ? "/concerns/admin/categories/" : `/concerns/admin/categories/${draft.id}/`,
        { method: isNew ? "POST" : "PATCH", body: payload },
      )
      toast.success(isNew ? "Category created" : "Category updated")
      setEditOpen(false); setDraft(null); setOriginalDraft(null); load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the category."))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      const result = await apiRequest<{ deleted: boolean; in_use: number }>(
        `/concerns/admin/categories/${deleteTarget.id}/`,
        { method: "DELETE" },
      )
      toast.success(
        result.deleted
          ? "Category deleted"
          : `Category deactivated — ${result.in_use} concern${result.in_use === 1 ? "" : "s"} still use it`,
      )
      setDeleteOpen(false); setDeleteTarget(null); load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove the category."))
    }
  }

  const unrouted = categories.filter((category) => category.is_active && !routedUnit(category))

  return (
    <ConfigShell
      icon={FolderOpenIcon}
      eyebrow="Operations"
      title="Concern categories"
      description="What residents can report, and which barangay unit answers each one."
      stats={[
        { label: "Categories", value: categories.filter((c) => c.is_active).length },
        { label: "No unit assigned", value: unrouted.length, alarm: unrouted.length > 0 },
        { label: "Units available", value: units.filter((u) => u.is_active).length },
      ]}
      action={
        <ConfigHeroAction icon={PlusIcon} onClick={() => { setDraft({ name: "", code: "", icon_key: "tag" }); setOriginalDraft(null); setEditOpen(true) }}>
          New category
        </ConfigHeroAction>
      }
    >
      {!loading && unrouted.length > 0 ? (
        <ConfigAlarm>
          {unrouted.length} categor{unrouted.length === 1 ? "y has" : "ies have"} no unit assigned:{" "}
          {unrouted.map((c) => c.name).join(", ")}. Concerns filed under them will not reach anyone.
        </ConfigAlarm>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch value={query} onChange={setQuery} placeholder="Search categories" className="w-full" />
      </div>

      {/* Editorial list */}
      <ol>
        {page.map((category) => {
          const Icon = iconFor(category.icon_key)
          const unit = routedUnit(category)
          const hasUnit = Boolean(unit)
          return (
            <li
              key={category.id}
              className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
                    {category.icon_image_url ? (
                      <img src={category.icon_image_url} alt="" className="size-full rounded-lg object-cover" />
                    ) : (
                      <Icon className="size-4" strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="text-row text-brand-navy">{category.name}</span>
                  {hasUnit ? (
                    <span className="inline-flex items-center gap-1 text-meta text-green-600">
                      <CircleCheck className="size-3.5" strokeWidth={2} />
                      Assigned
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-meta text-red-600">
                      <CircleX className="size-3.5" strokeWidth={2} />
                      No unit
                    </span>
                  )}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <dt className="text-meta text-neutral-400">Description</dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">{category.description || category.code}</dd>
                  </div>
                  <div>
                    <dt className="text-meta text-neutral-400">Assigned unit</dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">
                      {unit ? unit.name : "None"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
                <button type="button" onClick={() => { setDraft({ ...category }); setOriginalDraft(draftSnapshot(category)); setEditOpen(true) }} className="text-meta text-neutral-500 transition-colors hover:text-accent">Edit</button>
                <button type="button" onClick={() => { setDeleteTarget(category); setDeleteOpen(true) }} className="text-meta text-neutral-500 transition-colors hover:text-sos">Delete</button>
              </div>
            </li>
          )
        })}
        {page.length === 0 && !loading ? (
          <li className="py-14 text-center text-read text-neutral-500">No categories found.</li>
        ) : null}
      </ol>

      <Pager offset={offset} total={filtered.length} onChange={setOffset} noun="categories" />

      {/* Edit dialog */}
      {draft && (
        <SheetDialog
          open={editOpen}
          onClose={() => { setEditOpen(false); setDraft(null); setOriginalDraft(null) }}
          title={draft.id ? `Edit ${draft.name}` : "New concern category"}
          size="wide"
        >
          <div className="space-y-6 pb-4">
            <div className="space-y-4">
              <label className="block">
                <span className={labelCls}>Category name</span>
                <input value={draft.name || ""} onChange={(e) => {
                  const name = e.target.value
                  setDraft((current) => current?.id ? { ...current, name } : { ...current, name, code: slugify(name) })
                }} className={inputCls} placeholder="Illegal dumping" />
              </label>
              <label className="block">
                <span className={labelCls}>Description</span>
                <input value={draft.description || ""} onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))} className={inputCls} placeholder="Garbage dumped outside collection points" />
              </label>
            </div>

            {/* Assigned unit — dropdown with checkmarks, like the Icon picker */}
            <div className="space-y-2">
              <p className={labelCls}>Assigned unit</p>
              <UnitDropdown
                units={units}
                value={draft.department ?? null}
                onChange={(id) => setDraft((current) => ({ ...current, department: id }))}
              />
            </div>

            {/* Requirements — dropdown with checkmarks, like the Icon picker */}
            <div className="space-y-2">
              <p className={labelCls}>Report requirements</p>
              <RequirementDropdown draft={draft} onChange={setDraft} />
            </div>

            <div className="space-y-2">
              <p className={labelCls}>Community feed</p>
              <button
                type="button"
                onClick={() => setDraft((current) => ({ ...current, public_feed_allowed: !(current?.public_feed_allowed ?? true) }))}
                className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-200 px-4 py-3 text-left transition hover:bg-neutral-50"
              >
                <span className="flex-1 text-[15px]">
                  <span className="block text-[15px] font-medium text-neutral-900">Allow public sharing</span>
                  <span className="block text-[13px] text-neutral-500">Residents can choose to show this report in the community feed</span>
                </span>
                {draft.public_feed_allowed !== false ? <CircleCheck className="size-5 text-green-600" /> : <span className="size-5 rounded-full border-[1.5px] border-neutral-300" />}
              </button>
            </div>

            {/* Icon dropdown */}
            <div className="space-y-2">
              <p className={labelCls}>Icon</p>
              <IconDropdown value={draft.icon_key || "tag"} onChange={(key) => setDraft((current) => ({ ...current, icon_key: key }))} />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={saving || !draft.name?.trim() || Boolean(draft.id && originalDraft === draftSnapshot(draft))}
              onClick={() => void save()}
              className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {saving ? "Saving\u2026" : draft.id ? "Save changes" : "Create category"}
            </button>
            <SheetPrimaryButton disabled={saving} onClick={() => { setEditOpen(false); setDraft(null); setOriginalDraft(null) }}>Cancel</SheetPrimaryButton>
          </div>
        </SheetDialog>
      )}

      {/* Delete dialog */}
      <SheetDialog
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); setDeleteTarget(null) }}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : ""}
        description="Concerns already filed under this category keep their history. If any exist, it is deactivated instead of deleted."
        footer={
          <div className="flex gap-2">
            <SheetPrimaryButton onClick={() => { setDeleteOpen(false); setDeleteTarget(null) }} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">Cancel</SheetPrimaryButton>
            <SheetPrimaryButton tone="danger" onClick={() => void confirmDelete()} className="flex-1 text-[15px]">Delete category</SheetPrimaryButton>
          </div>
        }
      />
    </ConfigShell>
  )
}
