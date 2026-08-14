import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeftIcon, MegaphoneIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

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
  ContentComposer,
  type ContentComposerHandle,
} from "@/features/dashboard/components/community-content/content-composer"
import { ContentList } from "@/features/dashboard/components/community-content/content-list"
import { FlagsQueue } from "@/features/dashboard/components/community-content/flags-queue"

export default function OfficialCommunityContentPage() {
  usePageTitle("Community Content")
  const navigate = useNavigate()

  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [flags, setFlags] = useState<ContentFlag[]>([])
  const [areaContext, setAreaContext] = useState<AnnouncementAreaContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyDelete, setBusyDelete] = useState("")
  const composerRef = useRef<ContentComposerHandle>(null)

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

  const scheduledCount = useMemo(
    () => announcements.filter((item) => item.is_published && item.status_label === "scheduled").length,
    [announcements],
  )
  const publishedCount = useMemo(
    () => announcements.filter((item) => item.is_published).length,
    [announcements],
  )
  const draftCount = useMemo(
    () => announcements.filter((item) => !item.is_published).length,
    [announcements],
  )
  const pendingFlagCount = useMemo(
    () => flags.filter((flag) => flag.status === "submitted").length,
    [flags],
  )

  function editItem(id: number) {
    const target = announcements.find((item) => item.id === id)
    if (target) composerRef.current?.editAnnouncement(target)
  }

  async function deleteItem(id: number) {
    setBusyDelete(`announcement-${id}`)
    try {
      await deleteManagedAnnouncement(id)
      setAnnouncements((list) => list.filter((item) => item.id !== id))
      toast.success("Announcement deleted")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.")
    } finally {
      setBusyDelete("")
    }
  }

  return (
    <main className="min-h-full flex-1 bg-canvas p-4 pb-28 md:p-6 md:pb-6 lg:p-8">
      <header className="relative overflow-hidden rounded-2xl border border-line-tint bg-white p-5 md:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-brand-orange-soft blur-3xl"
        />
        <button
          type="button"
          onClick={() => navigate("/dashboard/reports")}
          className="relative flex items-center gap-2 text-xs font-semibold text-brand-blue transition-colors hover:text-brand-orange"
        >
          <ArrowLeftIcon className="size-4" />
          Back to concerns
        </button>
        <p className="relative mt-5 text-[12px] font-semibold text-brand-orange">
          Community content
        </p>
        <h1 className="relative mt-1 text-2xl font-semibold text-brand-navy md:text-3xl">
          What the barangay is telling residents
        </h1>
        <p className="relative mt-2 max-w-3xl text-sm font-semibold leading-6 text-subtle-foreground">
          Post advisories for residents, mark the streets they affect on the map, and review flagged
          content in one place.
        </p>

        <div className="relative mt-5 flex flex-wrap gap-2">
          {[
            { label: "Published", value: publishedCount },
            { label: "Scheduled", value: scheduledCount },
            { label: "Drafts", value: draftCount },
            { label: "Pending reports", value: pendingFlagCount },
          ].map((stat) => (
            <span
              key={stat.label}
              className="inline-flex items-center gap-2 rounded-full border border-line-tint bg-white/80 px-3 py-1.5 text-xs font-bold text-navy-muted"
            >
              <span className="tabular-nums font-semibold text-brand-navy">{stat.value}</span>
              {stat.label}
            </span>
          ))}
        </div>
      </header>

      <div className="mt-5 grid gap-5 2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <div className="grid gap-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-line-tint bg-white p-10">
              <div className="flex items-center gap-2">
                <MegaphoneIcon className="size-4 animate-pulse text-brand-orange" />
                <span className="text-sm font-semibold text-subtle-foreground">Loading community content…</span>
              </div>
            </div>
          ) : (
            <>
              <ContentComposer
                composerRef={composerRef}
                areaContext={areaContext}
                onSaved={() => void load()}
              />
              <ContentList
                items={items}
                areaContext={areaContext}
                onEdit={editItem}
                onDelete={(id) => void deleteItem(id)}
                deletingKey={busyDelete}
              />
            </>
          )}
        </div>

        <FlagsQueue flags={flags} onFlagsChange={setFlags} />
      </div>
    </main>
  )
}
