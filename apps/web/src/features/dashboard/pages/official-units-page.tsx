import { useCallback, useEffect, useState } from "react"
import { PlusIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { DataTable, type Column } from "@/features/dashboard/components/record/data-table"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import { listEmergencyCategories, type EmergencyCategory } from "@/features/dashboard/emergency-api"

/**
 * Unit management.
 *
 * This is the screen that makes `Department` genuinely the barangay's unit
 * registry. Turning on "Responds to emergencies" and picking types here is what
 * causes SOS alerts to reach the unit — before the unit unification, emergency
 * dispatch read a closed enum and a unit created here could never be routed to.
 */

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

type Draft = Partial<Unit> & { name?: string; code?: string }

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function UnitEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  emergencyCategories,
}: {
  draft: Draft
  onChange: (next: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  emergencyCategories: EmergencyCategory[]
}) {
  const isNew = !draft.id
  const responds = Boolean(draft.responds_to_emergencies)
  const types = draft.emergency_types ?? []

  return (
    <div className="space-y-4 rounded-2xl border border-card-line bg-card p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-bold text-muted-foreground">
            Unit name
          </span>
          <input
            value={draft.name ?? ""}
            onChange={(event) => {
              const name = event.target.value
              // Only auto-fill the code for new units: changing an existing
              // code would orphan routing rules that point at it.
              onChange(isNew ? { ...draft, name, code: slugify(name) } : { ...draft, name })
            }}
            className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
            placeholder="Barangay Health Workers"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-bold text-muted-foreground">
            Short name
          </span>
          <input
            value={draft.short_name ?? ""}
            onChange={(event) => onChange({ ...draft, short_name: event.target.value })}
            className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
            placeholder="BHW"
          />
          <span className="mt-1 block text-[11px] font-medium text-muted-foreground">
            Used in tables and map pins, where the full name will not fit.
          </span>
        </label>
      </div>

      <label className="block">
        <span className="text-[11px] font-bold text-muted-foreground">
          What this unit handles
        </span>
        <input
          value={draft.description ?? ""}
          onChange={(event) => onChange({ ...draft, description: event.target.value })}
          className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
          placeholder="Health concerns, medical assistance, vaccinations"
        />
      </label>

      <div className="rounded-2xl border border-brand-orange/15 bg-gradient-to-br from-brand-orange-soft to-tint p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={responds}
            onChange={(event) =>
              onChange({ ...draft, responds_to_emergencies: event.target.checked })
            }
            className="mt-1 size-4 accent-brand-orange"
          />
          <span>
            <span className="block text-sm font-bold text-foreground">
              Responds to emergencies
            </span>
            <span className="block text-xs font-medium text-muted-foreground">
              On-duty members of this unit can be dispatched to the configured emergency categories below.
            </span>
          </span>
        </label>

        {responds ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {emergencyCategories.filter((category) => category.is_active).map((category) => {
              const active = types.includes(category.code)
              return (
                <button
                  key={category.code}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChange({
                      ...draft,
                      emergency_types: active
                        ? types.filter((item) => item !== category.code)
                        : [...types, category.code],
                    })
                  }
                  className={
                    active
                      ? "rounded-2xl border border-brand-orange bg-brand-orange-soft px-3 py-2 text-left text-xs font-bold text-brand-navy"
                      : "rounded-2xl border border-card-line bg-white/70 px-3 py-2 text-left text-xs font-semibold text-foreground transition hover:border-brand-orange/40"
                  }
                >
                  <span className="block">{category.label}</span>
                  <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">{category.subtext || category.code}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {responds && types.length === 0 ? (
          <p className="mt-2 text-xs font-semibold text-status-open-ink">
            Pick at least one type, or this unit will never be dispatched to.
          </p>
        ) : null}
      </div>

      <label className="block sm:max-w-xs">
        <span className="text-[11px] font-bold text-muted-foreground">
          Contact number
        </span>
        <input
          value={draft.contact_number ?? ""}
          onChange={(event) => onChange({ ...draft, contact_number: event.target.value })}
          className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
          placeholder="+639XXXXXXXXX"
        />
        <span className="mt-1 block text-[11px] font-medium text-muted-foreground">
          Used for escalation.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !draft.name || (responds && (draft.emergency_types ?? []).length === 0)}
          className="rounded-xl bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:opacity-55"
        >
          {saving ? "Saving…" : isNew ? "Create unit" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-xl border border-card-line bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-tint"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function OfficialUnitsPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [emergencyCategories, setEmergencyCategories] = useState<EmergencyCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState("all")

  const load = useCallback(() => {
    Promise.all([apiRequest<Unit[]>("/concerns/admin/departments/"), listEmergencyCategories()])
      .then(([nextUnits, nextCategories]) => {
        setUnits(nextUnits)
        setEmergencyCategories(nextCategories)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load units.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!draft) return
    setSaving(true)
    try {
      const isNew = !draft.id
      await apiRequest<Unit>(
        isNew ? "/concerns/admin/departments/" : `/concerns/admin/departments/${draft.id}/`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      )
      toast.success(isNew ? "Unit created" : "Unit updated")
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the unit."))
    } finally {
      setSaving(false)
    }
  }

  async function removeUnit(unit: Unit) {
    // The API refuses to hard-delete a unit that still owns concerns and
    // deactivates it instead, so the confirmation says which will happen and
    // the toast reports what actually did.
    const willDeactivate = unit.member_count > 0
    const confirmed = window.confirm(
      willDeactivate
        ? `${unit.name} still has ${unit.member_count} member${unit.member_count === 1 ? "" : "s"}. ` +
            "It will be deactivated and kept for history rather than deleted. Continue?"
        : `Delete ${unit.name}? This cannot be undone.`,
    )
    if (!confirmed) return

    try {
      const result = await apiRequest<{ deleted: boolean; deactivated: boolean; in_use: number }>(
        `/concerns/admin/departments/${unit.id}/`,
        { method: "DELETE" },
      )
      toast.success(
        result.deleted
          ? "Unit deleted"
          : `Unit deactivated — still referenced by ${result.in_use} record${result.in_use === 1 ? "" : "s"}`,
      )
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove the unit."))
    }
  }

  async function toggleActive(unit: Unit) {
    try {
      await apiRequest(`/concerns/admin/departments/${unit.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !unit.is_active }),
      })
      toast.success(unit.is_active ? "Unit deactivated" : "Unit reactivated")
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not update the unit."))
    }
  }

  const visible =
    filter === "emergency"
      ? units.filter((unit) => unit.responds_to_emergencies)
      : filter === "inactive"
        ? units.filter((unit) => !unit.is_active)
        : units.filter((unit) => unit.is_active)

  const emergencyCategoryLabel = (code: string) => emergencyCategories.find((category) => category.code === code)?.label ?? code

  const columns: Column<Unit>[] = [
    {
      key: "name",
      header: "Unit",
      sortValue: (unit) => unit.name.toLowerCase(),
      render: (unit) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{unit.name}</p>
          <p className="truncate text-xs font-medium text-muted-foreground">
            {unit.description || unit.code}
          </p>
        </div>
      ),
    },
    {
      key: "members",
      header: "Members",
      hideOnMobile: true,
      sortValue: (unit) => unit.member_count,
      render: (unit) => <span className="tabular-nums">{unit.member_count}</span>,
    },
    {
      key: "emergency",
      header: "Emergency response",
      hideOnMobile: true,
      render: (unit) =>
        unit.responds_to_emergencies ? (
          <div className="flex flex-wrap gap-1">
            {unit.emergency_types.map((type) => (
              <span
                key={type}
                className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold capitalize text-brand-navy"
              >
                {emergencyCategoryLabel(type)}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">Not an emergency unit</span>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (unit) => (
        <span className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => setDraft(unit)}
            className="rounded-lg px-2 py-1 text-xs font-bold text-brand-navy transition hover:bg-tint"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => void toggleActive(unit)}
            className="rounded-lg px-2 py-1 text-xs font-bold text-muted-foreground transition hover:bg-tint"
          >
            {unit.is_active ? "Deactivate" : "Reactivate"}
          </button>
          <button
            type="button"
            onClick={() => void removeUnit(unit)}
            className="rounded-lg px-2 py-1 text-xs font-bold text-severity-critical-ink transition hover:bg-severity-critical-surface"
          >
            Delete
          </button>
        </span>
      ),
    },
  ]

  const respondingCount = units.filter(
    (unit) => unit.is_active && unit.responds_to_emergencies,
  ).length

  return (
    <ConfigShell
      icon={UsersIcon}
      eyebrow="People & access"
      title="Units"
      description="Barangay units, desks and committees. A unit marked as an emergency responder receives SOS alerts for the types you choose."
      stats={[
        { label: "Active units", value: units.filter((unit) => unit.is_active).length },
        { label: "Answer emergencies", value: respondingCount, alarm: respondingCount === 0 },
        { label: "Members placed", value: units.reduce((total, unit) => total + unit.member_count, 0) },
        { label: "Inactive", value: units.filter((unit) => !unit.is_active).length },
      ]}
      action={
        !draft ? (
          <ConfigHeroAction
            icon={PlusIcon}
            onClick={() => setDraft({ name: "", code: "", emergency_types: [] })}
          >
            New unit
          </ConfigHeroAction>
        ) : null
      }
    >
      {!loading && respondingCount === 0 ? (
        <ConfigAlarm>
          No unit answers emergencies yet. Until one does, an SOS cannot be routed to anyone
          automatically — open a unit and turn on “Responds to emergencies”.
        </ConfigAlarm>
      ) : null}

      {draft ? (
        <UnitEditor
          draft={draft}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
          saving={saving}
          emergencyCategories={emergencyCategories}
        />
      ) : null}

      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(unit) => String(unit.id)}
        loading={loading}
        searchPlaceholder="Search units"
        searchMatches={(unit, query) =>
          `${unit.name} ${unit.short_name} ${unit.code} ${unit.description}`
            .toLowerCase()
            .includes(query)
        }
        filters={[
          { key: "all", label: "Active", count: units.filter((u) => u.is_active).length },
          {
            key: "emergency",
            label: "Emergency responders",
            count: units.filter((u) => u.responds_to_emergencies).length,
          },
          { key: "inactive", label: "Inactive", count: units.filter((u) => !u.is_active).length },
        ]}
        activeFilter={filter}
        onFilterChange={setFilter}
        emptyTitle="No units here"
        emptyHint={
          filter === "all"
            ? "Use “New unit” above to create one, then route concerns and emergencies to it."
            : "Nothing matches this filter."
        }
      />
    </ConfigShell>
  )
}