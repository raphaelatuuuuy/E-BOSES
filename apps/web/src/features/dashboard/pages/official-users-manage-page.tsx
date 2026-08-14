import { useCallback, useEffect, useMemo, useState } from "react"
import { UserCogIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { DataTable, type Column } from "@/features/dashboard/components/record/data-table"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ConfigShell } from "@/features/dashboard/components/config/config-shell"

/**
 * A `<select>` hands back a plain string, which does not narrow to the role
 * union on its own. Validating against the known set rather than asserting the
 * type means a stray option value can never be written into state and sent to
 * the role-change endpoint — which, on this screen, decides what someone is
 * allowed to do in the barangay.
 */
type ManagedRole = "resident" | "barangay_official" | "first_responder"

const MANAGED_ROLES: readonly string[] = ["resident", "barangay_official", "first_responder"]

function toManagedRole(value: string, fallback: ManagedRole): ManagedRole {
  return MANAGED_ROLES.includes(value) ? (value as ManagedRole) : fallback
}

/**
 * User management.
 *
 * The old screen could not edit or add users, and there was nowhere to place
 * someone in a unit. That placement is a `Designation` (user + department +
 * position), and it is what actually grants capabilities — so this screen is
 * where role-based access stops being theoretical.
 */

interface Unit {
  id: number
  code: string
  name: string
  short_name: string
  position: string
  position_code: string
}

interface StaffUser {
  id: number
  email: string
  phone_number: string
  role: "resident" | "barangay_official" | "first_responder"
  status: string
  full_name?: string
  responder_unit?: string
  units?: Unit[]
  last_seen_at?: string | null
}

interface Department {
  id: number
  name: string
  short_name: string
  is_active: boolean
}

interface Position {
  id: number
  name: string
  is_active: boolean
}

interface Designation {
  id: number
  user: number
  department: number
  position: number
  is_active: boolean
  department_detail?: { id: number; name: string; short_name: string }
  position_detail?: { id: number; name: string }
}

const ROLE_LABEL: Record<string, string> = {
  resident: "Resident",
  barangay_official: "Official",
  first_responder: "Responder",
}

const STATUS_TONE: Record<string, string> = {
  verified: "bg-status-closed-surface text-status-closed-ink",
  pending_verification: "bg-status-open-surface text-status-open-ink",
  suspended: "bg-severity-critical-surface text-severity-critical-ink",
  rejected: "bg-severity-critical-surface text-severity-critical-ink",
}

