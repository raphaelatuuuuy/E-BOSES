import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, GlobeIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Announcement } from "@/features/dashboard/api"
import { advisoryMeta } from "@/features/dashboard/components/community-content/advisory-tags"
import { AnnouncementComments } from "@/features/dashboard/components/home/announcement-comments"

export function AnnouncementCarousel({ announcements }: { announcements: Announcement[] }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const slideRefs = useRef<(HTMLElement | null)[]>([])
  const [index, setIndex] = useState(0)
  const [trackHeight, setTrackHeight] = useState<number>()

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
      <header className="flex items-center gap-2 border-b border-neutral-300 px-3.5 py-2.5">
        <GlobeIcon className="size-4 shrink-0 text-neutral-500" strokeWidth={2.1} />
        <p className="text-[13px] font-bold text-neutral-900">Barangay announcements</p>
        <span className="ml-auto text-[12px] font-semibold tabular-nums text-neutral-500">
          {active + 1} / {count}
        </span>
      </header>

      <div
        ref={trackRef}
        onScroll={onScroll}
        style={trackHeight ? { height: trackHeight } : undefined}
        className="flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden transition-[height] duration-200 ease-out [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {announcements.map((announcement, slot) => {
          const meta = advisoryMeta(announcement.tag)
          const TagIcon = meta.icon
          return (
            <section
              key={announcement.id}
              ref={(node) => {
                slideRefs.current[slot] = node
              }}
              className="w-full shrink-0 snap-start"
              aria-label={announcement.title}
            >
              <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600">
                  <TagIcon className="size-5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold leading-tight text-neutral-900">
                    Barangay Hall
                  </p>
                  {/* One meta line, one format, everywhere an announcement
                      appears: source · date · streets. */}
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-meta leading-tight text-neutral-500">
                    <span>{announcement.date_label}</span>
                    {announcement.affected_streets?.length ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>{announcement.affected_streets.join(" · ")}</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>

              <div className="space-y-2 px-3.5 pb-2.5">
                <h3 className="text-row font-semibold leading-snug text-neutral-900">
                  {announcement.title}
                </h3>
                <p className="text-read leading-relaxed text-neutral-800">{announcement.body}</p>
              </div>

              {announcement.image_url ? (
                <img
                  src={announcement.image_url}
                  alt={announcement.image_alt || ""}
                  loading="lazy"
                  className="max-h-80 w-full border-y border-neutral-300 object-cover"
                />
              ) : null}

              <div className="px-3.5 pb-3 pt-2.5">
                <AnnouncementComments announcementId={announcement.id} />
              </div>
            </section>
          )
        })}
      </div>

      {count > 1 ? (
        <footer className="flex items-center gap-2 border-t border-neutral-300 px-3.5 py-2">
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
                  dot === active ? "w-5 bg-neutral-800" : "w-1.5 bg-neutral-300 hover:bg-neutral-400",
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
    </article>
  )
}
