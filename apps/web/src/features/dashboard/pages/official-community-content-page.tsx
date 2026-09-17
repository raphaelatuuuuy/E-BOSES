import { useCallback, useEffect, useMemo, useState } from "react"
import {
  MegaphoneIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  SendIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
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
  ConfigurationInfoRow,
  ConfigurationTable,
} from "@/features/dashboard/components/config/configuration-table"
import {
  SheetDialog,
  SheetIconButton,
  SheetPrimaryButton,
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
  const [published, setPublished] = useState(false)
  const [isPinned, setIsPinned] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)
  const [deleting, setDeleting] = useState(false)

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
    setPublished(false)
    setIsPinned(false)
    setComposerOpen(true)
  }

  useEffect(() => {
    if (!embedded) return
    window.addEventListener("configuration-primary-action", openNew)
    return () => window.removeEventListener("configuration-primary-action", openNew)
  })

  function openEdit(id: number) {
    const target = announcements.find((item) => item.id === id)
    if (target) {
      setEditTarget(target)
      setPublished(target.is_published)
      setIsPinned(target.is_pinned)
    }
    setComposerOpen(true)
  }

  function closeComposer() {
    setComposerOpen(false)
    setEditTarget(null)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteManagedAnnouncement(deleteTarget.id)
      toast.success("Announcement deleted")
      setDeleteTarget(null)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.")
    } finally {
      setDeleting(false)
    }
  }

  function handleDelete(id: number) {
    const target = announcements.find((item) => item.id === id)
    if (target) setDeleteTarget(target)
  }

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
          title={editTarget ? "Edit announcement" : "New announcement"}
          description="What residents need to know, and where it applies."
          size="wide"
          actions={
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-neutral-400">{published ? "Published" : "Draft"}</span>
              <div role="radiogroup" aria-label="Publish status" className="flex items-center gap-0.5 rounded-full bg-neutral-100 p-1">
                {([
                  [false, PencilIcon, "Draft"],
                  [true, SendIcon, "Publish now"],
                ] as const).map(([value, Icon, label]) => {
                  const active = published === value
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={label}
                      title={label}
                      onClick={() => setPublished(value)}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-full transition-colors",
                        active
                          ? "bg-white/70 text-neutral-900 shadow-sm"
                          : "text-neutral-400 hover:bg-white/60 hover:text-neutral-900",
                      )}
                    >
                      <Icon className="size-[18px]" aria-hidden />
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                aria-label="Configure announcement"
                title="Configure"
                onClick={() => setConfigureOpen(true)}
                className="flex size-9 items-center justify-center rounded-full text-neutral-900 transition-colors hover:bg-neutral-100"
              >
                <SlidersHorizontalIcon className="size-[18px]" aria-hidden />
              </button>
            </div>
          }
        >
          <ContentComposer
            key={editTarget?.id ?? "new"}
            initial={editTarget}
            areaContext={areaContext}
            published={published}
            isPinned={isPinned}
            onPinnedChange={setIsPinned}
            configureOpen={configureOpen}
            onConfigureOpenChange={setConfigureOpen}
            onSaved={() => {
              closeComposer()
              void load()
            }}
            onClose={closeComposer}
          />
        </SheetDialog>
      ) : null}

      <SheetDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete "${deleteTarget.title}"?` : ""}
        description="Residents will no longer see this announcement, and it will leave the content list. This cannot be undone."
        footer={
          <div className="flex gap-2">
            <SheetPrimaryButton
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
              className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]"
            >
              Cancel
            </SheetPrimaryButton>
            <SheetPrimaryButton
              tone="danger"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="flex-1 text-[15px]"
            >
              {deleting ? "Deleting…" : "Delete announcement"}
            </SheetPrimaryButton>
          </div>
        }
      />
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
          <ConfigurationListToolbar
            search={query}
            onSearch={(value) => { setQuery(value); setOffset(0) }}
            placeholder="Search announcements"
            filters={TYPE_OPTIONS.map((o) => ({ key: o.key, label: o.label, count: typeCounts[o.key] }))}
            activeFilter={typeFilter}
            onFilter={(value) => { setTypeFilter(value as TypeFilter); setOffset(0) }}
          />
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
                  <ConfigurationInfoRow
                    key={item.id}
                    icon={MegaphoneIcon}
                    title={item.title}
                    subtext={advisoryLabel(item.tag)}
                    badge={item.is_pinned ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-meta font-medium text-neutral-500">Pinned</span> : null}
                    description={<>{item.audience === "all" ? "All users" : item.audience === "residents" ? "Residents" : item.audience === "responders" ? "Responders" : "Officials"} · {item.affected_streets?.length ? item.affected_streets.join(" · ") : "Whole barangay"}</>}
                    actions={<>
                      <SheetIconButton label={`Edit ${item.title}`} onClick={() => openEdit(item.id)}>
                        <PencilLineIcon className="size-5" strokeWidth={1.8} aria-hidden />
                      </SheetIconButton>
                      <SheetIconButton label={`Remove ${item.title}`} onClick={() => handleDelete(item.id)} className="text-neutral-500 hover:text-sos">
                        <Trash2Icon className="size-5" strokeWidth={1.8} aria-hidden />
                      </SheetIconButton>
                    </>}
                  />
                ))}
              </ConfigurationTable>
              <ConfigurationPager key={offset} offset={offset} total={filtered.length} onChange={setOffset} noun="announcements" />
            </>
          )}
        </>
      )}
      {overlays}
    </ConfigShell>
  )
}
