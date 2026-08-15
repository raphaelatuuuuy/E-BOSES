import { useCallback, useEffect, useState } from "react"
import { PlusIcon, ShieldCheckIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { DataTable, type Column } from "@/features/dashboard/components/record/data-table"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { CAPABILITY_LABEL } from "@/features/dashboard/lib/capabilities"
import {
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"

/**
 * Role management.
 *
 * `Position.permissions` existed in the schema and went unread, so every staff
 * member carried the same flat `barangay_official` role — a Secretary and the
 * Barangay Captain held identical power. This screen is where that becomes
 * real.
 *
 * The capability vocabulary is fixed, not user-definable: officials configure
 * who holds which position, never which capabilities exist. Letting them invent
 * capabilities would produce another surface nobody can reason about.
 */

interface Position {
  id: number
  name: string
  code: string
  permissions: string[]
  is_active: boolean
}

type Draft = Partial<Position>

const GROUPS: { title: string; capabilities: string[] }[] = [
  { title: "People & access", capabilities: ["manage_units", "manage_roles", "manage_users"] },
  {
    title: "Reports",
    capabilities: ["manage_categories", "configure_classification", "resolve_concerns"],
  },
  {
    title: "Emergency response",
    capabilities: ["configure_dispatch", "configure_geography", "dispatch_emergencies"],
  },
  {
    title: "Trust & community",
    capabilities: ["review_verification", "handle_privacy", "publish_announcements"],
  },
]

const CAPABILITY_HINT: Record<string, string> = {
  manage_units: "Create, edit and deactivate barangay units",
  manage_roles: "Change which capabilities each position holds",
  manage_users: "Create accounts, assign units and positions, deactivate",
  review_verification: "Approve or reject resident ID and residence proof",
  handle_privacy: "Action data export and deletion requests",
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

function RoleEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft
  onChange: (next: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const isNew = !draft.id
  const held = draft.permissions ?? []

  function toggle(capability: string) {
    onChange({
      ...draft,
      permissions: held.includes(capability)
        ? held.filter((item) => item !== capability)
        : [...held, capability],
    })
  }

  return (
    <div className="space-y-4 rounded-2xl border border-card-line bg-card p-4">
      <label className="block sm:max-w-sm">
        <span className="text-[11px] font-bold text-muted-foreground">
          Position name
        </span>
        <input
          value={draft.name ?? ""}
          onChange={(event) => {
            const name = event.target.value
            onChange(isNew ? { ...draft, name, code: slugify(name) } : { ...draft, name })
          }}
          className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-accent"
          placeholder="Barangay Secretary"
        />
      </label>

      <div className="space-y-4">
        {GROUPS.map((group) => (
          <fieldset key={group.title}>
            <legend className="text-[11px] font-bold text-muted-foreground">
              {group.title}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.capabilities.map((capability) => (
                <label
                  key={capability}
                  className="flex items-start gap-3 rounded-xl border border-card-line bg-canvas p-3"
                >
                  <input
                    type="checkbox"
                    checked={held.includes(capability)}
                    onChange={() => toggle(capability)}
                    className="mt-0.5 size-4 accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {CAPABILITY_LABEL[capability] ?? capability}
                    </span>
                    {/* Plain language, so granting a capability is an informed
                        act rather than ticking an opaque code. */}
                    <span className="block text-xs font-medium text-muted-foreground">
                      {CAPABILITY_HINT[capability]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !draft.name}
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {saving ? "Saving…" : isNew ? "Create position" : "Save changes"}
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

export default function OfficialRolesPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    apiRequest<Position[]>("/concerns/admin/positions/")
      .then(setPositions)
      .catch((error) => toast.error(describeApiError(error, "Could not load positions.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Guard against removing the last holder of manage_roles: doing so would
  // leave nobody able to grant it back.
  function wouldOrphanRoleManagement(next: Draft) {
    if (!next.id) return false
    const stillHasIt = (next.permissions ?? []).includes("manage_roles")
    if (stillHasIt) return false
    const otherHolders = positions.filter(
      (position) =>
        position.id !== next.id && position.is_active && position.permissions.includes("manage_roles"),
    )
    return otherHolders.length === 0
  }

  async function save() {
    if (!draft) return
    if (wouldOrphanRoleManagement(draft)) {
      toast.error(
        "This is the last position that can manage roles. Grant it to another position first.",
      )
      return
    }

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
      toast.success(isNew ? "Position created" : "Position updated")
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save the position."))
    } finally {
      setSaving(false)
    }
  }

  const columns: Column<Position>[] = [
    {
      key: "name",
      header: "Position",
      sortValue: (position) => position.name.toLowerCase(),
      render: (position) => (
        <p className="font-semibold text-foreground">{position.name}</p>
      ),
    },
    {
      key: "capabilities",
      header: "Can do",
      render: (position) =>
        position.permissions.length === 0 ? (
          <span className="text-xs font-semibold italic text-neutral-600">
            No capabilities — cannot do anything
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {position.permissions.slice(0, 4).map((capability) => (
              <span
                key={capability}
                className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-brand-navy"
              >
                {CAPABILITY_LABEL[capability] ?? capability}
              </span>
            ))}
            {position.permissions.length > 4 ? (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                +{position.permissions.length - 4} more
              </span>
            ) : null}
          </div>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (position) => (
        <button
          type="button"
          onClick={() => setDraft(position)}
          className="rounded-lg px-2 py-1 text-xs font-bold text-brand-navy transition hover:bg-tint"
        >
          Edit
        </button>
      ),
    },
  ]

  const active = positions.filter((position) => position.is_active)

  return (
    <ConfigShell
      icon={ShieldCheckIcon}
      eyebrow="People & access"
      title="Permissions"
      description="What each position is allowed to do. Give someone a position in Users, and they get everything ticked here."
      stats={[
        { label: "Positions", value: active.length },
        {
          label: "Without permissions",
          value: active.filter((position) => position.permissions.length === 0).length,
          alarm: active.some((position) => position.permissions.length === 0),
        },
      ]}
      action={
        !draft ? (
          <ConfigHeroAction
            icon={PlusIcon}
            onClick={() => setDraft({ name: "", code: "", permissions: [] })}
          >
            New position
          </ConfigHeroAction>
        ) : null
      }
    >
      {draft ? (
        <RoleEditor
          draft={draft}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
          saving={saving}
        />
      ) : null}

      <DataTable
        rows={positions.filter((position) => position.is_active)}
        columns={columns}
        rowKey={(position) => String(position.id)}
        loading={loading}
        searchPlaceholder="Search positions"
        searchMatches={(position, query) => position.name.toLowerCase().includes(query)}
        emptyTitle="No positions yet"
        emptyHint="Create a position, then assign it to people in Users."
      />
    </ConfigShell>
  )
}
