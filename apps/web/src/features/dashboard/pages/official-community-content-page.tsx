import { type FormEvent, useCallback, useEffect, useState } from "react"
import { ArrowLeftIcon, CalendarDaysIcon, MegaphoneIcon, PencilIcon, PlusIcon, ShieldAlertIcon, Trash2Icon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  createManagedAnnouncement,
  createManagedBarangayEvent,
  deleteManagedAnnouncement,
  deleteManagedBarangayEvent,
  listContentFlags,
  listManagedAnnouncements,
  listManagedBarangayEvents,
  reviewContentFlag,
  updateManagedAnnouncement,
  updateManagedBarangayEvent,
  type Announcement,
  type BarangayEvent,
  type ContentFlag,
} from "@/features/dashboard/api"
import { usePageTitle } from "@/hooks/use-page-title"

type AnnouncementDraft = Pick<Announcement, "title" | "body" | "tag" | "audience" | "urgency" | "is_pinned" | "is_published" | "image_alt"> & { starts_at: string; expires_at: string }
type EventDraft = Pick<BarangayEvent, "title" | "detail" | "is_published"> & { starts_at: string; ends_at: string }

const emptyAnnouncement: AnnouncementDraft = { title: "", body: "", tag: "Advisory", audience: "all", urgency: "normal", is_pinned: false, is_published: false, starts_at: "", expires_at: "", image_alt: "" }
const emptyEvent: EventDraft = { title: "", detail: "", starts_at: "", ends_at: "", is_published: false }

