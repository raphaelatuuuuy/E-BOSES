import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ConfigHeroAction, ConfigShell } from "@/features/dashboard/components/config/config-shell"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationInfoRow, ConfigurationTable } from "@/features/dashboard/components/config/configuration-table"
import { SheetActionRow, SheetDialog, SheetIconButton, SheetPrimaryButton, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"

interface Unit {
  id: number
  name: string
  code: string
  short_name: string
  description: string
  emergency_role: string
  sort_order: number
  is_active: boolean
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
    is_active: value?.is_active ?? true,
  })
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
}

const FILTERS = [
  { key: "all", label: "Active" },
  { key: "inactive", label: "Inactive" },
]

function EditDialog({
  open, draft, onChange, onSave, onClose, saving, originalDraft,
  positions, positionsDirty, onPositionsChange,
}: {
  open: boolean; draft: Draft; onChange: (next: Draft) => void; onSave: () => void
  onClose: () => void; saving: boolean
  originalDraft: string | null
  positions: UnitPosition[]; positionsDirty: boolean; onPositionsChange: (next: UnitPosition[]) => void
}) {
  const isNew = !draft.id
  const dirty = isNew || unitSnapshot(draft) !== originalDraft
  const canSave = dirty || positionsDirty

  const inputCls = "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
  const labelCls = "text-[13px] font-semibold text-neutral-500"

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title={isNew ? "New unit" : `Edit ${draft.name}`}
      size="wide"
      footer={
        <SheetActionRow>
          <SheetSecondaryButton onClick={onClose} disabled={saving}>Cancel</SheetSecondaryButton>
          <SheetPrimaryButton
            tone="accent"
            onClick={onSave}
            disabled={saving || !draft.name?.trim() || !canSave}
          >
            {saving ? "Saving…" : isNew ? "Create unit" : "Save changes"}
          </SheetPrimaryButton>
        </SheetActionRow>
      }
    >
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

      </div>

    </SheetDialog>
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
          <SheetActionRow>
            <SheetSecondaryButton disabled={saving} onClick={() => { setConfirmName(""); onClose() }}>Cancel</SheetSecondaryButton>
            <SheetPrimaryButton tone="danger" disabled={saving || !matches} onClick={onConfirm}>
              {saving ? "Deleting\u2026" : "Delete"}
            </SheetPrimaryButton>
          </SheetActionRow>
        </div>
      }
    />
  )
}

export default function OfficialUnitsPage({ embedded = false }: { embedded?: boolean }) {
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [offset, setOffset] = useState(0)
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
    apiRequest<Unit[]>("/concerns/admin/departments/")
      .then(setUnits)
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
    setDraft(isNew ? { name: "", code: "" } : unit)
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
      const unitPayload = {
        name: draft.name?.trim(),
        code: draft.code || slugify(draft.name || ""),
        short_name: draft.short_name ?? "",
        description: draft.description ?? "",
        contact_number: draft.contact_number ?? "",
        is_active: draft.is_active ?? true,
      }
      const saved = await apiRequest<Unit>(isNew ? "/concerns/admin/departments/" : `/concerns/admin/departments/${draft.id}/`, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(unitPayload) })
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

  useEffect(() => {
    if (!embedded) return
    const handle = () => openEdit(null)
    window.addEventListener("configuration-primary-action", handle)
    return () => window.removeEventListener("configuration-primary-action", handle)
  }, [embedded, openEdit])

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
    if (filter === "inactive" && u.is_active) return false
    if (filter === "all" && !u.is_active) return false
    if (query && !`${u.name} ${u.short_name} ${u.code} ${u.description}`.toLowerCase().includes(query)) return false
    return true
  })

  const page = filtered.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  return (
    <ConfigShell embedded={embedded} hideEmbeddedAction={embedded} icon={UsersIcon} eyebrow="User management" title="Units"
      description="Add the barangay offices, desks, teams and committees that receive reports."
      stats={[
        { label: "Active units", value: units.filter((u) => u.is_active).length },
        { label: "Members placed", value: units.reduce((t, u) => t + u.member_count, 0) },
        { label: "Inactive", value: units.filter((u) => !u.is_active).length },
      ]}
      action={<ConfigHeroAction icon={PlusIcon} onClick={() => openEdit(null)}>New unit</ConfigHeroAction>}>
      <div className="space-y-4">
        <ConfigurationListToolbar
          search={search}
          onSearch={(value) => { setSearch(value); setOffset(0) }}
          placeholder="Search units"
          filters={FILTERS.map((item) => ({ key: item.key, label: item.label, count: item.key === "all" ? units.filter((u) => u.is_active).length : units.filter((u) => !u.is_active).length }))}
          activeFilter={filter}
          onFilter={(value) => { setFilter(value); setOffset(0) }}
        />

        {loading ? <div className="divide-y divide-neutral-200">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="flex items-center gap-4 px-1 py-5"><span className="h-3 w-32 animate-pulse rounded-full bg-neutral-200" /><span className="h-3 w-20 animate-pulse rounded-full bg-neutral-200" /></div>)}</div>
        : page.length === 0 ? <p className="py-16 text-center text-read text-neutral-500">{query ? "No units match your search." : 'No units here yet. Use "New unit" above to create one.'}</p>
        : <ConfigurationTable label="Units" hideHeader>{page.map((unit) => (
          <ConfigurationInfoRow key={unit.id} icon={UsersIcon} title={unit.name}
            subtext={unit.short_name}
            description={unit.member_count > 0 ? `${unit.member_count} member${unit.member_count === 1 ? "" : "s"}` : null}
            actions={<>
              <SheetIconButton label={`Edit ${unit.name}`} onClick={() => openEdit(unit)}>
                <PencilIcon className="size-5" strokeWidth={1.8} aria-hidden />
              </SheetIconButton>
              <SheetIconButton label={`Delete ${unit.name}`} onClick={() => { setDeleteTarget(unit); setDeleteOpen(true) }} className="text-neutral-500 hover:text-sos">
                <Trash2Icon className="size-5" strokeWidth={1.8} aria-hidden />
              </SheetIconButton>
            </>} />
        ))}</ConfigurationTable>}

        {!loading && filtered.length > 0 && <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="units" />}
      </div>

      {draft && <EditDialog open={editOpen} draft={draft} onChange={setDraft} onSave={() => void save()} onClose={closeEdit} saving={saving} originalDraft={originalDraft} positions={editPositions} positionsDirty={positionsDirty} onPositionsChange={setEditPositions} />}
      <DeleteDialog open={deleteOpen} unit={deleteTarget} onConfirm={() => void confirmDelete()} onClose={() => { setDeleteOpen(false); setDeleteTarget(null) }} saving={deleting} />
    </ConfigShell>
  )
}
