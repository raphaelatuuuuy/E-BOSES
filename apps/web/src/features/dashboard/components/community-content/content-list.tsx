import { useMemo, useState } from "react"
import { ChevronDownIcon, MapPinIcon, MegaphoneIcon, PencilIcon, Trash2Icon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { Announcement, AnnouncementAreaContext } from "@/features/dashboard/api"
import { StateMarker, type StateTone } from "@/components/ui/state-marker"
import { advisoryMeta } from "./advisory-tags"
import { AreaPreview } from "./area-preview"

export type ContentListItem = { kind: "announcement"; item: Announcement }

type FilterKey = "all" | "published" | "scheduled" | "drafts"

/**
 * Publication state, as a marker and a word rather than a coloured pill.
 *
 * "Pinned" is not a state — it was concatenated into the pill, so a pinned
 * draft and a published advisory read as the same kind of object. It is a
 * separate, quieter note.
 */
function StateNote({ status, pinned }: { status: string; pinned?: boolean }) {
  const tone: StateTone =
    status === "published" ? "active" : status === "scheduled" ? "open" : "closed"
  const label = status.replace(/_/g, " ")
  return (
    <span className="flex shrink-0 items-center gap-2">
      <StateMarker tone={tone} label={label.charAt(0).toUpperCase() + label.slice(1)} />
      {pinned ? <span className="text-meta text-neutral-400">Pinned</span> : null}
    </span>
  )
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "scheduled", label: "Scheduled" },
  { key: "drafts", label: "Drafts" },
]

function matchesFilter(item: Announcement, filter: FilterKey) {
  if (filter === "all") return true
  if (filter === "drafts") return !item.is_published
  if (filter === "published") return item.is_published && (item.status_label === "published" || item.status_label === "expired")
  if (filter === "scheduled") return item.status_label === "scheduled"
  return false
}

export function ContentList({
  items,
  areaContext,
  onEdit,
  onDelete,
  deletingKey = "",
}: {
  items: ContentListItem[]
  areaContext: AnnouncementAreaContext | null
  onEdit: (id: number) => void
  onDelete: (id: number) => void
  deletingKey?: string
}) {
  const [filter, setFilter] = useState<FilterKey>("all")
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const time = (item: Announcement) =>
        new Date(item.created_at ?? item.updated_at ?? item.starts_at ?? 0).getTime()
      return time(b.item) - time(a.item)
    })
    return sorted.filter((entry) => matchesFilter(entry.item, filter))
  }, [items, filter])

  const counts = useMemo(() => {
    const total = items.length
    const published = items.filter((entry) => entry.item.is_published).length
    const scheduled = items.filter((entry) => entry.item.status_label === "scheduled").length
    const drafts = total - published
    return { total, published, scheduled, drafts }
  }, [items])

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-line-tint bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-tint text-brand-blue">
            <MegaphoneIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-brand-navy">Community content</h2>
            <p className="text-xs font-semibold text-subtle-foreground">Advisories for residents</p>
          </div>
        </div>
        <p className="mt-5 rounded-xl border border-dashed border-line-tint p-6 text-center text-sm font-semibold text-subtle-foreground">
          Nothing here yet — create your first announcement above.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-line-tint bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-tint text-brand-blue">
            <MegaphoneIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold text-brand-navy">Community content</h2>
            <p className="text-xs font-semibold text-subtle-foreground">
              {counts.total} item{counts.total === 1 ? "" : "s"} · {counts.published} published · {counts.drafts} draft
              {counts.drafts === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-canvas p-1">
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                filter === option.key ? "bg-white text-brand-navy shadow-sm" : "text-navy-muted hover:text-brand-navy",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 divide-y divide-line-tint overflow-hidden rounded-xl border border-line-tint">
        {filtered.map((entry) => {
          const item = entry.item
          const key = `announcement-${item.id}`
          const isExpanded = expanded === key
          const TagIcon = advisoryMeta(item.tag).icon
          const hasArea = (item.affected_streets?.length ?? 0) > 0 || item.area_geometry != null

          return (
            <div key={key} className="bg-white transition-colors hover:bg-neutral-50">
              <div className="flex items-center gap-4 px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
                  <TagIcon className="size-5" strokeWidth={1.8} />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-row font-semibold text-brand-navy">{item.title}</p>
                  <p className="mt-1 truncate text-meta text-neutral-500">
                    {item.date_label}
                    {item.affected_streets?.length
                      ? ` · ${item.affected_streets.join(" · ")}`
                      : ""}
                  </p>
                </div>

                <StateNote status={item.status_label} pinned={item.is_pinned} />

                <div className="flex shrink-0 items-center gap-1.5">
                  {hasArea ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? null : key)}
                      className="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-meta font-medium text-neutral-600 transition-colors hover:bg-neutral-100"
                    >
                      <MapPinIcon className="size-4 text-neutral-400" strokeWidth={1.9} />
                      Area
                      <ChevronDownIcon className={cn("size-4 transition-transform", isExpanded && "rotate-180")} />
                    </button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(item.id)}
                    className="h-9 px-3"
                  >
                    <PencilIcon className="size-4" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={deletingKey === key}
                    onClick={() => onDelete(item.id)}
                    className="h-9 px-3 text-destructive"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </div>

              {isExpanded && item.area_geometry ? (
                <AreaPreviewRow
                  geometry={item.area_geometry}
                  boundary={areaContext?.boundary ?? null}
                  affectedStreets={item.affected_streets ?? []}
                  areaContext={areaContext}
                  tag={item.tag}
                />
              ) : null}
            </div>
          )
        })}

        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm font-semibold text-subtle-foreground">
            No items match this filter.
          </p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Expanded row: the drawn area on a read-only map plus affected-street chips.
 * Extracted so the streets prop for the map is memoized — building it inline
 * created a fresh array every render, remounting the Leaflet map on every
 * parent re-render.
 */
function AreaPreviewRow({
  geometry,
  boundary,
  affectedStreets,
  areaContext,
  tag,
}: {
  geometry: NonNullable<ContentListItem["item"]["area_geometry"]>
  boundary: AnnouncementAreaContext["boundary"] | null
  affectedStreets: string[]
  areaContext: AnnouncementAreaContext | null
  tag: string
}) {
  const streets = useMemo(
    () =>
      affectedStreets.map((name) => ({
        name,
        geometries:
          areaContext?.streets.streets.find((street) => street.name === name)?.geometries ?? [],
      })),
    [affectedStreets, areaContext],
  )

  return (
    <div className="px-4 pb-4">
      <AreaPreview geometry={geometry} boundary={boundary} streets={streets} tag={tag} />
      {affectedStreets.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {affectedStreets.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-brand-orange/30 bg-brand-orange-soft px-2 py-0.5 text-[10.5px] font-bold text-severity-high-ink"
            >
              <MapPinIcon className="size-3" />
              {name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
