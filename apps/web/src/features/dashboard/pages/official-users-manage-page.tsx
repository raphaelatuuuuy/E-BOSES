import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleCheck, CircleX, PencilIcon, TriangleAlert, UserCogIcon } from "lucide-react"
import { toast } from "sonner"

import { apiRequest } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { cn } from "@workspace/ui/lib/utils"
import { ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { SheetDialog, SheetPrimaryButton } from "@/features/dashboard/components/sheet-dialog"
import { ConfigShell } from "@/features/dashboard/components/config/config-shell"
import { useWheelScroll } from "@/hooks/use-wheel-scroll"

type ManagedRole = "resident" | "barangay_official" | "first_responder"

const MANAGED_ROLES: readonly string[] = ["resident", "barangay_official", "first_responder"]

function toManagedRole(value: string, fallback: ManagedRole): ManagedRole {
  return MANAGED_ROLES.includes(value) ? (value as ManagedRole) : fallback
}

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
  date_joined?: string
  gender?: string
  date_of_birth?: string
  member_since?: string
  address?: string
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

const STATUS_LABEL: Record<string, string> = {
  pending_otp: "Pending",
  pending_profile: "Pending",
  pending_verification: "Pending",
  verified: "Verified",
  rejected: "Rejected",
  suspended: "Suspended",
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "barangay_official", label: "Officials" },
  { key: "first_responder", label: "Responders" },
  { key: "resident", label: "Residents" },
]

function InlineDropdown({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[]
}) {
  const [, setOpen] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])
  return (
    <div ref={ref} className="mt-2 rounded-xl border border-neutral-200 bg-white shadow-lg overflow-hidden">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false) }}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-[17px] text-neutral-700 transition hover:bg-neutral-50 border-b border-neutral-100 last:border-b-0">
          <span className={o.value === value ? "font-medium text-neutral-900" : ""}>{o.label}</span>
          {o.value === value && <CircleCheck className="size-5 shrink-0 text-green-600" strokeWidth={2} />}
        </button>
      ))}
    </div>
  )
}