function UserDrawer({
  user,
  departments,
  positions,
  onClose,
  onChanged,
}: {
  user: StaffUser
  departments: Department[]
  positions: Position[]
  onClose: () => void
  onChanged: () => void
}) {
  const [role, setRole] = useState(user.role)
  const [accountStatus, setAccountStatus] = useState(user.status)
  const [responderUnit, setResponderUnit] = useState(user.responder_unit ?? "")
  const dirty =
    role !== user.role ||
    accountStatus !== user.status ||
    responderUnit !== (user.responder_unit ?? "")
  const [designations, setDesignations] = useState<Designation[]>([])
  const [loading, setLoading] = useState(true)
  const [departmentId, setDepartmentId] = useState("")
  const [positionId, setPositionId] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    apiRequest<Designation[]>("/concerns/admin/designations/")
      .then((all) => setDesignations(all.filter((item) => item.user === user.id && item.is_active)))
      .catch((error) => toast.error(describeApiError(error, "Could not load this person's units.")))
      .finally(() => setLoading(false))
  }, [user.id])

  useEffect(() => {
    void load()
  }, [load])

  async function saveAccount() {
    setBusy(true)
    try {
      await apiRequest(`/auth/staff/${user.id}/`, {
        method: "PATCH",
        body: JSON.stringify({
          role,
          status: accountStatus,
          ...(role === "first_responder" ? { responder_unit: responderUnit } : {}),
        }),
      })
      toast.success("Account updated")
      onChanged()
    } catch (error) {
      toast.error(describeApiError(error, "Could not update this account."))
    } finally {
      setBusy(false)
    }
  }

  async function addDesignation() {
    if (!departmentId || !positionId) return
    setBusy(true)
    try {
      await apiRequest("/concerns/admin/designations/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: user.id,
          department: Number(departmentId),
          position: Number(positionId),
        }),
      })
      toast.success("Assigned")
      setDepartmentId("")
      setPositionId("")
      load()
      onChanged()
    } catch (error) {
      toast.error(describeApiError(error, "Could not assign this unit."))
    } finally {
      setBusy(false)
    }
  }

  async function removeDesignation(id: number) {
    setBusy(true)
    try {
      await apiRequest(`/concerns/admin/designations/${id}/`, { method: "DELETE" })
      toast.success("Removed")
      load()
      onChanged()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove this assignment."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-brand-navy/40"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${user.full_name || user.email} details`}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-canvas p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-bold text-foreground">
              {user.full_name || user.email}
            </h2>
            <p className="truncate text-sm font-medium text-muted-foreground">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-tint"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-2xl border border-card-line bg-card p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">Role</span>
              <select
                value={role}
                onChange={(event) => setRole(toManagedRole(event.target.value, role))}
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-brand-orange disabled:opacity-60"
              >
                <option value="resident">Resident</option>
                <option value="first_responder">Responder</option>
                <option value="barangay_official">Official</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">Status</span>
              <select
                value={accountStatus}
                onChange={(event) => setAccountStatus(event.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-brand-orange disabled:opacity-60"
              >
                <option value="verified">Verified</option>
                <option value="pending_verification">Pending verification</option>
                <option value="suspended">Suspended</option>
                <option value="rejected">Rejected</option>
              </select>
            </label>
          </div>

          {/* A responder with no unit is invisible to dispatch, so the unit is
              required as soon as the role becomes responder. */}
          {role === "first_responder" ? (
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">
                Responder unit
              </span>
              <select
                value={responderUnit}
                onChange={(event) => setResponderUnit(event.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-semibold text-foreground outline-none focus:border-brand-orange disabled:opacity-60"
              >
                <option value="">Choose a unit</option>
                <option value="tanod">Tanod</option>
                <option value="bhw">BHW</option>
                <option value="bdrrmo">BDRRMO</option>
              </select>
            </label>
          ) : null}

          {dirty ? (
            <button
              type="button"
              onClick={() => void saveAccount()}
              disabled={busy || (role === "first_responder" && !responderUnit)}
              className="w-full rounded-xl bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:opacity-55"
            >
              {busy ? "Saving…" : "Save role & status"}
            </button>
          ) : null}

          <p className="text-xs font-medium text-muted-foreground">
            {user.phone_number || "No phone number on file"}
          </p>
        </div>

        <section className="mt-5">
          <h3 className="text-[11px] font-bold tracking-wide text-muted-foreground">
            Units and positions
          </h3>
          {/* This is the part that matters: capabilities come from the position
              held here, and emergency dispatch finds responders through it. */}
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            The position held here decides what this person can do. For responders, it also
            decides which emergencies they are dispatched to.
          </p>

          <div className="mt-3 space-y-2">
            {loading ? (
              <span className="block h-10 animate-pulse rounded-xl bg-chart-track" />
            ) : designations.length === 0 ? (
              <p className="rounded-xl border border-card-line bg-card px-3 py-2.5 text-sm font-medium text-muted-foreground">
                Not assigned to any unit yet.
              </p>
            ) : (
              designations.map((designation) => (
                <div
                  key={designation.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-card-line bg-card px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">
                      {designation.department_detail?.name ?? "Unit"}
                    </p>
                    <p className="truncate text-xs font-medium text-muted-foreground">
                      {designation.position_detail?.name ?? "Position"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeDesignation(designation.id)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-severity-critical-ink transition hover:bg-severity-critical-surface disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 space-y-2 rounded-xl border border-card-line bg-card p-3">
            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">Unit</span>
              <select
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
              >
                <option value="">Select a unit</option>
                {departments
                  .filter((department) => department.is_active)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-bold text-muted-foreground">
                Position
              </span>
              <select
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-card-line bg-card px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-brand-orange"
              >
                <option value="">Select a position</option>
                {positions
                  .filter((position) => position.is_active)
                  .map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
              </select>
            </label>

            <button
              type="button"
              disabled={busy || !departmentId || !positionId}
              onClick={() => void addDesignation()}
              className="w-full rounded-xl bg-brand-orange px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:opacity-55"
            >
              Assign unit
            </button>
          </div>
        </section>
      </aside>
    </div>
  )
}

export default function OfficialUsersManagePage() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [roleFilter, setRoleFilter] = useState("all")
  const [selected, setSelected] = useState<StaffUser | null>(null)

  const load = useCallback(() => {
    Promise.all([
      apiRequest<StaffUser[]>("/auth/staff/"),
      apiRequest<Department[]>("/concerns/admin/departments/"),
      apiRequest<Position[]>("/concerns/admin/positions/"),
    ])
      .then(([staff, deps, pos]) => {
        setUsers(staff)
        setDepartments(deps)
        setPositions(pos)
      })
      .catch((error) => toast.error(describeApiError(error, "Could not load users.")))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (roleFilter === "all" ? users : users.filter((user) => user.role === roleFilter)),
    [users, roleFilter],
  )

  const columns: Column<StaffUser>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (user) => (user.full_name || user.email).toLowerCase(),
      render: (user) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">{user.full_name || "—"}</p>
          <p className="truncate text-xs font-medium text-muted-foreground">{user.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      sortValue: (user) => user.role,
      render: (user) => (
        <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-brand-navy">
          {ROLE_LABEL[user.role] ?? user.role}
        </span>
      ),
    },
    {
      key: "units",
      header: "Units",
      hideOnMobile: true,
      render: (user) =>
        user.units && user.units.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {user.units.map((unit) => (
              <span
                key={unit.id}
                className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-bold text-brand-navy"
                title={`${unit.name} — ${unit.position}`}
              >
                {unit.short_name || unit.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs font-medium italic text-muted-foreground">Unassigned</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      hideOnMobile: true,
      sortValue: (user) => user.status,
      render: (user) => (
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
            STATUS_TONE[user.status] ?? "bg-tint text-brand-navy"
          }`}
        >
          {user.status.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (user) => (
        <button
          type="button"
          onClick={() => setSelected(user)}
          className="rounded-lg px-2 py-1 text-xs font-bold text-brand-navy transition hover:bg-tint"
        >
          Manage
        </button>
      ),
    },
  ]

  const unassignedStaff = users.filter(
    (user) => user.role !== "resident" && (user.units?.length ?? 0) === 0,
  ).length

  return (
    <ConfigShell
      icon={UserCogIcon}
      eyebrow="People & access"
      title="Users"
      description="Accounts, roles and unit assignments. A person's position in a unit is what grants their permissions — and for responders, what puts them in dispatch."
      stats={[
        { label: "Accounts", value: users.length },
        { label: "Officials", value: users.filter((u) => u.role === "barangay_official").length },
        { label: "Responders", value: users.filter((u) => u.role === "first_responder").length },
        { label: "Staff unplaced", value: unassignedStaff, alarm: unassignedStaff > 0 },
      ]}
    >
      <DataTable
        rows={visible}
        columns={columns}
        rowKey={(user) => String(user.id)}
        loading={loading}
        searchPlaceholder="Search by name, email or phone"
        searchMatches={(user, query) =>
          `${user.full_name ?? ""} ${user.email} ${user.phone_number}`.toLowerCase().includes(query)
        }
        filters={[
          { key: "all", label: "All", count: users.length },
          {
            key: "barangay_official",
            label: "Officials",
            count: users.filter((user) => user.role === "barangay_official").length,
          },
          {
            key: "first_responder",
            label: "Responders",
            count: users.filter((user) => user.role === "first_responder").length,
          },
          {
            key: "resident",
            label: "Residents",
            count: users.filter((user) => user.role === "resident").length,
          },
        ]}
        activeFilter={roleFilter}
        onFilterChange={setRoleFilter}
        onRowSelect={setSelected}
        emptyTitle="No accounts match"
        emptyHint="Try a different search or filter."
      />

      {selected ? (
        <UserDrawer
          user={selected}
          departments={departments}
          positions={positions}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      ) : null}
    </ConfigShell>
  )
}
