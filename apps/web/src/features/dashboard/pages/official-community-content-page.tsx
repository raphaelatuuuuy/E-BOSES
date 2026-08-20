import { useCallback, useEffect, useMemo, useState } from "react"
import { MegaphoneIcon, PencilIcon, PlusIcon, SendIcon, SlidersHorizontalIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import {
  deleteManagedAnnouncement,
  getAnnouncementAreaContext,
  listContentFlags,
  listManagedAnnouncements,
  type Announcement,
  type AnnouncementAreaContext,
  type ContentFlag,
} from "@/features/dashboard/api"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  ConfigBreadcrumb,
  ConfigHeroAction,
} from "@/features/dashboard/components/config/config-shell"
import {
  SheetDialog,
  SheetPrimaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import { ContentComposer } from "@/features/dashboard/components/community-content/content-composer"
import { ContentList } from "@/features/dashboard/components/community-content/content-list"

interface Stat {
  label: string
  value: number
  alarm?: boolean
}

export default function OfficialCommunityContentPage() {
  usePageTitle("Community Content")

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [flags, setFlags] = useState<ContentFlag[]>([])
  const [areaContext, setAreaContext] = useState<AnnouncementAreaContext | null>(null)
  const [loading, setLoading] = useState(true)
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
      const [nextAnnouncements, nextFlags, nextContext] = await Promise.all([
        listManagedAnnouncements(),
        listContentFlags(),
        getAnnouncementAreaContext().catch(() => null),
      ])
      setAnnouncements(nextAnnouncements)
      setFlags(nextFlags)
      setAreaContext(nextContext)
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

  const items = useMemo(
    () => announcements.map((item) => ({ kind: "announcement" as const, item })),
    [announcements],
  )

  const stats: Stat[] = useMemo(() => {
    const published = announcements.filter((item) => item.is_published).length
    const scheduled = announcements.filter((item) => item.status_label === "scheduled").length
    const drafts = announcements.filter((item) => !item.is_published).length
    const pending = flags.filter((flag) => flag.status === "submitted").length
    return [
      { label: "Published", value: published },
      { label: "Scheduled", value: scheduled },
      { label: "Drafts", value: drafts },
      { label: "Flagged concerns", value: flags.length, alarm: pending > 0 },
    ]
  }, [announcements, flags])

  function openNew() {
    setEditTarget(null)
    setPublished(false)
    setIsPinned(false)
    setComposerOpen(true)
  }

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

  return (
    <div className="min-h-full bg-white">
      <div className="mx-auto w-full max-w-[1100px] px-6 pt-10 pb-40 sm:px-10 sm:pb-28">
        <ConfigBreadcrumb
          trail={[
            { label: "Concerns", to: "/dashboard/reports" },
            { label: "Community Content" },
          ]}
        />

        <header className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <div className="flex min-w-0 items-start gap-6 sm:flex-1">
            <span className="hidden size-16 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white sm:flex">
              <MegaphoneIcon className="size-7" strokeWidth={1.7} aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="text-page-title text-balance text-brand-navy">
                Community Content
              </h1>
              <p className="mt-3 max-w-2xl text-read leading-relaxed text-neutral-500">
                Post advisories, mark the streets they affect, and review flagged
                content in one place.
              </p>
            </div>
          </div>

          <div className="shrink-0 [&>*]:w-full sm:[&>*]:w-auto">
            <ConfigHeroAction icon={PlusIcon} onClick={openNew}>
              New announcement
            </ConfigHeroAction>
          </div>
        </header>

        <dl className="mt-10 flex flex-wrap gap-x-12 gap-y-6">
          {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dd
                className={cn(
                  "text-[1.75rem] leading-none tabular-nums font-light tracking-tight",
                  stat.alarm ? "text-sos" : "text-brand-navy",
                )}
              >
                {stat.value}
              </dd>
              <dt className="mt-2 text-meta text-neutral-500">{stat.label}</dt>
            </div>
          ))}
        </dl>

        {loading ? (
          <p className="mt-12 py-14 text-center text-read text-neutral-400">
            Reading announcements…
          </p>
        ) : (
          <div className="mt-12">
            <ContentList
              items={items}
              flags={flags}
              areaContext={areaContext}
              onEdit={openEdit}
              onFlagsChange={setFlags}
              onDelete={(id) => {
                const target = announcements.find((item) => item.id === id)
                if (target) setDeleteTarget(target)
              }}
            />
          </div>
        )}
      </div>

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
                      <Icon className="size-[18px]" />
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
                <SlidersHorizontalIcon className="size-[18px]" />
              </button>
            </div>
          }
        >
          <ContentComposer
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
        title={deleteTarget ? `Delete “${deleteTarget.title}”?` : ""}
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
    </div>
  )
}