function localDateTime(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function StatePill({ status, pinned }: { status: string; pinned?: boolean }) {
  const active = status === "published"
  const scheduled = status === "scheduled"
  return (
    <span className={cn("rounded-md border px-2 py-1 text-[10px] font-black uppercase", active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : scheduled ? "border-blue-200 bg-blue-50 text-blue-700" : "border-neutral-200 bg-neutral-50 text-neutral-600")}>
      {pinned ? "Pinned · " : ""}{status.replace(/_/g, " ")}
    </span>
  )
}

export default function OfficialCommunityContentPage() {
  usePageTitle("Community Content")
  const navigate = useNavigate()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [events, setEvents] = useState<BarangayEvent[]>([])
  const [flags, setFlags] = useState<ContentFlag[]>([])
  const [flagNotes, setFlagNotes] = useState<Record<number, string>>({})
  const [announcement, setAnnouncement] = useState(emptyAnnouncement)
  const [announcementImage, setAnnouncementImage] = useState<File | null>(null)
  const [eventDraft, setEventDraft] = useState(emptyEvent)
  const [editingAnnouncement, setEditingAnnouncement] = useState<number | null>(null)
  const [editingEvent, setEditingEvent] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextAnnouncements, nextEvents, nextFlags] = await Promise.all([
        listManagedAnnouncements(),
        listManagedBarangayEvents(),
        listContentFlags(),
      ])
      setAnnouncements(nextAnnouncements)
      setEvents(nextEvents)
      setFlags(nextFlags)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load community content.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function saveAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("announcement-save")
    try {
      const payload = {
        ...announcement,
        starts_at: announcement.starts_at ? new Date(announcement.starts_at).toISOString() : null,
        expires_at: announcement.expires_at ? new Date(announcement.expires_at).toISOString() : null,
      }
      let requestBody: Partial<Announcement> | FormData = payload
      if (announcementImage) {
        const form = new FormData()
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== null && value !== undefined) form.append(key, String(value))
        })
        form.append("image", announcementImage)
        requestBody = form
      }
      if (editingAnnouncement) await updateManagedAnnouncement(editingAnnouncement, requestBody)
      else await createManagedAnnouncement(requestBody)
      setAnnouncement(emptyAnnouncement)
      setAnnouncementImage(null)
      setEditingAnnouncement(null)
      await load()
      toast.success(editingAnnouncement ? "Announcement updated" : "Announcement created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save announcement.")
    } finally {
      setBusy("")
    }
  }

  async function saveEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("event-save")
    try {
      const payload = {
        ...eventDraft,
        starts_at: new Date(eventDraft.starts_at).toISOString(),
        ends_at: eventDraft.ends_at ? new Date(eventDraft.ends_at).toISOString() : null,
      }
      if (editingEvent) await updateManagedBarangayEvent(editingEvent, payload)
      else await createManagedBarangayEvent(payload)
      setEventDraft(emptyEvent)
      setEditingEvent(null)
      await load()
      toast.success(editingEvent ? "Event updated" : "Event created")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save event.")
    } finally {
      setBusy("")
    }
  }

  async function removeAnnouncement(id: number) {
    setBusy(`announcement-delete-${id}`)
    try {
      await deleteManagedAnnouncement(id)
      setAnnouncements((items) => items.filter((item) => item.id !== id))
      toast.success("Announcement deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete announcement.")
    } finally {
      setBusy("")
    }
  }

  async function removeEvent(id: number) {
    setBusy(`event-delete-${id}`)
    try {
      await deleteManagedBarangayEvent(id)
      setEvents((items) => items.filter((item) => item.id !== id))
      toast.success("Event deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete event.")
    } finally {
      setBusy("")
    }
  }

  async function decideFlag(flag: ContentFlag, status: "reviewed" | "dismissed" | "action_taken") {
    const note = (flagNotes[flag.id] || "").trim()
    if (note.length < 5) {
      toast.error("Add a decision note with at least 5 characters.")
      return
    }
    setBusy(`flag-${flag.id}`)
    try {
      const next = await reviewContentFlag(flag.id, { status, staff_note: note })
      setFlags((items) => items.map((item) => item.id === next.id ? next : item))
      toast.success("Content report reviewed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review content report.")
    } finally {
      setBusy("")
    }
  }

  return (
    <main className="min-h-full bg-canvas p-4 pb-28 md:p-6 md:pb-6 lg:p-8">
      <header className="rounded-2xl border border-line-tint bg-white p-5">
        <button type="button" onClick={() => navigate("/dashboard/reports")} className="flex items-center gap-2 text-xs font-black text-brand-blue"><ArrowLeftIcon className="size-4" />Back to concerns</button>
        <p className="mt-5 text-[12px] font-black uppercase tracking-wide text-brand-orange">Concerns · Community content</p>
        <h1 className="mt-1 text-2xl font-black text-brand-navy">Announcements and barangay events</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-subtle-foreground">Create drafts, edit details, and publish resident-facing updates. Publishing an announcement sends the configured resident notification.</p>
      </header>

      <div className="mt-5 grid gap-5 2xl:grid-cols-2">
        <section className="rounded-2xl border border-line-tint bg-white p-5">
          <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-brand-orange-soft text-brand-orange"><MegaphoneIcon className="size-5" /></span><div><h2 className="font-black text-brand-navy">Announcements</h2><p className="text-xs font-semibold text-subtle-foreground">Safety advisories and community updates</p></div></div>
          <form className="mt-5 grid gap-3" onSubmit={saveAnnouncement}>
            <input required maxLength={160} value={announcement.title} onChange={(e) => setAnnouncement((v) => ({ ...v, title: e.target.value }))} placeholder="Announcement title" className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange" />
            <textarea required maxLength={3000} rows={4} value={announcement.body} onChange={(e) => setAnnouncement((v) => ({ ...v, body: e.target.value }))} placeholder="Information residents need to know" className="resize-none rounded-xl border border-line-tint p-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input required maxLength={40} value={announcement.tag} onChange={(e) => setAnnouncement((v) => ({ ...v, tag: e.target.value }))} placeholder="Tag" className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy" />
              <select value={announcement.audience} onChange={(e) => setAnnouncement((v) => ({ ...v, audience: e.target.value as Announcement["audience"] }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy">
                <option value="all">All users</option>
                <option value="residents">Residents only</option>
                <option value="responders">Responders only</option>
                <option value="officials">Officials only</option>
              </select>
              <select value={announcement.urgency} onChange={(e) => setAnnouncement((v) => ({ ...v, urgency: e.target.value as Announcement["urgency"] }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy">
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
              <label className="flex h-11 items-center gap-2 rounded-xl border border-line-tint px-3 text-sm font-bold text-navy-muted"><input type="checkbox" checked={announcement.is_pinned} onChange={(e) => setAnnouncement((v) => ({ ...v, is_pinned: e.target.checked }))} className="size-4 accent-brand-orange" />Pin to top</label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-black text-navy-muted">Starts (optional)<input type="datetime-local" value={announcement.starts_at} onChange={(e) => setAnnouncement((v) => ({ ...v, starts_at: e.target.value }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold" /></label>
              <label className="grid gap-1 text-xs font-black text-navy-muted">Expires (optional)<input type="datetime-local" value={announcement.expires_at} onChange={(e) => setAnnouncement((v) => ({ ...v, expires_at: e.target.value }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold" /></label>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="grid gap-1 text-xs font-black text-navy-muted">Banner image (optional)<input type="file" accept="image/*" onChange={(e) => setAnnouncementImage(e.target.files?.[0] ?? null)} className="rounded-xl border border-line-tint bg-white px-3 py-2 text-sm font-semibold" /></label>
              <input maxLength={160} value={announcement.image_alt} onChange={(e) => setAnnouncement((v) => ({ ...v, image_alt: e.target.value }))} placeholder="Image alt text" className="h-11 self-end rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy" />
            </div>
            {announcementImage ? <p className="rounded-xl bg-brand-orange-soft px-3 py-2 text-xs font-bold text-severity-high-ink">Selected: {announcementImage.name}</p> : null}
            <label className="flex items-center gap-2 text-sm font-bold text-navy-muted"><input type="checkbox" checked={announcement.is_published} onChange={(e) => setAnnouncement((v) => ({ ...v, is_published: e.target.checked }))} className="size-4 accent-brand-orange" />Publish / schedule</label>
            <div className="flex gap-2"><Button type="submit" disabled={busy === "announcement-save"} className="bg-brand-navy text-white hover:bg-brand-navy/80"><PlusIcon className="size-4" />{editingAnnouncement ? "Save changes" : "Create announcement"}</Button>{editingAnnouncement ? <Button type="button" variant="outline" onClick={() => { setEditingAnnouncement(null); setAnnouncement(emptyAnnouncement); setAnnouncementImage(null) }}>Cancel</Button> : null}</div>
          </form>
          <div className="mt-5 space-y-3 border-t border-line-tint pt-4">
            {announcements.map((item) => <article key={item.id} className="rounded-xl border border-line-tint p-3">{item.image_url ? <img src={item.image_url} alt={item.image_alt || ""} className="mb-3 h-32 w-full rounded-xl object-cover" /> : null}<div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-brand-navy">{item.title}</p><p className="mt-1 text-[11px] font-black uppercase text-brand-orange">{item.urgency} · {item.audience}</p><p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-subtle-foreground">{item.body}</p></div><StatePill status={item.status_label} pinned={item.is_pinned} /></div><div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setEditingAnnouncement(item.id); setAnnouncement({ title: item.title, body: item.body, tag: item.tag, audience: item.audience, urgency: item.urgency, is_pinned: item.is_pinned, is_published: item.is_published, starts_at: localDateTime(item.starts_at), expires_at: localDateTime(item.expires_at), image_alt: item.image_alt || "" }); setAnnouncementImage(null) }}><PencilIcon className="size-3.5" />Edit</Button><Button type="button" size="sm" variant="outline" disabled={busy === `announcement-delete-${item.id}`} onClick={() => void removeAnnouncement(item.id)} className="border-red-200 text-red-700"><Trash2Icon className="size-3.5" />Delete</Button></div></article>)}
            {!loading && announcements.length === 0 ? <p className="rounded-xl border border-dashed border-line-tint p-5 text-center text-sm font-semibold text-subtle-foreground">No announcements yet.</p> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-line-tint bg-white p-5">
          <div className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-tint text-brand-blue"><CalendarDaysIcon className="size-5" /></span><div><h2 className="font-black text-brand-navy">Barangay events</h2><p className="text-xs font-semibold text-subtle-foreground">Schedules shown to the community</p></div></div>
          <form className="mt-5 grid gap-3" onSubmit={saveEvent}>
            <input required maxLength={160} value={eventDraft.title} onChange={(e) => setEventDraft((v) => ({ ...v, title: e.target.value }))} placeholder="Event title" className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange" />
            <textarea required maxLength={255} rows={3} value={eventDraft.detail} onChange={(e) => setEventDraft((v) => ({ ...v, detail: e.target.value }))} placeholder="Event details" className="resize-none rounded-xl border border-line-tint p-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange" />
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-black text-navy-muted">Starts<input required type="datetime-local" value={eventDraft.starts_at} onChange={(e) => setEventDraft((v) => ({ ...v, starts_at: e.target.value }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold" /></label><label className="grid gap-1 text-xs font-black text-navy-muted">Ends (optional)<input type="datetime-local" value={eventDraft.ends_at} onChange={(e) => setEventDraft((v) => ({ ...v, ends_at: e.target.value }))} className="h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold" /></label></div>
            <label className="flex items-center gap-2 text-sm font-bold text-navy-muted"><input type="checkbox" checked={eventDraft.is_published} onChange={(e) => setEventDraft((v) => ({ ...v, is_published: e.target.checked }))} className="size-4 accent-brand-orange" />Publish now</label>
            <div className="flex gap-2"><Button type="submit" disabled={busy === "event-save"} className="bg-brand-navy text-white hover:bg-brand-navy/80"><PlusIcon className="size-4" />{editingEvent ? "Save changes" : "Create event"}</Button>{editingEvent ? <Button type="button" variant="outline" onClick={() => { setEditingEvent(null); setEventDraft(emptyEvent) }}>Cancel</Button> : null}</div>
          </form>
          <div className="mt-5 space-y-3 border-t border-line-tint pt-4">
            {events.map((item) => <article key={item.id} className="rounded-xl border border-line-tint p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-brand-navy">{item.title}</p><p className="mt-1 text-xs font-semibold text-subtle-foreground">{item.time_label}</p><p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-subtle-foreground">{item.detail}</p></div><StatePill status={item.is_published ? "published" : "draft"} /></div><div className="mt-3 flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => { setEditingEvent(item.id); setEventDraft({ title: item.title, detail: item.detail, starts_at: localDateTime(item.starts_at), ends_at: localDateTime(item.ends_at), is_published: item.is_published }) }}><PencilIcon className="size-3.5" />Edit</Button><Button type="button" size="sm" variant="outline" disabled={busy === `event-delete-${item.id}`} onClick={() => void removeEvent(item.id)} className="border-red-200 text-red-700"><Trash2Icon className="size-3.5" />Delete</Button></div></article>)}
            {!loading && events.length === 0 ? <p className="rounded-xl border border-dashed border-line-tint p-5 text-center text-sm font-semibold text-subtle-foreground">No barangay events yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-line-tint bg-white p-5">
        <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><ShieldAlertIcon className="size-5" /></span><div><h2 className="font-black text-brand-navy">Community content reports</h2><p className="mt-1 text-xs font-semibold text-subtle-foreground">Review resident-submitted flags without mixing moderation into User management.</p></div></div>
        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          {flags.map((flag) => (
            <article key={flag.id} className="rounded-xl border border-line-tint p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black capitalize text-brand-navy">{flag.reason.replace(/_/g, " ")}</p><p className="mt-1 text-xs font-semibold text-subtle-foreground">Report #{flag.concern}{flag.comment ? ` · comment #${flag.comment}` : ""} · by {flag.reporter.full_name}</p></div><span className="rounded-md border border-line-tint bg-canvas px-2 py-1 text-[10px] font-black uppercase text-navy-muted">{flag.status.replace(/_/g, " ")}</span></div>
              <p className="mt-3 rounded-lg bg-canvas p-3 text-xs font-semibold leading-5 text-navy-muted">{flag.note || "No additional note supplied."}</p>
              {flag.status === "submitted" ? <><textarea value={flagNotes[flag.id] || ""} onChange={(e) => setFlagNotes((notes) => ({ ...notes, [flag.id]: e.target.value }))} rows={2} maxLength={255} placeholder="Official decision note" className="mt-3 w-full resize-none rounded-xl border border-line-tint p-3 text-xs font-semibold text-brand-navy outline-none focus:border-brand-orange" /><div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => navigate(`/dashboard/reports/${flag.concern}`)}>Open report</Button><Button type="button" size="sm" variant="outline" disabled={busy === `flag-${flag.id}`} onClick={() => void decideFlag(flag, "dismissed")}>Dismiss</Button><Button type="button" size="sm" disabled={busy === `flag-${flag.id}`} onClick={() => void decideFlag(flag, "reviewed")} className="bg-brand-blue text-white">Reviewed</Button><Button type="button" size="sm" disabled={busy === `flag-${flag.id}`} onClick={() => void decideFlag(flag, "action_taken")} className="bg-red-600 text-white">Action taken</Button></div></> : <p className="mt-3 text-xs font-semibold text-navy-muted">Decision: {flag.staff_note}</p>}
            </article>
          ))}
          {!loading && flags.length === 0 ? <p className="rounded-xl border border-dashed border-line-tint p-6 text-center text-sm font-semibold text-subtle-foreground xl:col-span-2">No community content reports.</p> : null}
        </div>
      </section>
    </main>
  )
}