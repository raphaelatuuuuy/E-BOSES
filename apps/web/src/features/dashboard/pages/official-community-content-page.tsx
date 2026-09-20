import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  MegaphoneIcon,
  PencilLineIcon,
  PinIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import {
  deleteManagedAnnouncement,
  getAnnouncementAreaContext,
  listManagedAnnouncements,
  type Announcement,
  type AnnouncementAreaContext,
} from "@/features/dashboard/api"
import { usePageTitle } from "@/hooks/use-page-title"
import { advisoryLabel } from "@/features/dashboard/components/community-content/advisory-tags"
import {
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import {
  CONFIGURATION_PAGE_SIZE,
  ConfigurationListToolbar,
  ConfigurationPager,
} from "@/features/dashboard/components/config/configuration-list-controls"
import {
  ConfigurationTable,
  ConfigurationTableRow,
} from "@/features/dashboard/components/config/configuration-table"
import {
  SheetDialog,
  SheetIconButton,
  SheetPrimaryButton,
  SheetSecondaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import { ContentComposer } from "@/features/dashboard/components/community-content/content-composer"

interface Stat {
  label: string
  value: number
  alarm?: boolean
}

type TypeFilter = "all" | "published" | "scheduled" | "drafts"

const TYPE_OPTIONS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "drafts", label: "Drafts" },
]

