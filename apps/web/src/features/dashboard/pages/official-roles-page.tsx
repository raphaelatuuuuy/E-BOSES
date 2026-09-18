import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleCheck, ChevronRightIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { CAPABILITY_LABEL } from "@/features/dashboard/lib/capabilities"
import { CONFIGURATION_PAGE_SIZE, ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationTable, ConfigurationTableEmpty, ConfigurationTableRow } from "@/features/dashboard/components/config/configuration-table"
import { SheetDialog, SheetIconButton, SheetPrimaryButton, SheetSecondaryButton } from "@/features/dashboard/components/sheet-dialog"
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

export default function OfficialRolesPage({ embedded = false }: { embedded?: boolean }) {
  const { refreshUser } = useAuthSession()
  const [positions, setPositions] = useState<Position[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [unitKey, setUnitKey] = useState("all")
  const [offset, setOffset] = useState(0)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null)
  const [deleteGrown, setDeleteGrown] = useState(false)
  const removeRef = useRef<() => void>(() => {})
  useEffect(() => { removeRef.current = () => void removePosition(draft?.id) })
  useEffect(() => { if (!editOpen) { setConfirmingRemove(false); setDeleteCountdown(null) } }, [editOpen ])
  useEffect(() => {
    if (deleteCountdown == null) return
    if (deleteCountdown === 0) {
      setDeleteCountdown(null)
      void removeRef.current()
      return
    }
    const timer = window.setTimeout(() => setDeleteCountdown(deleteCountdown - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [deleteCountdown ])
  useEffect(() => {
    if (!confirmingRemove) return
    setDeleteGrown(false)
    const grow = window.setTimeout(() => setDeleteGrown(true), 30)
    return () => window.clearTimeout(grow)
  }, [confirmingRemove ])

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

  const page = filtered.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

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

  async function removePosition(id: number | null | undefined) {
    if (id == null) return
    try {
      await apiRequest(`/concerns/admin/positions/${id}/`, { method: "DELETE" })
      await refreshUser()
      toast.success("Position removed")
      setEditOpen(false); setDraft(null); setOriginalDraft(null); load()
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
  function openNew() {
    setDraft({ name: "", code: "", permissions: [] })
    setOriginalDraft(null)
    setEditOpen(true)
  }

  useEffect(() => {
    if (!embedded) return
    window.addEventListener("configuration-primary-action", openNew)
    return () => window.removeEventListener("configuration-primary-action", openNew)
  }, [embedded, openNew])

  return (
    <ConfigShell
      embedded={embedded}
      hideEmbeddedAction={embedded}
      icon={ShieldCheckIcon}
      eyebrow="User management"
      title="Permissions"
      description="What each position is allowed to do. Give someone a position in Users, and they get everything ticked here."
      stats={[
        { label: "Positions", value: activePositions.length },
        { label: "Without permissions", value: activePositions.filter((p) => p.permissions.length === 0).length, alarm: activePositions.some((p) => p.permissions.length === 0) },
      ]}
      action={
        <ConfigHeroAction icon={PlusIcon} onClick={openNew}>
          New position
        </ConfigHeroAction>
      }
    >
      <div className="space-y-4">
      <ConfigurationListToolbar
        search={query}
        onSearch={(value) => { setQuery(value); setOffset(0) }}
        placeholder="Search positions or units"
        filters={[
          { key: "all", label: "All", count: unitCounts.all },
          ...unitsWithPositions.map((unit) => ({ key: String(unit.id), label: unit.short_name || unit.name, count: unitCounts[String(unit.id)] })),
          { key: "__add", label: "Add a position" },
        ]}
        activeFilter={unitKey}
        onFilter={(value) => { if (value === "__add") { openNew(); return } setUnitKey(value); setOffset(0) }}
      />

      <div>
      <ConfigurationTable label="Permissions" hideHeader>
        {page.map((position) => {
          const unitName = position.department ? departments.find((d) => d.id === position.department)?.name ?? "Unit" : null
          const countText = position.permissions.length === 0 ? "No permissions assigned" : `(${position.permissions.length} permission${position.permissions.length === 1 ? "" : "s"})`
          return (
          <ConfigurationTableRow
            key={position.id}
            actions={<SheetIconButton label={`Edit ${position.name}`} onClick={() => { setDraft(position); setOriginalDraft(positionSnapshot(position)); setEditOpen(true) }} className="mr-1 size-8 text-neutral-400 hover:text-neutral-700">
              <PencilIcon className="size-5" strokeWidth={1.9} aria-hidden />
            </SheetIconButton>}
          >
            <div className="min-w-0 flex-1">
              <p className="break-words text-[15px] leading-snug font-bold text-neutral-900">
                {position.name}
              </p>
              <p className="mt-1 text-[13px] text-neutral-500">
                {unitName ? <span className="text-neutral-400">{unitName}</span> : null}
                {unitName ? " " : null}
                {countText}
              </p>
            </div>
          </ConfigurationTableRow>
          )
        })}
        {page.length === 0 && !loading ? <ConfigurationTableEmpty>No positions found.</ConfigurationTableEmpty> : null}
      </ConfigurationTable>

      <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="positions" className="py-1" inline />
      </div>
      </div>

      {/* Edit dialog */}
      {draft && (
        <SheetDialog
          open={editOpen}
          onClose={() => { setEditOpen(false); setDraft(null); setOriginalDraft(null) }}
          onBack={() => { setEditOpen(false); setDraft(null); setOriginalDraft(null) }}
          showClose={false}
          titleClassName="text-center"
          title={<span className="inline-flex items-center gap-2"><ShieldCheckIcon className="size-6" strokeWidth={2} aria-hidden />Position<span className="text-brand-orange">Details</span></span>}
          size="wide"
          footer={
            <div key={confirmingRemove ? "confirm" : "edit"} className="motion-safe:animate-slide-in-right">
            {confirmingRemove ? (
              <div className="flex items-center gap-2">
                <SheetSecondaryButton className="h-11 w-auto flex-none px-6 text-[15px]" onClick={() => { setDeleteCountdown(null); setConfirmingRemove(false) }}>No</SheetSecondaryButton>
                <SheetPrimaryButton tone="danger" onClick={() => { if (deleteCountdown != null) setDeleteCountdown(null); else setDeleteCountdown(3) }} className={`h-11 min-w-0 flex-1 gap-2 overflow-hidden whitespace-nowrap text-[15px] transition-[max-width] duration-500 ease-out ${deleteGrown ? "max-w-[999px]" : "max-w-11 px-0"}`}>
                  <Trash2Icon className="size-5 shrink-0" strokeWidth={2} aria-hidden />
                  <span className={`overflow-hidden tabular-nums transition-[max-width,opacity] delay-150 duration-300 ${deleteGrown ? "max-w-32 opacity-100" : "max-w-0 opacity-0"}`}>
                    {deleteCountdown != null ? `Cancel ${deleteCountdown}s` : "Delete"}
                  </span>
                </SheetPrimaryButton>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <SheetPrimaryButton
                  tone="accent"
                  disabled={saving || !draft.name || Boolean(draft.id && positionSnapshot(draft) === originalDraft)}
                  onClick={() => void save()}
                  className="h-11 min-w-0 flex-1 text-[15px]"
                >
                  {saving ? "Saving…" : draft.id ? "Save changes" : "Create position"}
                </SheetPrimaryButton>
                {draft.id ? (
                  <SheetPrimaryButton tone="danger" aria-label="Remove position" onClick={() => setConfirmingRemove(true)} disabled={saving} className="h-11 w-11 flex-none px-0 text-[15px]">
                    <Trash2Icon className="size-5" strokeWidth={2} aria-hidden />
                  </SheetPrimaryButton>
                ) : (
                  <SheetSecondaryButton disabled={saving} onClick={() => { setEditOpen(false); setDraft(null) }} className="h-11 w-auto flex-none px-6 text-[15px]">Cancel</SheetSecondaryButton>
                )}
              </div>
            )}
            </div>
          }
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

        </SheetDialog>
      )}

    </ConfigShell>
  )
}
