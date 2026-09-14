import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Announcement } from "@/features/dashboard/api"
import { advisoryMeta } from "@/features/dashboard/components/community-content/advisory-tags"
import { AnnouncementComments } from "@/features/dashboard/components/home/announcement-comments"
import { AnnouncementSummary } from "@/features/dashboard/components/home/announcement-summary"
import { MediaLightbox } from "@/features/dashboard/components/authenticated-media"
import { announcementTitle } from "@/features/dashboard/lib/announcement-summary"

export function AnnouncementCarousel({
  announcements,
}: {
  announcements: Announcement[]
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLElement | null)[]>([])
  const [index, setIndex] = useState(0)
  const [trackHeight, setTrackHeight] = useState<number>()
  const [previewImage, setPreviewImage] = useState<{
    src: string
    alt: string
  } | null>(null)

  const count = announcements.length
  const active = count === 0 ? 0 : Math.min(index, count - 1)

  useLayoutEffect(() => {
    const slide = slideRefs.current[active]
    if (!slide) return
    const measure = () => setTrackHeight(slide.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(slide)
    return () => observer.disconnect()
  }, [active, count])

  useEffect(() => {
    slideRefs.current.length = count
  }, [count])

  if (count === 0) return null

  function go(next: number) {
    const clamped = Math.max(0, Math.min(count - 1, next))
    setIndex(clamped)
    const track = trackRef.current
    if (track) {
      track.scrollTo({ left: clamped * track.clientWidth, behavior: "smooth" })
    }
  }

  function onScroll() {
    const track = trackRef.current
    if (!track || track.clientWidth === 0) return
    setIndex(Math.round(track.scrollLeft / track.clientWidth))
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-300 bg-white lg:rounded-lg">
      <div
        ref={trackRef}
        onScroll={onScroll}
        style={trackHeight ? { height: trackHeight } : undefined}
        className="flex snap-x snap-mandatory [scrollbar-width:none] items-start overflow-x-auto overflow-y-hidden transition-[height] duration-200 ease-out [&::-webkit-scrollbar]:hidden"
      >
        {announcements.map((announcement, slot) => {
          const TagIcon = advisoryMeta(announcement.tag).icon
          return (
            <section
              key={announcement.id}
              ref={(node) => {
                slideRefs.current[slot] = node
              }}
              className="w-full shrink-0 snap-start"
              aria-label={announcementTitle(announcement)}
            >
              {announcement.image_url ? (
                <button
                  type="button"
                  onClick={() =>
                    setPreviewImage({
                      src: announcement.image_url!,
                      alt: announcement.image_alt || "",
                    })
                  }
                  aria-label="Preview image"
                  className="block w-full"
                >
                  <img
                    src={announcement.image_url}
                    alt={announcement.image_alt || ""}
                    loading="lazy"
                    className="h-auto w-full object-contain"
                  />
                </button>
              ) : null}

              <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-severity-low-surface text-severity-low">
                  <TagIcon className="size-5" strokeWidth={1.9} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mt-0.5 text-[15px] leading-tight font-semibold break-words text-neutral-900">
                    {announcementTitle(announcement)}
                  </p>
                </div>
              </div>

              <div className="space-y-1 px-3.5">
                <div className="space-y-1">
                  <p className="text-meta leading-tight text-neutral-500">
                    Posted on {announcement.date_label}
                  </p>
                  <p className="text-read leading-relaxed text-neutral-800">
                    {announcement.body}
                  </p>
                </div>
                <AnnouncementSummary announcement={announcement} />
              </div>

              <div className="px-3.5">
                <AnnouncementComments announcementId={announcement.id} />
              </div>
            </section>
          )
        })}
      </div>

      {count > 1 ? (
        <footer className="flex items-center gap-2 px-3.5 py-1">
          <div className="flex flex-1 items-center gap-1.5">
            {announcements.map((announcement, dot) => (
              <button
                key={announcement.id}
                type="button"
                onClick={() => go(dot)}
                aria-label={`Show announcement ${dot + 1}`}
                aria-current={dot === active}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  dot === active
                    ? "w-5 bg-neutral-800"
                    : "w-1.5 bg-neutral-300 hover:bg-neutral-400"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => go(active - 1)}
            disabled={active === 0}
            aria-label="Previous announcement"
            className="flex size-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-35"
          >
            <ChevronLeftIcon className="size-4.5" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => go(active + 1)}
            disabled={active === count - 1}
            aria-label="Next announcement"
            className="flex size-8 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-35"
          >
            <ChevronRightIcon className="size-4.5" strokeWidth={2.2} />
          </button>
        </footer>
      ) : null}

      {previewImage ? (
        <MediaLightbox
          items={[
            {
              src: previewImage.src,
              filename: previewImage.alt || "Announcement image",
              kind: "image",
            },
          ]}
          index={0}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
    </article>
  )
}