export default function OfficialCommunityContentPage({ embedded = false }: { embedded?: boolean }) {
  usePageTitle("Community Announcements")

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [areaContext, setAreaContext] = useState<AnnouncementAreaContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [offset, setOffset] = useState(0)
  const [composerOpen, setComposerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Announcement | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [formState, setFormState] = useState({ canSave: false, busy: false, editing: false })
  const [deleting, setDeleting] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [deleteCountdown, setDeleteCountdown] = useState<number | null>(null)
  const [deleteGrown, setDeleteGrown] = useState(false)
  const removeRef = useRef(() => {})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextAnnouncements, nextContext] = await Promise.all([
        listManagedAnnouncements(),
        getAnnouncementAreaContext().catch(() => null),
      ])
      setAnnouncements(nextAnnouncements)
      setAreaContext(nextContext)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load community announcements.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const stats: Stat[] = useMemo(() => {
    const published = announcements.filter((item) => item.is_published).length
    const scheduled = announcements.filter((item) => item.status_label === "scheduled").length
    const drafts = announcements.filter((item) => !item.is_published).length
    return [
      { label: "Published", value: published },
      { label: "Scheduled", value: scheduled },
      { label: "Drafts", value: drafts },
    ]
  }, [announcements])

  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = {
      all: announcements.length,
      published: announcements.filter((a) => a.is_published).length,
      scheduled: announcements.filter((a) => a.status_label === "scheduled").length,
      drafts: announcements.filter((a) => !a.is_published).length,
    }
    return counts
  }, [announcements])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return announcements.filter((item) => {
      if (typeFilter === "published" && !item.is_published) return false
      if (typeFilter === "scheduled" && item.status_label !== "scheduled") return false
      if (typeFilter === "drafts" && item.is_published) return false
      if (q && !`${item.title} ${item.body} ${item.tag}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [announcements, query, typeFilter])

  const page = filtered.slice(offset, offset + CONFIGURATION_PAGE_SIZE)

  function openNew() {
    setEditTarget(null)
    setIsPinned(false)
    setFormState({ canSave: false, busy: false, editing: false })
    setComposerOpen(true)
  }

  useEffect(() => {
    if (!embedded) return
    window.addEventListener("configuration-primary-action", openNew)
    return () => window.removeEventListener("configuration-primary-action", openNew)
  })

  function openEdit(id: number) {
    const target = announcements.find((item) => item.id === id)
    if (target) setEditTarget(target)
    setIsPinned(target?.is_pinned ?? false)
    setFormState({ canSave: false, busy: false, editing: true })
    setComposerOpen(true)
  }

  function closeComposer() {
    setComposerOpen(false)
    setEditTarget(null)
    setConfirmingRemove(false)
    setDeleteCountdown(null)
  }

  async function removeAnnouncement() {
    if (!editTarget) return
    setDeleting(true)
    try {
      await deleteManagedAnnouncement(editTarget.id)
      toast.success("Announcement deleted")
      closeComposer()
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.")
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => { removeRef.current = () => void removeAnnouncement() })
  useEffect(() => { if (!composerOpen) { setConfirmingRemove(false); setDeleteCountdown(null) } }, [composerOpen ])
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

  const clearFilters = () => { setQuery(""); setTypeFilter("all") }

  const emptyMessage =
    typeFilter === "published"
      ? "No published announcements yet."
      : typeFilter === "scheduled"
        ? "No scheduled announcements."
        : typeFilter === "drafts"
          ? "No drafts yet."
          : query
            ? "Nothing matches your search."
            : "Nothing here yet — create your first announcement."

  const overlays = (
    <>
      {composerOpen ? (
        <SheetDialog
          open
          onClose={closeComposer}
          onBack={closeComposer}
          showClose={false}
          actions={
            <SheetIconButton
              label={isPinned ? "Unpin from top" : "Pin to top"}
              onClick={() => setIsPinned((v) => !v)}
              className={isPinned ? "bg-neutral-100 text-brand-navy" : "text-neutral-400"}
            >
              <PinIcon className="size-5" strokeWidth={2} aria-hidden />
            </SheetIconButton>
          }
          titleClassName="text-center"
          title={<span className="inline-flex items-center gap-2"><MegaphoneIcon className="size-6" strokeWidth={2} aria-hidden />Announcement<span className="text-brand-orange">Details</span></span>}
          size="wide"
          footer={
            <div key={confirmingRemove ? "confirm" : "edit"} className="motion-safe:animate-slide-in-right">
              {confirmingRemove ? (
                <div className="flex items-center gap-2">
                  <SheetSecondaryButton className="h-11 w-auto flex-none px-6 text-[15px]" onClick={() => { setDeleteCountdown(null); setConfirmingRemove(false) }} disabled={deleting}>No</SheetSecondaryButton>
                  <SheetPrimaryButton tone="danger" onClick={() => { if (deleteCountdown != null) setDeleteCountdown(null); else setDeleteCountdown(3) }} disabled={deleting} className={`h-11 min-w-0 flex-1 gap-2 overflow-hidden whitespace-nowrap text-[15px] transition-[max-width] duration-500 ease-out ${deleteGrown ? "max-w-[999px]" : "max-w-11 px-0"}`}>
                    <Trash2Icon className="size-5 shrink-0" strokeWidth={2} aria-hidden />
                    <span className={`overflow-hidden tabular-nums transition-[max-width,opacity] delay-150 duration-300 ${deleteGrown ? "max-w-32 opacity-100" : "max-w-0 opacity-0"}`}>
                      {deleting ? "Deleting…" : deleteCountdown != null ? `Cancel ${deleteCountdown}s` : "Delete"}
                    </span>
                  </SheetPrimaryButton>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <SheetPrimaryButton
                    tone="accent"
                    disabled={formState.busy || !formState.canSave}
                    onClick={() => (document.getElementById("announcement-form") as HTMLFormElement | null)?.requestSubmit()}
                    className="h-11 min-w-0 flex-1 text-[15px]"
                  >
                    {formState.busy ? "Publishing…" : editTarget ? "Save changes" : "Publish"}
                  </SheetPrimaryButton>
                  {editTarget ? (
                    <SheetPrimaryButton tone="danger" aria-label="Remove announcement" onClick={() => setConfirmingRemove(true)} disabled={deleting || formState.busy} className="h-11 w-11 flex-none px-0 text-[15px]">
                      <Trash2Icon className="size-5" strokeWidth={2} aria-hidden />
                    </SheetPrimaryButton>
                  ) : (
                    <SheetSecondaryButton onClick={closeComposer} disabled={formState.busy} className="h-11 w-auto flex-none px-6 text-[15px]">Cancel</SheetSecondaryButton>
                  )}
                </div>
              )}
            </div>
          }
        >
          <ContentComposer
            key={editTarget?.id ?? "new"}
            initial={editTarget}
            areaContext={areaContext}
            isPinned={isPinned}
            onFormStateChange={setFormState}
            onSaved={() => {
              closeComposer()
              void load()
            }}
          />
        </SheetDialog>
      ) : null}
    </>
  )

  return (
    <ConfigShell
      embedded={embedded}
      hideEmbeddedAction={embedded}
      icon={MegaphoneIcon}
      eyebrow="Operations"
      title="Community Announcements"
      description="Create and manage advisories, schedules, affected areas, and resident-facing updates."
      stats={!embedded ? stats : undefined}
      action={<ConfigHeroAction icon={PlusIcon} onClick={openNew}>New announcement</ConfigHeroAction>}
    >
      {loading ? (
        <p className="py-14 text-center text-read text-neutral-400">Reading announcements…</p>
      ) : (
        <>
          <div className="space-y-4">
          <ConfigurationListToolbar
            search={query}
            onSearch={(value) => { setQuery(value); setOffset(0) }}
            placeholder="Search announcements"
            filters={[...TYPE_OPTIONS.map((o) => ({ key: o.key, label: o.label, count: typeCounts[o.key] })), { key: "__add", label: "Add an announcement" }]}
            activeFilter={typeFilter}
            onFilter={(value) => { if (value === "__add") { openNew(); return } setTypeFilter(value as TypeFilter); setOffset(0) }}
          />
          <div>
          {page.length === 0 ? (
            <div className="py-16 text-center">
              <MegaphoneIcon className="mx-auto size-7 text-neutral-300" aria-hidden />
              <h2 className="mt-4 text-row font-semibold text-brand-navy">{announcements.length ? "No announcements match this view" : "No announcements yet"}</h2>
              <p className="mt-2 text-read text-neutral-500">{emptyMessage}</p>
              <button type="button" onClick={announcements.length ? clearFilters : openNew} className="mt-5 font-semibold text-brand-navy underline underline-offset-4">
                {announcements.length ? "Show all announcements" : "New announcement"}
              </button>
            </div>
          ) : (
            <>
                  <ConfigurationTable label="Announcements" hideHeader>
                {page.map((item) => (
                  <ConfigurationTableRow
                    key={item.id}
                    actions={<SheetIconButton label={`Edit ${item.title}`} onClick={() => openEdit(item.id)} className="mr-1 size-8 text-neutral-400 hover:text-neutral-700">
                      <PencilLineIcon className="size-5" strokeWidth={1.9} aria-hidden />
                    </SheetIconButton>}
                  >
                    <div className="min-w-0 flex-1">
                        <p className="break-words text-[15px] leading-snug font-bold text-neutral-900">
                          {item.title}
                          {item.is_pinned ? <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-meta font-medium text-neutral-500">Pinned</span> : null}
                        </p>
                        <p className="mt-1 text-[13px] text-neutral-500">
                          <span className="text-neutral-400">{advisoryLabel(item.tag)}</span>{" "}{item.audience === "all" ? "All users" : item.audience === "residents" ? "Residents" : item.audience === "responders" ? "Responders" : "Officials"} · {item.affected_streets?.length ? item.affected_streets.join(" · ") : "Whole barangay"}
                        </p>
                    </div>
                  </ConfigurationTableRow>
                ))}
              </ConfigurationTable>
              <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="announcements" className="py-1" inline />
            </>
          )}
          </div>
          </div>
        </>
      )}
      {overlays}
    </ConfigShell>
  )
}
