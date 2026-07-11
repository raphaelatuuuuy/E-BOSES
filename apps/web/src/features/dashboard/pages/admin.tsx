import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CalendarDaysIcon, ClipboardListIcon, MegaphoneIcon, ShieldCheckIcon, UserCheckIcon, UsersIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  createManagedAnnouncement,
  createManagedBarangayEvent,
  deleteManagedAnnouncement,
  deleteManagedBarangayEvent,
  getOfficialDashboardSummary,
  listConcernAppeals,
  listManagedAnnouncements,
  listManagedBarangayEvents,
  reviewConcernAppeal,
  updateManagedAnnouncement,
  updateManagedBarangayEvent,
  type Announcement,
  type BarangayEvent,
  type ConcernAppeal,
  type OfficialRoleSummary,
} from "@/features/dashboard/api"
import {
  listManagedAccountRequests,
  listResidents,
  listResponders,
  reviewAccountRequest,
  updateResidentStatus,
  updateResponder,
  type AccountRequest,
  type AuthUser,
  type UserStatus,
} from "@/features/auth/api"
import {
  listEmergencyAppeals,
  reviewEmergencyAppeal,
  type EmergencyAppeal,
} from "@/features/dashboard/emergency-api"
import { Topbar } from "@/features/dashboard/components/topbar"
import { useAuthSession } from "@/features/auth/auth-session"
import { usePageTitle } from "@/hooks/use-page-title"

type Tab = "content" | "accounts" | "appeals" | "directories"
type AppealStatusFilter = "all" | "submitted" | "approved" | "denied"

const tabs: Array<{ id: Tab; label: string; icon: typeof MegaphoneIcon }> = [
  { id: "content", label: "Content", icon: MegaphoneIcon },
  { id: "accounts", label: "Account Requests", icon: ClipboardListIcon },
  { id: "appeals", label: "Appeals", icon: ShieldCheckIcon },
  { id: "directories", label: "Directories", icon: UsersIcon },
]

const statuses: UserStatus[] = ["verified", "pending_verification", "rejected", "suspended"]

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm">
      <h2 className="text-base font-black text-[#07145f]">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function TextField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none placeholder:text-[#8b96b8] focus:border-[#ff6a1a]"
    />
  )
}

