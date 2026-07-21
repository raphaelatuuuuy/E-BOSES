import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { PlusIcon, SearchIcon, ShieldCheckIcon, UserCheckIcon, UsersIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useAuthSession } from "@/features/auth/auth-session"
import {
  createManagedUser,
  listResidents,
  listResponders,
  updateResidentStatus,
  updateResponder,
  type AuthUser,
  type UserStatus,
} from "@/features/auth/api"
import { usePageTitle } from "@/hooks/use-page-title"

const statuses: UserStatus[] = ["verified", "pending_verification", "rejected", "suspended"]

function nameOf(user: AuthUser) {
  return user.full_name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
}

function statusLabel(status: UserStatus) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function UserRow({
  user,
  onResidentStatus,
  onResponderUpdate,
  busy,
}: {
  user: AuthUser
  onResidentStatus: (status: UserStatus) => void
  onResponderUpdate: (payload: Parameters<typeof updateResponder>[1]) => void
  busy: boolean
}) {
  const isResponder = user.role === "first_responder"
  return (
    <div className="rounded-2xl border border-[#dfe7f5] bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-[#145be7]">
            {isResponder ? <UserCheckIcon className="size-5" /> : <UsersIcon className="size-5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-black text-[#07145f]">{nameOf(user)}</p>
            <p className="mt-1 truncate text-xs font-semibold text-[#68739c]">{user.email} · {isResponder ? "Responder" : "Resident"}</p>
            <p className="mt-1 text-xs font-semibold text-[#68739c]">
              {isResponder ? `${user.responder_unit || "No unit"} · ${user.is_on_duty ? "Active shift" : "No active shift"}` : user.phone_number || "No phone number"}
            </p>
          </div>
        </div>
        <span className={cn(
          "w-fit rounded-full border px-2.5 py-1 text-[11px] font-black",
          user.status === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
            user.status === "suspended" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-700",
        )}>
          {statusLabel(user.status)}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!isResponder ? statuses.map((status) => (
          <Button key={status} type="button" size="sm" variant={status === user.status ? "default" : "outline"} disabled={busy || status === user.status} onClick={() => onResidentStatus(status)}>
            {statusLabel(status)}
          </Button>
        )) : (
          <>
            {(["tanod", "bhw", "bdrrmo", "other"] as const).map((unit) => (
              <Button key={unit} type="button" size="sm" variant={user.responder_unit === unit ? "default" : "outline"} disabled={busy || user.responder_unit === unit} onClick={() => onResponderUpdate({ responder_unit: unit })}>
                {unit.toUpperCase()}
              </Button>
            ))}
            <Button type="button" size="sm" variant={user.status === "suspended" ? "outline" : "destructive"} disabled={busy} onClick={() => onResponderUpdate({ status: user.status === "suspended" ? "verified" : "suspended" })}>
              {user.status === "suspended" ? "Restore" : "Suspend"}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default function OfficialUsersPage() {
  usePageTitle("Users")
  const { user } = useAuthSession()
  const canManage = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const [search, setSearch] = useState("")
  const [residents, setResidents] = useState<AuthUser[]>([])
  const [responders, setResponders] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newResponder, setNewResponder] = useState({
    email: "",
    phone_number: "+63",
    password: "",
    responder_unit: "bhw" as NonNullable<AuthUser["responder_unit"]>,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextResidents, nextResponders] = await Promise.all([listResidents(search), listResponders(search)])
      setResidents(nextResidents)
      setResponders(nextResponders)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load users.")
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    if (!canManage) return
    const id = window.setTimeout(() => void load(), 250)
    return () => window.clearTimeout(id)
  }, [canManage, load])

  const allUsers = useMemo(() => [...residents, ...responders], [residents, responders])

  async function run(id: number, action: () => Promise<unknown>) {
    setBusy(id)
    try {
      await action()
      await load()
      toast.success("User updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "User update failed.")
    } finally {
      setBusy(null)
    }
  }

  async function submitResponder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreating(true)
    try {
      await createManagedUser({
        ...newResponder,
        email: newResponder.email.trim().toLowerCase(),
        phone_number: newResponder.phone_number.trim(),
        role: "first_responder",
      })
      setNewResponder({ email: "", phone_number: "+63", password: "", responder_unit: "bhw" })
      setShowCreate(false)
      await load()
      toast.success("Responder account created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create responder account.")
    } finally {
      setCreating(false)
    }
  }

  if (!canManage) {
    return <div className="p-6"><section className="rounded-2xl border border-neutral-200 bg-white p-8 text-center"><ShieldCheckIcon className="mx-auto size-10 text-[#07145f]" /><h1 className="mt-3 text-xl font-bold text-neutral-900">Users is restricted</h1><p className="mt-2 text-sm text-neutral-600">Only authorized barangay officials can manage accounts.</p></section></div>
  }

  return (
    <div className="space-y-5 bg-white p-4 md:p-6 lg:p-8">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-[#ff6a1a]">Configuration · Users</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-tight text-neutral-900 sm:text-2xl">User management</h1>
        <p className="mt-2 text-[15px] font-medium leading-6 text-neutral-600">Manage resident verification and responder access. Live availability remains controlled by each responder’s Shift workflow.</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-xl">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#68739c]" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, email, or phone" className="h-11 w-full rounded-xl border border-[#cbd8ee] bg-[#f8fafc] pl-9 pr-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
          </div>
          <Button type="button" className="h-11 shrink-0 rounded-xl bg-[#ff6a1a] px-4 font-black text-white hover:bg-[#e85c11]" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? <XIcon className="size-4" /> : <PlusIcon className="size-4" />}
            {showCreate ? "Close" : "Add responder"}
          </Button>
        </div>
      </section>

      {showCreate ? (
        <section className="rounded-2xl border border-[#ffd1b8] bg-[#fff8f3] p-5">
          <div>
            <p className="text-sm font-black text-[#07145f]">Create responder account</p>
            <p className="mt-1 text-sm font-medium text-[#68739c]">The account is verified immediately and appears in routing only after the responder starts a shift and shares a valid location.</p>
          </div>
          <form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={submitResponder}>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#48547b]">
              Email
              <input required type="email" value={newResponder.email} onChange={(event) => setNewResponder((value) => ({ ...value, email: event.target.value }))} className="h-11 rounded-xl border border-[#cbd8ee] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#07145f] outline-none focus:border-[#ff6a1a]" placeholder="responder@eboses.test" />
            </label>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#48547b]">
              Mobile number
              <input required inputMode="tel" pattern="\+63[0-9]{10}" value={newResponder.phone_number} onChange={(event) => setNewResponder((value) => ({ ...value, phone_number: event.target.value }))} className="h-11 rounded-xl border border-[#cbd8ee] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#07145f] outline-none focus:border-[#ff6a1a]" placeholder="+639171234567" />
            </label>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#48547b]">
              Temporary password
              <input required minLength={8} type="password" autoComplete="new-password" value={newResponder.password} onChange={(event) => setNewResponder((value) => ({ ...value, password: event.target.value }))} className="h-11 rounded-xl border border-[#cbd8ee] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#07145f] outline-none focus:border-[#ff6a1a]" placeholder="At least 8 characters" />
            </label>
            <label className="grid gap-1.5 text-xs font-black uppercase tracking-wide text-[#48547b]">
              Operational unit
              <select value={newResponder.responder_unit} onChange={(event) => setNewResponder((value) => ({ ...value, responder_unit: event.target.value as NonNullable<AuthUser["responder_unit"]> }))} className="h-11 rounded-xl border border-[#cbd8ee] bg-white px-3 text-sm font-semibold normal-case tracking-normal text-[#07145f] outline-none focus:border-[#ff6a1a]">
                <option value="bhw">BHW · Medical</option>
                <option value="tanod">Tanod · Safety</option>
                <option value="bdrrmo">BDRRMO · Disaster</option>
                <option value="other">Other responder</option>
              </select>
            </label>
            <div className="md:col-span-2 xl:col-span-4">
              <Button disabled={creating} type="submit" className="h-11 rounded-xl bg-[#07145f] px-5 font-black text-white hover:bg-[#0d217e]">
                {creating ? "Creating…" : "Create responder"}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {loading ? <div className="rounded-2xl border border-neutral-200 p-8 text-sm font-semibold text-neutral-500">Loading users…</div> : null}
      {!loading ? <div className="grid gap-5 xl:grid-cols-2">
        <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-wide text-[#07145f]">Residents <span className="text-[#68739c]">({residents.length})</span></h2></div>{residents.map((item) => <UserRow key={item.id} user={item} busy={busy === item.id} onResidentStatus={(status) => void run(item.id, () => updateResidentStatus(item.id, status))} onResponderUpdate={() => undefined} />)}{residents.length === 0 ? <p className="rounded-xl border border-dashed border-[#cbd8ee] p-6 text-sm text-[#68739c]">No residents match this search.</p> : null}</section>
        <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-wide text-[#07145f]">Responders <span className="text-[#68739c]">({responders.length})</span></h2></div>{responders.map((item) => <UserRow key={item.id} user={item} busy={busy === item.id} onResidentStatus={() => undefined} onResponderUpdate={(payload) => void run(item.id, () => updateResponder(item.id, payload))} />)}{responders.length === 0 ? <p className="rounded-xl border border-dashed border-[#cbd8ee] p-6 text-sm text-[#68739c]">No responders match this search.</p> : null}</section>
      </div> : null}
      <p className="text-xs font-semibold text-[#68739c]">{allUsers.length} resident and responder accounts shown. Responder availability is controlled by each responder’s Shift workflow.</p>
    </div>
  )
}
