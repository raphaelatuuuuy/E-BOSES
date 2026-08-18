import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleCheck, ChevronRightIcon, PlusIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { CAPABILITY_LABEL } from "@/features/dashboard/lib/capabilities"
import { FilterRow, ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import {
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import { useAuthSession } from "@/features/auth/auth-session"

interface Position {
  id: number
  name: string
  code: string
  department: number | null
  permissions: string[]
  is_active: boolean
}

interface Department {
  id: number
  name: string
  short_name: string
}

type Draft = Partial<Position>

const GROUPS: { title: string; capabilities: string[] }[] = [
  { title: "User management", capabilities: ["manage_units", "manage_roles", "manage_users"] },
  {
    title: "Reports",
    capabilities: ["manage_categories", "configure_classification", "resolve_concerns"],
  },
  {
    title: "Emergency response",
    capabilities: ["configure_dispatch", "configure_geography", "dispatch_emergencies"],
  },
  {
    title: "Community",
    capabilities: ["publish_announcements"],
  },
]

const CAPABILITY_HINT: Record<string, string> = {
  manage_units: "Create, edit and deactivate barangay units",
  manage_roles: "Change which capabilities each position holds",
  manage_users: "Create accounts, assign units and positions, deactivate",
  resolve_concerns: "Update status, assign and close community concerns",
  manage_categories: "Edit concern categories and their intake forms",
  configure_classification: "Adjust AI thresholds and keyword rules",
  configure_dispatch: "Set which unit answers each emergency type",
  configure_geography: "Set barangay boundary, zones and alert radii",
  publish_announcements: "Post announcements and barangay events",
  dispatch_emergencies: "Assign responders and escalate active alerts",
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

function CapabilityGroup({ title, capabilities, selected, onToggle, defaultOpen = false, isLast = false }: {
  title: string; capabilities: string[]; selected: string[]; onToggle: (cap: string) => void; defaultOpen?: boolean; isLast?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-neutral-50">
        <span className="text-[15px] font-medium text-neutral-900">{title}</span>
        <ChevronRightIcon className={`size-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-neutral-100">
          {capabilities.map((cap) => {
            const isSelected = selected.includes(cap)
            return (
              <button key={cap} type="button"
                onClick={() => onToggle(cap)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-neutral-50">
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-medium text-neutral-900">{CAPABILITY_LABEL[cap] ?? cap}</span>
                  <span className="block text-[13px] text-neutral-500">{CAPABILITY_HINT[cap]}</span>
                </span>
                {isSelected && <CircleCheck className="size-5 shrink-0 text-green-600" strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      )}
      {!isLast && <div className="border-b border-neutral-200" />}
    </>
  )
}

export default function OfficialRolesPage() {
  const { refreshUser } = useAuthSession()
  const [positions, setPositions] = useState<Position[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [unitKey, setUnitKey] = useState("all")
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  const filterKey = `${unitKey}|${debounced}`
  const [prevKey, setPrevKey] = useState(filterKey)
  if (prevKey !== filterKey) { setPrevKey(filterKey); setOffset(0) }

  const load = useCallback(() => {
    Promise.all([
      apiRequest<Position[]>("/concerns/admin/positions/"),
      apiRequest<Department[]>("/concerns/admin/departments/"),
    ])
      .then(([pos, deps]) => { setPositions(pos); setDepartments(deps) })
      .catch((error) => toast.error(describeApiError(error, "Could not load positions.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const unitFilter = unitKey === "all" ? null : Number(unitKey)
    let result = positions.filter((p) => p.is_active)
    if (unitFilter != null) result = result.filter((p) => p.department === unitFilter)
    if (debounced) {
      const q = debounced.toLowerCase()
      result = result.filter((p) => {
        const unit = p.department ? departments.find((d) => d.id === p.department) : null
        return p.name.toLowerCase().includes(q) ||
          (unit ? `${unit.name} ${unit.short_name}`.toLowerCase().includes(q) : false)
      })
    }
    return result
  }, [positions, departments, debounced, unitKey])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

  const positionSnapshot = (value: Draft | null) => JSON.stringify({
    id: value?.id ?? null,
    name: value?.name ?? "",
    code: value?.code ?? "",
    permissions: value?.permissions ?? [],
    is_active: value?.is_active ?? true,
  })

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const isNew = !draft.id
      await apiRequest<Position>(
        isNew ? "/concerns/admin/positions/" : `/concerns/admin/positions/${draft.id}/`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      )
      await refreshUser()
      toast.success(isNew ? "Position created" : "Position updated")
      setEditOpen(false); setDraft(null); load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the position."))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      await apiRequest(`/concerns/admin/positions/${deleteTarget.id}/`, { method: "DELETE" })
      await refreshUser()
      toast.success("Position removed")
      setDeleteOpen(false); setDeleteTarget(null); load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove the position."))
    }
  }

  const held = draft?.permissions ?? []

  function toggle(capability: string) {
    if (!draft) return
    setDraft({
      ...draft,
      permissions: held.includes(capability)
        ? held.filter((item) => item !== capability)
        : [...held, capability],
    })
  }

  const activePositions = positions.filter((p) => p.is_active)
  const unitsWithPositions = departments.filter((d) => activePositions.some((p) => p.department === d.id))
  const countFor = (id: number | null) =>
    id == null ? activePositions.length : activePositions.filter((p) => p.department === id).length
  const unitCounts: Record<string, number> = {
    all: countFor(null),
    ...Object.fromEntries(unitsWithPositions.map((u) => [String(u.id), countFor(u.id)])),
  }
  const unitDetails: Record<string, string> = Object.fromEntries(
    unitsWithPositions.map((u) => [String(u.id), u.name]),
  )

  return (
    <ConfigShell
      icon={ShieldCheckIcon}
      eyebrow="User management"
      title="Permissions"
      description="What each position is allowed to do. Give someone a position in Users, and they get everything ticked here."
      stats={[
        { label: "Positions", value: activePositions.length },
        { label: "Without permissions", value: activePositions.filter((p) => p.permissions.length === 0).length, alarm: activePositions.some((p) => p.permissions.length === 0) },
      ]}
      action={
        <ConfigHeroAction icon={PlusIcon} onClick={() => { setDraft({ name: "", code: "", permissions: [] }); setOriginalDraft(null); setEditOpen(true) }}>
          New position
        </ConfigHeroAction>
      }
    >
      <FilterRow
        options={[
          { key: "all", label: "All" },
          ...unitsWithPositions.map((u) => ({ key: String(u.id), label: u.short_name || u.name })),
        ]}
        counts={unitCounts}
        details={unitDetails}
        value={unitKey}
        onChange={setUnitKey}
        className="mt-8"
      />

      <ListSearch value={query} onChange={setQuery} placeholder="Search positions or units" className="mt-5 flex-1 sm:max-w-xs" />

      {/* Editorial list */}
      <ol>
        {page.map((position) => (
          <li
            key={position.id}
            className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="text-row text-brand-navy">{position.name}</span>
                {position.department && (
                  <span className="text-meta text-neutral-400">
                    {departments.find((d) => d.id === position.department)?.name ?? "Unit"}
                  </span>
                )}
              </div>
              <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <dt className="text-meta text-neutral-400">Permissions</dt>
                  <dd className="mt-0.5 text-meta text-brand-navy">
                    {position.permissions.length === 0 ? (
                      <span className="italic text-neutral-400">None assigned</span>
                    ) : (
                      <>
                        {position.permissions.slice(0, 5).map((cap) => CAPABILITY_LABEL[cap] ?? cap).join(", ")}
                        {position.permissions.length > 5 && (
                          <span className="mt-1 block text-meta text-neutral-400">+{position.permissions.length - 5} more</span>
                        )}
                      </>
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
              <button type="button" onClick={() => { setDraft(position); setOriginalDraft(positionSnapshot(position)); setEditOpen(true) }} className="text-meta text-neutral-500 transition-colors hover:text-accent">Edit</button>
              <button type="button" onClick={() => { setDeleteTarget(position); setDeleteOpen(true) }} className="text-meta text-neutral-500 transition-colors hover:text-sos">Delete</button>
            </div>
          </li>
        ))}
        {page.length === 0 && !loading ? (
          <li className="py-14 text-center text-read text-neutral-500">No positions found.</li>
        ) : null}
      </ol>

      <Pager offset={offset} total={filtered.length} onChange={setOffset} noun="positions" />

      {/* Edit dialog */}
      {draft && (
        <SheetDialog
          open={editOpen}
          onClose={() => { setEditOpen(false); setDraft(null); setOriginalDraft(null) }}
          title={draft.id ? `Edit ${draft.name}` : "New position"}
          size="wide"
        >
          <div className="space-y-6 pb-4">
            <label className="block">
              <span className={labelCls}>Position name</span>
              <input
                value={draft.name || ""}
                onChange={(e) => {
                  const name = e.target.value
                  setDraft((current) => current?.id ? { ...current, name } : { ...current, name, code: slugify(name) })
                }}
                className={inputCls}
                placeholder="Barangay Secretary"
              />
            </label>

            {/* Capabilities by group — merged accordion */}
            <div className="space-y-2">
              <p className={labelCls}>Permissions</p>
              <div className="overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white">
                {GROUPS.map((group, index) => (
                  <CapabilityGroup
                    key={group.title}
                    title={group.title}
                    capabilities={group.capabilities}
                    selected={held}
                    onToggle={toggle}
                    defaultOpen={index === 0}
                    isLast={index === GROUPS.length - 1}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={saving || !draft.name || Boolean(draft.id && positionSnapshot(draft) === originalDraft)}
              onClick={() => void save()}
              className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {saving ? "Saving\u2026" : draft.id ? "Save changes" : "Create position"}
            </button>
            <SheetPrimaryButton disabled={saving} onClick={() => { setEditOpen(false); setDraft(null) }}>Cancel</SheetPrimaryButton>
          </div>
        </SheetDialog>
      )}

      {/* Delete dialog */}
      <SheetDialog
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); setDeleteTarget(null) }}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : ""}
        description="This position will be removed. People assigned to it will lose these permissions."
        footer={
          <div className="flex gap-2">
            <SheetPrimaryButton onClick={() => { setDeleteOpen(false); setDeleteTarget(null) }} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">Cancel</SheetPrimaryButton>
            <SheetPrimaryButton tone="danger" onClick={() => void confirmDelete()} className="flex-1 text-[15px]">Delete position</SheetPrimaryButton>
          </div>
        }
      />
    </ConfigShell>
  )
}