function personName(user?: { full_name?: string; firstName?: string; lastName?: string; email?: string }) {
  return user?.full_name || `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || user?.email || "Resident"
}

function formatAdminDate(value?: string | null) {
  if (!value) return "Pending"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
}

export default function AdminPage() {
  usePageTitle("Admin")
  const { user } = useAuthSession()
  const canManage = user?.role === "barangay_official" || user?.is_staff || user?.is_superuser
  const [tab, setTab] = useState<Tab>("content")
  const [loading, setLoading] = useState(true)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [accountRequests, setAccountRequests] = useState<AccountRequest[]>([])
  const [concernAppeals, setConcernAppeals] = useState<ConcernAppeal[]>([])
  const [emergencyAppeals, setEmergencyAppeals] = useState<EmergencyAppeal[]>([])
  const [residents, setResidents] = useState<AuthUser[]>([])
  const [responders, setResponders] = useState<AuthUser[]>([])
  const [summary, setSummary] = useState<OfficialRoleSummary | null>(null)
  const [busy, setBusy] = useState("")
  const [announcementForm, setAnnouncementForm] = useState({ title: "", body: "", tag: "Advisory" })
  const [eventForm, setEventForm] = useState({ title: "", detail: "", starts_at: "" })

  async function load() {
    setLoading(true)
    try {
      const [nextSummary, nextAnnouncements, nextEvents, nextRequests, nextConcernAppeals, nextEmergencyAppeals, nextResidents, nextResponders] = await Promise.all([
        getOfficialDashboardSummary(),
        listManagedAnnouncements(),
        listManagedBarangayEvents(),
        listManagedAccountRequests(),
        listConcernAppeals(),
        listEmergencyAppeals(),
        listResidents(),
        listResponders(),
      ])
      setSummary(nextSummary)
      setAnnouncements(nextAnnouncements)
      setEvents(nextEvents)
      setAccountRequests(nextRequests)
      setConcernAppeals(nextConcernAppeals)
      setEmergencyAppeals(nextEmergencyAppeals)
      setResidents(nextResidents)
      setResponders(nextResponders)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load admin data.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canManage) return
    void load()
  }, [canManage])

  if (!canManage) {
    return (
      <div className="flex flex-col bg-[#f7f8fc]">
        <Topbar />
        <main className="p-4 md:p-8">
          <section className="rounded-2xl border border-[#dfe7f5] bg-white p-8 text-center shadow-sm">
            <ShieldCheckIcon className="mx-auto size-10 text-[#07145f]" />
            <h1 className="mt-3 text-xl font-black text-[#07145f]">Official admin workspace is restricted</h1>
            <p className="mt-2 text-sm font-semibold text-[#43507f]">Only authorized barangay officials can manage content, account requests, appeals, and directories.</p>
          </section>
        </main>
      </div>
    )
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    try {
      await fn()
      await load()
      toast.success("Saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.")
    } finally {
      setBusy("")
    }
  }

  async function createAnnouncement(published: boolean) {
    await run("announcement-create", async () => {
      await createManagedAnnouncement({
        title: announcementForm.title,
        body: announcementForm.body,
        tag: announcementForm.tag,
        audience: "all",
        barangay: "Marikina Heights",
        is_published: published,
      })
      setAnnouncementForm({ title: "", body: "", tag: "Advisory" })
    })
  }

  async function createEvent(published: boolean) {
    await run("event-create", async () => {
      await createManagedBarangayEvent({
        title: eventForm.title,
        detail: eventForm.detail,
        barangay: "Marikina Heights",
        starts_at: new Date(eventForm.starts_at).toISOString(),
        is_published: published,
      })
      setEventForm({ title: "", detail: "", starts_at: "" })
    })
  }

  return (
    <div className="flex flex-col bg-[#f7f8fc]">
      <Topbar />
      <main className="space-y-5 p-4 md:p-8">
        <section className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-wide text-[#ff6a1a]">Barangay operations</p>
          <h1 className="mt-1 text-2xl font-black text-[#07145f]">Official Admin Workspace</h1>
          <p className="mt-2 text-sm font-semibold text-[#43507f]">Manage published content, account requests, appeals, residents, and responder records.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Pending reviews", summary?.pending_reviews ?? 0],
              ["Active emergencies", summary?.active_emergencies ?? 0],
              ["On-duty responders", summary?.responders_on_duty ?? 0],
              ["Pending appeals", (summary?.pending_appeals ?? 0) + (summary?.pending_emergency_appeals ?? 0)],
              ["Account requests", summary?.pending_account_requests ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
                <p className="text-xl font-black text-[#07145f]">{value}</p>
                <p className="text-[11px] font-bold text-[#43507f]">{label}</p>
              </div>
            ))}
          </div>
          <div className="scrollbar-hide mt-5 flex gap-2 overflow-x-auto">
            {tabs.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-black", tab === item.id ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-[#cbd8ee] bg-white text-[#07145f]")}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              )
            })}
          </div>
        </section>

        {loading ? <div className="rounded-2xl border border-[#dfe7f5] bg-white p-8 text-sm font-bold text-[#68739c]">Loading admin workspace...</div> : null}

        {!loading && tab === "content" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Announcements">
              <div className="grid gap-2">
                <TextField value={announcementForm.title} onChange={(title) => setAnnouncementForm((current) => ({ ...current, title }))} placeholder="Announcement title" />
                <TextField value={announcementForm.tag} onChange={(tag) => setAnnouncementForm((current) => ({ ...current, tag }))} placeholder="Tag" />
                <textarea value={announcementForm.body} onChange={(event) => setAnnouncementForm((current) => ({ ...current, body: event.target.value }))} placeholder="Announcement body" className="min-h-24 rounded-lg border border-[#cbd8ee] px-3 py-2 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                <div className="flex gap-2">
                  <Button type="button" disabled={busy === "announcement-create" || !announcementForm.title || !announcementForm.body} onClick={() => void createAnnouncement(false)} variant="outline">Save draft</Button>
                  <Button type="button" disabled={busy === "announcement-create" || !announcementForm.title || !announcementForm.body} onClick={() => void createAnnouncement(true)} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">Publish</Button>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {announcements.map((item) => (
                  <div key={item.id} className="rounded-xl border border-[#dfe7f5] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-black text-[#07145f]">{item.title}</p><p className="mt-1 text-xs font-semibold text-[#43507f]">{item.tag} · {item.is_published ? "Published" : "Draft"}</p></div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void run(`announcement-toggle-${item.id}`, () => updateManagedAnnouncement(item.id, { is_published: !item.is_published }))}>{item.is_published ? "Unpublish" : "Publish"}</Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => void run(`announcement-delete-${item.id}`, () => deleteManagedAnnouncement(item.id))}>Delete</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#43507f]">{item.body}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Barangay Events">
              <div className="grid gap-2">
                <TextField value={eventForm.title} onChange={(title) => setEventForm((current) => ({ ...current, title }))} placeholder="Event title" />
                <input type="datetime-local" value={eventForm.starts_at} onChange={(event) => setEventForm((current) => ({ ...current, starts_at: event.target.value }))} className="h-10 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                <textarea value={eventForm.detail} onChange={(event) => setEventForm((current) => ({ ...current, detail: event.target.value }))} placeholder="Event details" className="min-h-24 rounded-lg border border-[#cbd8ee] px-3 py-2 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                <div className="flex gap-2">
                  <Button type="button" disabled={busy === "event-create" || !eventForm.title || !eventForm.starts_at} onClick={() => void createEvent(false)} variant="outline">Save draft</Button>
                  <Button type="button" disabled={busy === "event-create" || !eventForm.title || !eventForm.starts_at} onClick={() => void createEvent(true)} className="bg-[#ff6a1a] text-white hover:bg-[#e85f17]">Publish</Button>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {events.map((item) => (
                  <div key={item.id} className="rounded-xl border border-[#dfe7f5] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-black text-[#07145f]">{item.title}</p><p className="mt-1 text-xs font-semibold text-[#43507f]">{item.time_label || item.starts_at} · {item.is_published ? "Published" : "Draft"}</p></div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void run(`event-toggle-${item.id}`, () => updateManagedBarangayEvent(item.id, { is_published: !item.is_published }))}>{item.is_published ? "Unpublish" : "Publish"}</Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => void run(`event-delete-${item.id}`, () => deleteManagedBarangayEvent(item.id))}>Delete</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#43507f]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}

        {!loading && tab === "accounts" ? (
          <Card title="Account Requests">
            <div className="grid gap-3">
              {accountRequests.map((request) => (
                <div key={request.id} className="rounded-xl border border-[#dfe7f5] p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-black text-[#07145f]">{personName(request.user)}</p>
                      <p className="mt-1 text-xs font-semibold text-[#43507f]">{request.type.replace("_", " ")} · {request.status}</p>
                      <p className="mt-2 text-sm font-semibold text-[#43507f]">{request.note || "No note."}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(["reviewed", "completed", "rejected"] as const).map((status) => (
                        <Button key={status} type="button" size="sm" variant={status === "rejected" ? "destructive" : "outline"} onClick={() => void run(`request-${request.id}-${status}`, () => reviewAccountRequest(request.id, { status, staff_note: `${status} by official.` }))}>{status}</Button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              {accountRequests.length === 0 ? <p className="text-sm font-semibold text-[#68739c]">No account requests.</p> : null}
            </div>
          </Card>
        ) : null}

        {!loading && tab === "appeals" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Concern Appeals">
              <AppealList items={concernAppeals} kind="concern" onApprove={(id, note) => run(`concern-appeal-approve-${id}`, () => reviewConcernAppeal(id, { status: "approved", decision_note: note || "Appeal approved." }))} onDeny={(id, note) => run(`concern-appeal-deny-${id}`, () => reviewConcernAppeal(id, { status: "denied", decision_note: note || "Appeal denied." }))} />
            </Card>
            <Card title="Emergency Reviews">
              <AppealList items={emergencyAppeals} kind="emergency" onApprove={(id, note) => run(`emergency-appeal-approve-${id}`, () => reviewEmergencyAppeal(id, { status: "approved", decision_note: note || "Emergency review approved." }))} onDeny={(id, note) => run(`emergency-appeal-deny-${id}`, () => reviewEmergencyAppeal(id, { status: "denied", decision_note: note || "Emergency review denied." }))} />
            </Card>
          </div>
        ) : null}

        {!loading && tab === "directories" ? (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card title="Residents">
              <UserList users={residents} onStatus={(user, status) => run(`resident-${user.id}-${status}`, () => updateResidentStatus(user.id, status))} />
            </Card>
            <Card title="Responders">
              <div className="grid gap-3">
                {responders.map((user) => (
                  <div key={user.id} className="rounded-xl border border-[#dfe7f5] p-4">
                    <div className="flex items-start gap-3">
                      <UserCheckIcon className="mt-1 size-5 text-[#ff6a1a]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black text-[#07145f]">{personName(user)}</p>
                        <p className="mt-1 text-xs font-semibold text-[#43507f]">{user.email} · {user.responder_unit || "no unit"} · {user.is_on_duty ? "on duty" : "off duty"}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(["tanod", "bhw", "bdrrmo", "other"] as const).map((unit) => (
                            <Button key={unit} type="button" size="sm" variant="outline" onClick={() => void run(`responder-${user.id}-${unit}`, () => updateResponder(user.id, { responder_unit: unit }))}>{unit}</Button>
                          ))}
                          <Button type="button" size="sm" variant="outline" onClick={() => void run(`responder-duty-${user.id}`, () => updateResponder(user.id, { is_on_duty: !user.is_on_duty }))}>{user.is_on_duty ? "Set off duty" : "Set on duty"}</Button>
                          <Button type="button" size="sm" variant={user.status === "suspended" ? "outline" : "destructive"} onClick={() => void run(`responder-status-${user.id}`, () => updateResponder(user.id, { status: user.status === "suspended" ? "verified" : "suspended" }))}>{user.status === "suspended" ? "Restore" : "Suspend"}</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function appealTitle(item: ConcernAppeal | EmergencyAppeal, kind: "concern" | "emergency") {
  if (kind === "concern") {
    const appeal = item as ConcernAppeal
    return `${appeal.concern_tracking_id || `Report #${appeal.concern_id || item.id}`} · ${appeal.concern_title || "Concern report"}`
  }
  const appeal = item as EmergencyAppeal
  return `Emergency #${appeal.alert_id || item.id} · ${(appeal.alert_type || "alert").replace(/_/g, " ")}`
}

