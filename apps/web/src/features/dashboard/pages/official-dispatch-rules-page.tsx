import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  CircleCheck,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SirenIcon,
  CircleX,
} from "lucide-react"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { toast } from "sonner"

import { apiRequest, unwrapList, type ListEnvelope } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import {
  SheetDialog,
  SheetPrimaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import type { EmergencyCategory } from "@/features/dashboard/emergency-api"



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
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
}

function iconFor(key: string) {
  return resolveIconByKey(key) ?? SirenIcon
}

const inputCls =
  "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
const labelCls = "text-[13px] font-semibold text-neutral-500"

/* Custom dropdown that shows icons — native <select> can't render React elements */
function IconDropdown({
  value,
  onChange,
  onPickCustom,
}: {
  value: string
  onChange: (key: string) => void
  onPickCustom?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [customInput, setCustomInput] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const CurrentIcon = resolveIconByKey(value) ?? SirenIcon
  const isCustomImage = value === "custom"

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 transition-colors outline-none hover:border-neutral-400"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
          {createElement(CurrentIcon, { className: "size-4", strokeWidth: 1.7 })}
        </span>
        <span className="flex-1 truncate font-medium">{isCustomImage ? "Custom image" : value || "Siren"}</span>
        {open ? (
          <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />
        )}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: "280px", overflowY: "auto" }}
        >
          <div className="px-4 py-3">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInput.trim()) {
                  onChange(customInput.trim())
                  setCustomInput("")
                  setOpen(false)
                }
              }}
              placeholder="Type any Lucide icon name…"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />
          </div>
          <div className="border-t border-neutral-100 py-1">
            <button
              type="button"
              onClick={() => {
                onChange("custom")
                setOpen(false)
                onPickCustom?.()
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[10px] font-bold text-neutral-400">
                IMG
              </span>
              Custom image
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function OfficialDispatchRulesPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [categories, setCategories] = useState<EmergencyCategory[]>([])
  const [maps, setMaps] = useState<RoleMap[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiRequest<Unit[]>("/concerns/admin/departments/"),
      apiRequest<EmergencyCategory[]>("/emergencies/categories/"),
      apiRequest<RoleMap[] | ListEnvelope<RoleMap>>("/emergencies/role-maps/").then(unwrapList),
    ])
      .then(([nextUnits, nextCategories, nextMaps]) => {
        setUnits(nextUnits)
        setCategories(nextCategories)
        setMaps(nextMaps)
      })
      .catch((error) =>
        toast.error(describeApiError(error, "Could not load dispatch rules."))
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Defer the initial fetch one macrotask so the mount render settles first;
    // load() sets loading synchronously (reused by refresh handlers).
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  const respondingUnits = useMemo(
    () =>
      units.filter((unit) => unit.is_active && unit.responds_to_emergencies),
    [units]
  )

  function explicitRules(code: string) {
    return maps.filter(
      (item) =>
        item.emergency_type === code && item.is_active && item.department
    )
  }

  function declaringUnits(code: string) {
    return units.filter(
      (unit) =>
        unit.is_active &&
        unit.responds_to_emergencies &&
        (unit.emergency_types || []).includes(code)
    )
  }

  const uncovered = categories.filter(
    (category) =>
      category.is_active &&
      explicitRules(category.code).length === 0 &&
      declaringUnits(category.code).length === 0
  )

  async function saveCategory() {
    if (!draft?.label?.trim()) return
    setBusy("category")
    const payload = new FormData()
    payload.append("code", draft.code || slugify(draft.label))
    payload.append("label", draft.label.trim())
    payload.append("subtext", (draft.subtext || "").trim())
    payload.append("icon_key", draft.icon_key || "siren")
    payload.append("custom_icon_label", (draft.custom_icon_label || "").trim())
    payload.append(
      "sort_order",
      String(draft.sort_order ?? categories.length * 10 + 10)
    )
    payload.append("is_active", String(draft.is_active ?? true))
    payload.append("visible_to_residents", String(draft.visible_to_residents ?? true))
    if (draft.iconFile) payload.append("icon_image", draft.iconFile)
    try {
      await apiRequest(
        draft.id
          ? `/emergencies/categories/${draft.id}/`
          : "/emergencies/categories/",
        {
          method: draft.id ? "PATCH" : "POST",
          body: payload,
        }
      )
      toast.success(
        draft.id ? "Emergency category updated" : "Emergency category added"
      )
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save emergency category."))
    } finally {
      setBusy(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(deleteTarget.code)
    try {
      await apiRequest(`/emergencies/categories/${deleteTarget.id}/`, {
        method: "DELETE",
      })
      toast.success("Emergency category removed")
      setDeleteOpen(false)
      setDeleteTarget(null)
      load()
    } catch (error) {
      toast.error(
        describeApiError(error, "Could not remove emergency category.")
      )
    } finally {
      setBusy(null)
    }
  }

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EmergencyCategory | null>(
    null
  )
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)

  const draftSnapshot = (value: Draft | null) =>
    JSON.stringify({
      id: value?.id ?? null,
      label: value?.label ?? "",
      code: value?.code ?? "",
      subtext: value?.subtext ?? "",
      icon_key: value?.icon_key ?? "siren",
      custom_icon_label: value?.custom_icon_label ?? "",
      icon_image_url: value?.icon_image_url ?? "",
      is_active: value?.is_active ?? true,
      visible_to_residents: value?.visible_to_residents ?? true,
    })

  const filtered = useMemo(() => {
    if (!query) return categories
    const q = query.toLowerCase()
    return categories.filter((c) =>
      `${c.label} ${c.code} ${c.subtext}`.toLowerCase().includes(q)
    )
  }, [categories, query])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

  return (
    <ConfigShell
      icon={SirenIcon}
      eyebrow="Operations"
      title="Emergency types"
      description="The SOS buttons residents see, and which unit answers each one."
      action={
        <ConfigHeroAction
          icon={PlusIcon}
          onClick={() => {
            setDraft({ icon_key: "siren", is_active: true, visible_to_residents: true })
            setOriginalDraft(null)
            setEditOpen(true)
          }}
        >
          Add category
        </ConfigHeroAction>
      }
      stats={[
        {
          label: "Categories",
          value: categories.filter((item) => item.is_active).length,
        },
        {
          label: "Unanswered",
          value: uncovered.length,
          alarm: uncovered.length > 0,
        },
        { label: "Responding units", value: respondingUnits.length },
      ]}
    >
      {!loading && uncovered.length > 0 ? (
        <ConfigAlarm>
          No unit answers: {uncovered.map((item) => item.label).join(", ")}.
          These SOS categories will escalate instead of auto-routing.
        </ConfigAlarm>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search emergency categories"
          className="w-full"
        />
      </div>

      {/* Editorial list — same structure as proof types */}
      <ol>
        {page.map((category) => {
          const Icon = iconFor(category.icon_key)
          const covered =
            explicitRules(category.code).length > 0 ||
            declaringUnits(category.code).length > 0
          const unitNames = declaringUnits(category.code).map(
            (u) => u.short_name || u.name
          )
          const isActive = category.is_active
          return (
            <li
              key={category.id}
              className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              {/* Name + details */}
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
                    {category.icon_image_url ? (
                      <img
                        src={category.icon_image_url}
                        alt=""
                        className="size-full rounded-lg object-cover"
                      />
                    ) : (
                      <Icon className="size-4" strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="text-row text-brand-navy">
                    {category.label}
                  </span>
                  {isActive && covered ? (
                    <span className="inline-flex items-center gap-1 text-meta text-green-600">
                      <CircleCheck className="size-3.5" strokeWidth={2} />
                      Covered
                    </span>
                  ) : isActive ? (
                    <span className="inline-flex items-center gap-1 text-meta text-red-600">
                      <CircleX className="size-3.5" strokeWidth={2} />
                      No unit
                    </span>
                  ) : null}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <dt className="text-meta text-neutral-400">Description</dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">
                      {category.subtext || category.code}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-neutral-400">
                      Units assigned
                    </dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">
                      {unitNames.length > 0 ? unitNames.join(", ") : "None"}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(category)
                    setOriginalDraft(draftSnapshot(category))
                    setEditOpen(true)
                  }}
                  className="text-meta text-neutral-500 transition-colors hover:text-accent"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(category)
                    setDeleteOpen(true)
                  }}
                  className="text-meta text-neutral-500 transition-colors hover:text-sos"
                >
                  Remove
                </button>
              </div>
            </li>
          )
        })}
        {page.length === 0 && !loading ? (
          <li className="py-14 text-center text-read text-neutral-500">
            No emergency categories found.
          </li>
        ) : null}
      </ol>

      <Pager
        offset={offset}
        total={filtered.length}
        onChange={setOffset}
        noun="types"
      />

      {respondingUnits.length === 0 && !loading ? (
        <p className="rounded-2xl border border-card-line bg-card p-6 text-center text-sm font-semibold text-muted-foreground">
          No unit is marked as an emergency responder yet. Set that up in{" "}
          <Link
            to="/dashboard/configuration/units"
            className="text-brand-navy underline"
          >
            Configuration → Units
          </Link>{" "}
          first.
        </p>
      ) : null}

      {/* Edit dialog */}
      {draft && (
        <SheetDialog
          open={editOpen}
          onClose={() => {
            setEditOpen(false)
            setDraft(null)
            setOriginalDraft(null)
          }}
          title={
            draft.id ? `Edit ${draft.label} Emergency` : "New emergency type"
          }
          size="wide"
        >
          <div className="space-y-6 pb-4">
            {/* Basic info */}
            <div className="space-y-4">
              <label className="block">
                <span className={labelCls}>Category name</span>
                <input
                  value={draft.label || ""}
                  onChange={(e) => {
                    const label = e.target.value
                    setDraft((current) => ({
                      ...current,
                      label,
                      code: current?.id ? current.code : slugify(label),
                    }))
                  }}
                  className={inputCls}
                  placeholder="Fire"
                />
              </label>
              <label className="block">
                <span className={labelCls}>Description</span>
                <input
                  value={draft.subtext || ""}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      subtext: e.target.value,
                    }))
                  }
                  className={inputCls}
                  placeholder="Fire, smoke, burning"
                />
              </label>
            </div>

            {/* Icon dropdown with icons */}
            <div className="space-y-2">
              <p className={labelCls}>Icon</p>
              <IconDropdown
                value={draft.icon_key || "siren"}
                onChange={(key) =>
                  setDraft((current) => ({ ...current, icon_key: key }))
                }
                onPickCustom={() =>
                  window.setTimeout(() => fileInputRef.current?.click(), 0)
                }
              />
            </div>

            <div className="space-y-2">
              <p className={labelCls}>Alerts map</p>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    visible_to_residents: !(current?.visible_to_residents ?? true),
                  }))
                }
                className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-200 px-4 py-3 text-left transition hover:bg-neutral-50"
              >
                <span className="flex-1 text-[15px]">
                  <span className="block text-[15px] font-medium text-neutral-900">
                    Visible to residents
                  </span>
                  <span className="block text-[13px] text-neutral-500">
                    Active alerts under this type show as pins on the resident alerts map
                  </span>
                </span>
                {draft.visible_to_residents !== false ? (
                  <CircleCheck className="size-5 text-green-600" />
                ) : (
                  <span className="size-5 rounded-full border-[1.5px] border-neutral-300" />
                )}
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon"
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  iconFile: e.target.files?.[0] ?? null,
                }))
              }
              className="hidden"
            />
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={
                busy === "category" ||
                !draft.label?.trim() ||
                Boolean(draft.id && draftSnapshot(draft) === originalDraft)
              }
              onClick={() => void saveCategory()}
              className="flex h-[52px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-white transition-colors hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {busy === "category"
                ? "Saving\u2026"
                : draft.id
                  ? "Save changes"
                  : "Create category"}
            </button>
            <SheetPrimaryButton
              disabled={busy === "category"}
              onClick={() => {
                setEditOpen(false)
                setDraft(null)
              }}
            >
              Cancel
            </SheetPrimaryButton>
          </div>
        </SheetDialog>
      )}

      {/* Delete dialog */}
      <SheetDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          setDeleteTarget(null)
        }}
        title={deleteTarget ? `Remove ${deleteTarget.label}?` : ""}
        description="Alerts already filed under this category keep their history. This cannot be undone."
        footer={
          <div className="flex gap-2">
            <SheetPrimaryButton
              disabled={busy === deleteTarget?.code}
              onClick={() => {
                setDeleteOpen(false)
                setDeleteTarget(null)
              }}
              className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]"
            >
              Cancel
            </SheetPrimaryButton>
            <SheetPrimaryButton
              tone="danger"
              disabled={busy === deleteTarget?.code}
              onClick={() => void confirmDelete()}
              className="flex-1 text-[15px]"
            >
              {busy === deleteTarget?.code
                ? "Removing\u2026"
                : "Remove category"}
            </SheetPrimaryButton>
          </div>
        }
      />
    </ConfigShell>
  )
}