export default function OfficialUsersManagePage() {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [roleFilter, setRoleFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<StaffUser | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const rangeScrollRef = useWheelScroll<HTMLDivElement>()

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query])

  const filterKey = `${roleFilter}|${debounced}`
  const [prevKey, setPrevKey] = useState(filterKey)
  if (prevKey !== filterKey) { setPrevKey(filterKey); setOffset(0) }

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

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    let result = users
    if (roleFilter !== "all") result = result.filter((u) => u.role === roleFilter)
    if (debounced) {
      const q = debounced.toLowerCase()
      result = result.filter((u) => `${u.full_name ?? ""} ${u.email} ${u.phone_number}`.toLowerCase().includes(q))
    }
    return result
  }, [users, roleFilter, debounced])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

  const filterCounts = useMemo(() => ({
    all: users.length,
    barangay_official: users.filter((u) => u.role === "barangay_official").length,
    first_responder: users.filter((u) => u.role === "first_responder").length,
    resident: users.filter((u) => u.role === "resident").length,
  }), [users])

  return (
    <ConfigShell
      icon={UserCogIcon}
      eyebrow="User management"
      title="Users"
      description="Accounts, roles and unit assignments. A person's position in a unit grants their permissions."
      stats={[
        { label: "Accounts", value: users.length },
        { label: "Officials", value: filterCounts.barangay_official },
        { label: "Responders", value: filterCounts.first_responder },
        { label: "Residents", value: filterCounts.resident },
      ]}
    >
      {/* Search + filters on same line */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch value={query} onChange={setQuery} placeholder="Search by name, email or phone" className="flex-1 sm:max-w-xs" />
        <div ref={rangeScrollRef} className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setRoleFilter(f.key)}
              className={roleFilter === f.key ? "shrink-0 text-read font-medium text-brand-navy" : "shrink-0 text-read text-neutral-400 hover:text-brand-navy"}
            >
              {f.label}
              <span className="ml-1.5 tabular-nums text-neutral-400">{filterCounts[f.key as keyof typeof filterCounts]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Editorial list */}
      <ol className="mt-4">
        {page.map((user) => (
          <li
            key={user.id}
            className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[14px] font-bold text-navy-muted">
                  {(user.full_name || user.email).charAt(0).toUpperCase()}
                </span>
                <span className="text-row text-brand-navy">{user.full_name || user.email}</span>
                {user.status === "verified" ? (
                  <span className="inline-flex items-center gap-1 text-meta text-green-600">
                    <CircleCheck className="size-3.5" strokeWidth={2} />
                    Verified
                  </span>
                ) : user.status.startsWith("pending") ? (
                  <span className="inline-flex items-center gap-1 text-meta text-amber-600">
                    <TriangleAlert className="size-3.5" strokeWidth={2} />
                    {STATUS_LABEL[user.status] ?? user.status.replace(/_/g, " ")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-meta text-red-600">
                    <CircleX className="size-3.5" strokeWidth={2} />
                    {STATUS_LABEL[user.status] ?? user.status.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
              <button
                type="button"
                onClick={() => { setSelected(user); setEditOpen(true) }}
                className="text-meta text-neutral-500 transition-colors hover:text-accent"
              >
                Manage
              </button>
            </div>
          </li>
        ))}
        {page.length === 0 && !loading ? (
          <li className="py-14 text-center text-read text-neutral-500">No users found.</li>
        ) : null}
      </ol>

      <Pager offset={offset} total={filtered.length} onChange={setOffset} noun="users" />

      {/* Manage dialog */}
      {selected && (
        <UserManageDialog
          user={selected}
          departments={departments}
          positions={positions}
          open={editOpen}
          onClose={() => { setEditOpen(false); setSelected(null) }}
          onChanged={load}
        />
      )}
    </ConfigShell>
  )
}

function UserManageDialog({
  user,
  departments,
  positions,
  open,
  onClose,
  onChanged,
}: {
  user: StaffUser
  departments: Department[]
  positions: Position[]
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [role, setRole] = useState(user.role)
  const [accountStatus, setAccountStatus] = useState(user.status)
  const [designations, setDesignations] = useState<Designation[]>([])
  const [, setLoading] = useState(true)
  const [departmentId, setDepartmentId] = useState("")
  const [positionId, setPositionId] = useState("")
  const [busy, setBusy] = useState(false)

  const loadDesignations = useCallback(() => {
    apiRequest<Designation[]>("/concerns/admin/designations/")
      .then((all) => setDesignations(all.filter((d) => d.user === user.id && d.is_active)))
      .catch((error) => toast.error(describeApiError(error, "Could not load units.")))
      .finally(() => setLoading(false))
  }, [user.id])

  useEffect(() => { if (open) loadDesignations() }, [open, loadDesignations])

  const hasNewAssignment = Boolean(departmentId && positionId)
  const dirty = role !== user.role || accountStatus !== user.status || hasNewAssignment

  async function saveAccount() {
    setBusy(true)
    try {
      await apiRequest(`/auth/staff/${user.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ role, status: accountStatus }),
      })
      if (hasNewAssignment) {
        await apiRequest("/concerns/admin/designations/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: user.id, department: Number(departmentId), position: Number(positionId) }),
        })
        setDepartmentId(""); setPositionId("")
      }
      toast.success("Account updated")
      onChanged()
    } catch (error) {
      toast.error(describeApiError(error, "Could not update account."))
    } finally {
      setBusy(false)
    }
  }

  async function removeDesignation(id: number) {
    setBusy(true)
    try {
      await apiRequest(`/concerns/admin/designations/${id}/`, { method: "DELETE" })
      toast.success("Removed")
      loadDesignations(); onChanged()
    } catch (error) {
      toast.error(describeApiError(error, "Could not remove assignment."))
    } finally {
      setBusy(false)
    }
  }

  const GENDER_LABEL: Record<string, string> = { male: "Male", female: "Female", other: "Other", "" : "Not specified" }
  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null
  const registered = fmtDate(user.date_joined) ?? "—"
  const lastSeen = fmtDate(user.last_seen_at) ?? "Never"

  const hasChanges = dirty || Boolean(departmentId && positionId)

  const [editingField, setEditingField] = useState<string | null>(null)

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      title="User Details"
      size="wide"
      footer={
        <div className="space-y-3">
          <button
            type="button"
            disabled={busy || !hasChanges}
            onClick={() => void saveAccount().then(onClose)}
            className={cn(
              "flex h-[52px] w-full items-center justify-center rounded-full text-[17px] font-semibold transition-colors",
              busy || !hasChanges
                ? "cursor-not-allowed bg-neutral-200 text-neutral-400"
                : "bg-accent text-white hover:opacity-90 active:scale-[0.99]",
            )}
          >
            {busy ? "Saving\u2026" : "Save changes"}
          </button>
          <SheetPrimaryButton onClick={onClose}>Cancel</SheetPrimaryButton>
        </div>
      }
    >
      <div className="pb-4">
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-slate-soft text-navy-muted">
            <span className="text-xl font-bold">{(user.full_name || user.email)?.charAt(0)?.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-neutral-900">{user.full_name || user.email}</h3>
            <p className="text-sm text-neutral-500">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>

        {/* Account information */}
        <h4 className="text-2xl font-semibold text-neutral-900 mb-5">Account information</h4>
        <dl className="space-y-4">
          <div className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Email</dt>
            <dd className="text-neutral-900 text-[18px]">{user.email}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Phone</dt>
            <dd className="text-neutral-900 text-[18px]">{user.phone_number || "—"}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Gender</dt>
            <dd className="text-neutral-900 text-[18px]">{GENDER_LABEL[user.gender ?? ""] || user.gender || "—"}</dd>
          </div>
          {user.address && (
            <div className="flex items-center gap-3">
              <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Address</dt>
              <dd className="text-neutral-900 text-[18px]">{user.address}</dd>
            </div>
          )}
          <div className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Joined</dt>
            <dd className="text-neutral-900 text-[18px]">{registered}</dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Last seen</dt>
            <dd className="text-neutral-900 text-[18px]">{lastSeen}</dd>
          </div>

          {/* Role */}
          <div>
            <div className="flex items-center gap-3">
              <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Role</dt>
              <dd className="flex-1 flex items-center gap-2">
                <span className="text-neutral-900 text-[18px]">{ROLE_LABEL[role]}</span>
                <button type="button" onClick={() => setEditingField(editingField === "role" ? null : "role")} className="text-neutral-400 hover:text-accent">
                  <PencilIcon className="size-4" />
                </button>
              </dd>
            </div>
            {editingField === "role" && (
              <InlineDropdown value={role} onChange={(v) => { setRole(toManagedRole(v, role)); setEditingField(null) }}
                options={[{ value: "resident", label: "Resident" }, { value: "first_responder", label: "Responder" }, { value: "barangay_official", label: "Official" }]} />
            )}
          </div>

          {/* Status */}
          <div>
            <div className="flex items-center gap-3">
              <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Status</dt>
              <dd className="flex-1 flex items-center gap-2">
                <span className="text-neutral-900 text-[18px]">{STATUS_LABEL[accountStatus] ?? accountStatus}</span>
                <button type="button" onClick={() => setEditingField(editingField === "status" ? null : "status")} className="text-neutral-400 hover:text-accent">
                  <PencilIcon className="size-4" />
                </button>
              </dd>
            </div>
            {editingField === "status" && (
              <InlineDropdown value={accountStatus} onChange={(v) => { setAccountStatus(v); setEditingField(null) }}
                options={[{ value: "verified", label: "Verified" }, { value: "pending_verification", label: "Pending" }, { value: "suspended", label: "Suspended" }, { value: "rejected", label: "Rejected" }]} />
            )}
          </div>

          {/* Unit */}
          {role !== "resident" && (
            <>
              <div>
                <div className="flex items-center gap-3">
                  <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Unit</dt>
                  <dd className="flex-1 flex items-center gap-2">
                    <span className="text-neutral-900 text-[18px]">
                      {departmentId
                        ? departments.find((d) => String(d.id) === departmentId)?.name ?? "—"
                        : designations.length > 0
                          ? designations.map((d) => d.department_detail?.name ?? "Unit").join(", ")
                          : "Not assigned yet"}
                    </span>
                    <button type="button" onClick={() => setEditingField(editingField === "unit" ? null : "unit")} className="text-neutral-400 hover:text-accent">
                      <PencilIcon className="size-4" />
                    </button>
                  </dd>
                </div>
                {editingField === "unit" && (
                  <div className="mt-2">
                    <InlineDropdown value={departmentId} onChange={setDepartmentId}
                      options={departments.filter((d) => d.is_active).map((d) => ({ value: String(d.id), label: d.name }))} />
                  </div>
                )}
              </div>

              {/* Position */}
              <div>
                <div className="flex items-center gap-3">
                  <dt className="w-28 shrink-0 text-neutral-500 text-[18px]">Position</dt>
                  <dd className="flex-1 flex items-center gap-2">
                    <span className="text-neutral-900 text-[18px]">
                      {positionId
                        ? positions.find((p) => String(p.id) === positionId)?.name ?? "—"
                        : designations.length > 0
                          ? designations.map((d) => d.position_detail?.name ?? "Position").join(", ")
                          : "Not assigned yet"}
                    </span>
                    <button type="button" disabled={!departmentId && designations.length === 0} onClick={() => { if (departmentId || designations.length > 0) setEditingField(editingField === "position" ? null : "position") }} className={cn("text-neutral-400 transition-colors", (departmentId || designations.length > 0) ? "hover:text-accent" : "cursor-not-allowed opacity-40")}>
                      <PencilIcon className="size-4" />
                    </button>
                  </dd>
                </div>
                {editingField === "position" && (departmentId || designations.length > 0) && (
                  <div className="mt-2">
                    <InlineDropdown value={positionId} onChange={(v) => { setPositionId(v); setEditingField(null) }}
                      options={positions.filter((p) => p.is_active).map((p) => ({ value: String(p.id), label: p.name }))} />
                  </div>
                )}
              </div>

              {designations.length > 0 && (
                <div className="mt-2">
                  {designations.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-2 border-b border-neutral-100 last:border-b-0">
                      <span className="text-[18px] text-neutral-900">{d.department_detail?.name ?? "Unit"} · {d.position_detail?.name ?? "Position"}</span>
                      <button type="button" disabled={busy} onClick={() => void removeDesignation(d.id)} className="text-[16px] text-neutral-500 hover:text-red-600">Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </dl>
      </div>
    </SheetDialog>
  )
}