function AppealList({
  items,
  kind,
  onApprove,
  onDeny,
}: {
  items: Array<ConcernAppeal | EmergencyAppeal>
  kind: "concern" | "emergency"
  onApprove: (id: number, note: string) => void
  onDeny: (id: number, note: string) => void
}) {
  const [status, setStatus] = useState<AppealStatusFilter>("submitted")
  const [notes, setNotes] = useState<Record<number, string>>({})
  const filtered = status === "all" ? items : items.filter((item) => item.status === status)
  return (
    <div className="grid gap-3">
      <div className="scrollbar-hide flex gap-2 overflow-x-auto">
        {(["submitted", "approved", "denied", "all"] as AppealStatusFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setStatus(option)}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-black", status === option ? "border-[#ff6a1a] bg-[#ff6a1a] text-white" : "border-[#cbd8ee] bg-white text-[#07145f]")}
          >
            {option} {option === "all" ? items.length : items.filter((item) => item.status === option).length}
          </button>
        ))}
      </div>
      {filtered.map((item) => (
        <div key={item.id} className="rounded-xl border border-[#dfe7f5] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-black text-[#07145f]">{appealTitle(item, kind)}</p>
              <p className="mt-1 text-xs font-semibold text-[#43507f]">{personName(item.appellant)} · submitted {formatAdminDate(item.created_at)} · {item.status}</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#43507f]">{item.reason}</p>
              {item.decision_note ? <p className="mt-2 rounded-lg bg-[#f8fafc] p-3 text-xs font-bold text-[#07145f]">Decision: {item.decision_note}</p> : null}
              {item.reviewed_by ? <p className="mt-2 text-xs font-semibold text-[#68739c]">Reviewed by {item.reviewed_by.full_name} · {formatAdminDate(item.decided_at)}</p> : null}
            </div>
            {item.status === "submitted" ? (
              <div className="grid min-w-0 gap-2 md:w-64">
                <textarea
                  value={notes[item.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                  placeholder="Decision note for resident"
                  className="min-h-20 rounded-lg border border-[#cbd8ee] px-3 py-2 text-xs font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]"
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onApprove(item.id, notes[item.id]?.trim() ?? "")}>Approve</Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => onDeny(item.id, notes[item.id]?.trim() ?? "")}>Deny</Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ))}
      {filtered.length === 0 ? <p className="text-sm font-semibold text-[#68739c]">No appeals in this filter.</p> : null}
    </div>
  )
}

function UserList({ users, onStatus }: { users: AuthUser[]; onStatus: (user: AuthUser, status: UserStatus) => void }) {
  return (
    <div className="grid gap-3">
      {users.map((user) => (
        <div key={user.id} className="rounded-xl border border-[#dfe7f5] p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="font-black text-[#07145f]">{personName(user)}</p>
              <p className="mt-1 text-xs font-semibold text-[#43507f]">{user.email} · {user.status}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {statuses.map((status) => (
                <Button key={status} type="button" size="sm" variant={status === "suspended" || status === "rejected" ? "destructive" : "outline"} onClick={() => onStatus(user, status)}>{status}</Button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {users.length === 0 ? <p className="text-sm font-semibold text-[#68739c]">No users.</p> : null}
    </div>
  )
}
