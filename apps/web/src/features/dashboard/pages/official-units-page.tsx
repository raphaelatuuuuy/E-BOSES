import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIcon, AmbulanceIcon, BabyIcon, BadgeAlertIcon, BellIcon, CircleCheck, ChevronDownIcon, ChevronUpIcon, CloudRainWindIcon, FlameIcon, HeartCrackIcon, HomeIcon, MapPinIcon, PillIcon, PlusIcon, ShieldAlertIcon, SirenIcon, StethoscopeIcon, UsersIcon, WavesIcon, ZapIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import { ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { listEmergencyCategories, type EmergencyCategory } from "@/features/dashboard/emergency-api"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"

interface Unit {
  id: number
  name: string
  code: string
  short_name: string
  description: string
  emergency_role: string
  sort_order: number
  is_active: boolean
  responds_to_emergencies: boolean
  emergency_types: string[]
  contact_number: string
  member_count: number
}

interface UnitPosition {
  id?: number
  name: string
  code: string
  department: number | null
  is_active: boolean
}

type Draft = Partial<Unit> & { name?: string; code?: string }

function unitSnapshot(value: Draft | null) {
  return JSON.stringify({
    id: value?.id ?? null,
    name: value?.name ?? "",
    code: value?.code ?? "",
    short_name: value?.short_name ?? "",
    description: value?.description ?? "",
    emergency_types: value?.emergency_types ?? [],
    responds_to_emergencies: value?.responds_to_emergencies ?? false,
    is_active: value?.is_active ?? true,
  })
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
}

const FILTERS = [
  { key: "all", label: "Active" },
  { key: "emergency", label: "Emergency responders" },
  { key: "inactive", label: "Inactive" },
]

function EditDialog({
  open, draft, onChange, onSave, onClose, saving, emergencyCategories, originalDraft,
  positions, positionsDirty, onPositionsChange,
}: {
  open: boolean; draft: Draft; onChange: (next: Draft) => void; onSave: () => void
  onClose: () => void; saving: boolean; emergencyCategories: EmergencyCategory[]
  originalDraft: string | null
  positions: UnitPosition[]; positionsDirty: boolean; onPositionsChange: (next: UnitPosition[]) => void
}) {
  const isNew = !draft.id
  const dirty = isNew || unitSnapshot(draft) !== originalDraft
  const canSave = dirty || positionsDirty
  const responds = Boolean(draft.responds_to_emergencies)
  const types = draft.emergency_types ?? []

  // Strip any stale codes the DB no longer has as active
  const activeCodes = new Set(emergencyCategories.filter((c) => c.is_active).map((c) => c.code))
  const validTypes = types.filter((t) => activeCodes.has(t))
  if (validTypes.length !== types.length) {
    // silently drop invalid codes from the draft on first render
    onChange({ ...draft, emergency_types: validTypes })
  }

  const inputCls = "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
  const labelCls = "text-[13px] font-semibold text-neutral-500"

  return (
    <SheetDialog open={open} onClose={onClose} title={isNew ? "New unit" : `Edit ${draft.name}`} size="wide">
      <div className="space-y-6">
        {/* Basic info */}
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>Unit name</span>
            <input value={draft.name ?? ""} onChange={(e) => {
              const name = e.target.value
              onChange(isNew ? { ...draft, name, code: slugify(name) } : { ...draft, name })
            }} className={inputCls} placeholder="Barangay Health Workers" />
          </label>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
            <label className="block">
              <span className={labelCls}>Short name</span>
              <input value={draft.short_name ?? ""} onChange={(e) => onChange({ ...draft, short_name: e.target.value })} className={inputCls} placeholder="BHW" />
              <span className="mt-1 block text-[13px] text-neutral-400">Used in tables and map pins.</span>
            </label>
            <label className="block">
              <span className={labelCls}>Description</span>
              <input value={draft.description ?? ""} onChange={(e) => onChange({ ...draft, description: e.target.value })} className={inputCls} placeholder="Health concerns, medical assistance" />
            </label>
          </div>

          {draft.id && (
            <PositionsDropdown unitId={draft.id} positions={positions} onChange={onPositionsChange} />
          )}
        </div>

        {/* Emergency dispatch */}
        <div className="space-y-2">
          <p className="text-[13px] font-semibold text-neutral-500">Emergency types</p>
          <EmergencyTypeDropdown
            categories={emergencyCategories}
            selected={validTypes}
            onChange={(types) => onChange({ ...draft, emergency_types: types, responds_to_emergencies: types.length > 0 })}
          />
          {validTypes.length > 0 && (
            <p className="text-[13px] text-neutral-400">This unit will respond to emergencies for the selected types.</p>
          )}
          {validTypes.length === 0 && (
            <p className="text-[13px] text-neutral-400">Leave empty if this unit does not respond to emergencies.</p>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <button type="button" onClick={onSave} disabled={saving || !draft.name || (responds && validTypes.length === 0) || !canSave}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
          {saving ? "Saving\u2026" : isNew ? "Create unit" : "Save changes"}
        </button>
        <SheetPrimaryButton onClick={onClose} disabled={saving}>Cancel</SheetPrimaryButton>
      </div>
    </SheetDialog>
  )
}

const ICONS_MAP: Record<string, typeof SirenIcon> = {
  siren: SirenIcon,
  activity: ActivityIcon,
  ambulance: AmbulanceIcon,
  baby: BabyIcon,
  "badge-alert": BadgeAlertIcon,
  bell: BellIcon,
  "cloud-rain-wind": CloudRainWindIcon,
  flame: FlameIcon,
  "heart-crack": HeartCrackIcon,
  home: HomeIcon,
  "map-pin": MapPinIcon,
  pill: PillIcon,
  "shield-alert": ShieldAlertIcon,
  stethoscope: StethoscopeIcon,
  waves: WavesIcon,
  zap: ZapIcon,
}

function EmergencyTypeDropdown({ categories, selected, onChange }: {
  categories: EmergencyCategory[]; selected: string[]; onChange: (types: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const active = categories.filter((c) => c.is_active)
  const selectedLabels = selected.map((code) => active.find((c) => c.code === code)?.label).filter(Boolean)

  function toggle(code: string) {
    onChange(selected.includes(code) ? selected.filter((t) => t !== code) : [...selected, code])
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400">
        <span className="flex-1 truncate font-medium">
          {selectedLabels.length > 0 ? selectedLabels.join(", ") : "Select emergency types"}
        </span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '110px', overflowY: 'auto' }}>
          <div className="py-1">
            {active.map((category) => {
              const Icon = ICONS_MAP[category.icon_key] ?? SirenIcon
              const isSelected = selected.includes(category.code)
              return (
                <button key={category.code} type="button"
                  onClick={() => toggle(category.code)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-navy text-white">
                    <Icon className="size-3.5" strokeWidth={1.7} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-neutral-900">{category.label}</span>
                    <span className="block text-[13px] text-neutral-500">{category.subtext || category.code}</span>
                  </span>
                  {isSelected && <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PositionsDropdown({ unitId, positions, onChange }: {
  unitId: number; positions: UnitPosition[]; onChange: (next: UnitPosition[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState("")
  const [adding, setAdding] = useState(false)
  const [addName, setAddName] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        if (editingId != null) commitEdit()
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  })

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open, editingId, adding])

  const active = positions.filter((p) => p.is_active)
  const rowCls = "flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-neutral-50"
  const editInputCls = "w-full rounded-lg border-[1.5px] border-neutral-300 bg-white px-3 py-1.5 text-[15px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"

  function addPosition() {
    const name = addName.trim()
    setAddName("")
    setAdding(false)
    if (!name) return
    onChange([...positions, { id: undefined, name, code: "", department: unitId, is_active: true }])
  }

  function commitEdit() {
    if (editingId == null) return
    const id = editingId
    const name = editingName.trim()
    setEditingId(null)
    if (!name) {
      onChange(positions.filter((p) => p.id !== id))
      return
    }
    onChange(positions.map((p) => (p.id === id ? { ...p, name } : p)))
  }

  return (
    <div ref={ref} className="space-y-2">
      <p className="text-[13px] font-semibold text-neutral-500">Positions</p>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400">
        <span className="flex-1 truncate font-medium">
          {active.length === 0 ? "No positions yet" : `${active.length} position${active.length === 1 ? "" : "s"}`}
        </span>
        {open ? <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" /> : <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />}
      </button>
      {open && (
        <div className="overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          <div className="py-1">
            {active.map((position) => (
              <div key={position.id ?? `new-${position.name}`} className={rowCls}>
                {editingId === position.id ? (
                  <input
                    ref={inputRef}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => void commitEdit()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void commitEdit() }
                      if (e.key === "Escape") setEditingId(null)
                    }}
                    className={editInputCls}
                    placeholder={position.name}
                  />
                ) : (
                  <button type="button" onClick={() => { setEditingId(position.id ?? null); setEditingName(position.name) }}
                    className="flex w-full items-center gap-3 text-left text-[15px] text-neutral-700">
                    <span className="flex-1 min-w-0 truncate font-medium text-neutral-900">{position.name}</span>
                  </button>
                )}
              </div>
            ))}
            {adding ? (
              <div className={rowCls}>
                <input
                  ref={inputRef}
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  onBlur={() => void addPosition()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void addPosition() }
                    if (e.key === "Escape") { setAdding(false); setAddName("") }
                  }}
                  className={editInputCls}
                  placeholder="New position"
                />
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)}
                className="flex w-full items-center gap-3 border-t border-neutral-100 px-4 py-2.5 text-left text-[15px] font-medium text-accent transition hover:bg-neutral-50">
                <span>Add a position</span>
                <span className="flex-1 text-[15px]" />
                <span className="text-[13px] font-normal text-neutral-400">Click a position to rename</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DeleteDialog({ open, unit, onConfirm, onClose, saving }: {
  open: boolean; unit: Unit | null; onConfirm: () => void; onClose: () => void; saving: boolean
}) {
  const [confirmName, setConfirmName] = useState("")
  if (!unit) return null
  const matches = confirmName.trim() === unit.name
  return (
    <SheetDialog
      open={open}
      onClose={() => { setConfirmName(""); onClose() }}
      title={`Delete ${unit.name}?`}
      description={
        unit.member_count > 0
          ? `${unit.name} has ${unit.member_count} member${unit.member_count === 1 ? "" : "s"}. It will be deactivated instead of deleted.`
          : "This cannot be undone."
      }
      footer={
        <div className="space-y-3">
          <p className="text-[15px] text-neutral-500">Type <strong className="text-neutral-900">{unit.name}</strong> to confirm.</p>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
            placeholder={unit.name}
            autoFocus
          />
          <div className="flex gap-2">
            <SheetPrimaryButton disabled={saving} onClick={() => { setConfirmName(""); onClose() }} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">Cancel</SheetPrimaryButton>
            <SheetPrimaryButton tone="danger" disabled={saving || !matches} onClick={onConfirm} className="flex-1 text-[15px]">
              {saving ? "Deleting\u2026" : "Delete"}
            </SheetPrimaryButton>
          </div>
        </div>
      }
    />
  )
}

export default function OfficialUnitsPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [emergencyCategories, setEmergencyCategories] = useState<EmergencyCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [offset, setOffset] = useState(0)
  const rangeScrollRef = useWheelScroll<HTMLDivElement>()
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const [editPositions, setEditPositions] = useState<UnitPosition[]>([])
  const [originalPositions, setOriginalPositions] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => { const t = window.setTimeout(() => setDebounced(search.trim()), 250); return () => window.clearTimeout(t) }, [search])

  const filterKey = `${filter}|${debounced}`
  const [prevKey, setPrevKey] = useState(filterKey)
  if (prevKey !== filterKey) { setPrevKey(filterKey); setOffset(0) }

  const load = useCallback(() => {
    Promise.all([apiRequest<Unit[]>("/concerns/admin/departments/"), listEmergencyCategories()])
      .then(([u, c]) => { setUnits(u); setEmergencyCategories(c) })
      .catch((e) => toast.error(describeApiError(e, "Could not load units.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { void load() }, [load])

  const positionsSnapshot = (list: UnitPosition[]) =>
    JSON.stringify(list.map((p) => ({ id: p.id ?? 0, name: p.name })))
  const positionsDirty = originalPositions !== null && positionsSnapshot(editPositions) !== originalPositions

  function closeEdit() {
    setEditOpen(false); setDraft(null); setOriginalDraft(null)
    setEditPositions([]); setOriginalPositions(null)
  }

  function openEdit(unit: Unit | null) {
    const isNew = unit == null
    setDraft(isNew ? { name: "", code: "", emergency_types: [] } : unit)
    setOriginalDraft(isNew ? null : unitSnapshot(unit))
    setEditPositions([])
    setOriginalPositions(null)
    setEditOpen(true)
    if (isNew) return
    apiRequest<UnitPosition[]>("/concerns/admin/positions/")
      .then((all) => {
        const list = all.filter((p) => p.department === unit.id)
        setEditPositions(list)
        setOriginalPositions(JSON.stringify(list.map((p) => ({ id: p.id, name: p.name }))))
      })
      .catch((e) => toast.error(describeApiError(e, "Could not load positions.")))
  }

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const isNew = !draft.id
      const saved = await apiRequest<Unit>(isNew ? "/concerns/admin/departments/" : `/concerns/admin/departments/${draft.id}/`, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })
      if (positionsDirty) {
        const original: { id: number; name: string }[] = originalPositions ? JSON.parse(originalPositions) : []
        const keptIds = new Set(editPositions.filter((p) => p.id != null).map((p) => p.id as number))
        const ops: Promise<unknown>[] = []
        for (const p of editPositions) {
          if (p.id == null) {
            ops.push(apiRequest("/concerns/admin/positions/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: p.name, code: slugify(p.name), department: saved.id, is_active: true }),
            }))
          } else {
            const before = original.find((o) => o.id === p.id)
            if (before && before.name !== p.name) {
              ops.push(apiRequest(`/concerns/admin/positions/${p.id}/`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: p.name }),
              }))
            }
          }
        }
        for (const o of original) {
          if (!keptIds.has(o.id)) {
            ops.push(apiRequest(`/concerns/admin/positions/${o.id}/`, { method: "DELETE" }))
          }
        }
        await Promise.all(ops)
      }
      toast.success(isNew ? "Unit created" : "Unit updated")
      closeEdit(); load()
    } catch (e) { toast.error(describeApiError(e, "Could not save the unit.")) } finally { setSaving(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const result = await apiRequest<{ deleted: boolean; deactivated: boolean; in_use: number }>(`/concerns/admin/departments/${deleteTarget.id}/`, { method: "DELETE" })
      toast.success(result.deleted ? "Unit deleted" : `Unit deactivated — still referenced by ${result.in_use} record${result.in_use === 1 ? "" : "s"}`)
      setDeleteOpen(false); setDeleteTarget(null); load()
    } catch (e) { toast.error(describeApiError(e, "Could not remove the unit.")) } finally { setDeleting(false) }
  }

  const query = debounced.toLowerCase()
  const filtered = units.filter((u) => {
    if (filter === "emergency" && !u.responds_to_emergencies) return false
    if (filter === "inactive" && u.is_active) return false
    if (filter === "all" && !u.is_active) return false
    if (query && !`${u.name} ${u.short_name} ${u.code} ${u.description}`.toLowerCase().includes(query)) return false
    return true
  })

  const page = filtered.slice(offset, offset + PAGE_SIZE)
  const eLabel = (code: string) => emergencyCategories.find((c) => c.code === code)?.label ?? code
  const respondingCount = units.filter((u) => u.is_active && u.responds_to_emergencies).length

  return (
    <ConfigShell icon={UsersIcon} eyebrow="User management" title="Units"
      description="Barangay units, desks and committees. A unit marked as an emergency responder receives SOS alerts for the types you choose."
      stats={[
        { label: "Active units", value: units.filter((u) => u.is_active).length },
        { label: "Answer emergencies", value: respondingCount, alarm: respondingCount === 0 },
        { label: "Members placed", value: units.reduce((t, u) => t + u.member_count, 0) },
        { label: "Inactive", value: units.filter((u) => !u.is_active).length },
      ]}
      action={<ConfigHeroAction icon={PlusIcon} onClick={() => openEdit(null)}>New unit</ConfigHeroAction>}>
      {!loading && respondingCount === 0 && <ConfigAlarm>No unit answers emergencies yet. Until one does, an SOS cannot be routed to anyone automatically — open a unit and turn on "Responds to emergencies".</ConfigAlarm>}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <ListSearch value={search} onChange={setSearch} placeholder="Search units" label="Search units" className="flex-1 sm:max-w-xs" />
          <div ref={rangeScrollRef} className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((item) => {
              const count = item.key === "all" ? units.filter((u) => u.is_active).length : item.key === "emergency" ? units.filter((u) => u.responds_to_emergencies).length : units.filter((u) => !u.is_active).length
              return <button key={item.key} type="button" onClick={() => setFilter(item.key)} className={filter === item.key ? "shrink-0 text-read font-medium text-brand-navy" : "shrink-0 text-read text-neutral-400 hover:text-brand-navy"}>{item.label}<span className="ml-1.5 tabular-nums text-neutral-400">{count}</span></button>
            })}
          </div>
        </div>

        {loading ? <div className="divide-y divide-neutral-200">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-4 px-1 py-5"><span className="h-3 w-32 animate-pulse rounded-full bg-neutral-200" /><span className="h-3 w-20 animate-pulse rounded-full bg-neutral-200" /></div>)}</div>
        : page.length === 0 ? <p className="py-16 text-center text-read text-neutral-500">{query ? "No units match your search." : 'No units here yet. Use "New unit" above to create one.'}</p>
        : <ol className="divide-y divide-neutral-200">{page.map((unit) => (
          <li key={unit.id} className="flex items-center gap-4 py-5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <span className="text-row font-medium text-brand-navy">{unit.name}</span>
                {unit.short_name && <span className="text-meta text-neutral-400">{unit.short_name}</span>}
                {!unit.is_active && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-meta font-medium text-neutral-500">Inactive</span>}
              </div>
              <p className="mt-1 text-meta text-neutral-500">{unit.description || unit.code}{unit.member_count > 0 && <> · {unit.member_count} member{unit.member_count === 1 ? "" : "s"}</>}</p>
              {unit.responds_to_emergencies && unit.emergency_types.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{unit.emergency_types.map((type) => <span key={type} className="rounded-full bg-neutral-100 px-2 py-0.5 text-meta font-medium text-neutral-600">{eLabel(type)}</span>)}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button type="button" onClick={() => openEdit(unit)} className="text-meta text-neutral-500 transition-colors hover:text-accent">Edit</button>
              <button type="button" onClick={() => { setDeleteTarget(unit); setDeleteOpen(true) }} className="text-meta text-neutral-500 transition-colors hover:text-sos">Delete</button>
            </div>
          </li>
        ))}</ol>}

        {!loading && filtered.length > 0 && <Pager offset={offset} total={filtered.length} onChange={setOffset} noun="units" />}
      </div>

      {draft && <EditDialog open={editOpen} draft={draft} onChange={setDraft} onSave={() => void save()} onClose={closeEdit} saving={saving} emergencyCategories={emergencyCategories} originalDraft={originalDraft} positions={editPositions} positionsDirty={positionsDirty} onPositionsChange={setEditPositions} />}
      <DeleteDialog open={deleteOpen} unit={deleteTarget} onConfirm={() => void confirmDelete()} onClose={() => { setDeleteOpen(false); setDeleteTarget(null) }} saving={deleting} />
    </ConfigShell>
  )
}
