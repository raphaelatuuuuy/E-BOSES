import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronDownIcon, ChevronUpIcon, CircleCheck, FileX, MapPinIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import { ListSearch, Pager, PAGE_SIZE } from "@/components/ui/list-controls"
import { isResolvedRecord } from "@/features/dashboard/components/alerts-map/lib"
import {
  getConcern,
  reviewContentFlag,
  type Announcement,
  type AnnouncementAreaContext,
  type Concern,
  type ContentFlag,
} from "@/features/dashboard/api"
import {
  concernCategoryLabel,
  formatDate,
} from "@/features/dashboard/components/concerns/concern-display"
import {
  SheetDialog,
  SheetPrimaryButton,
  SheetSectionLabel,
  SheetSecondaryButton,
  SheetTextarea,
} from "@/features/dashboard/components/sheet-dialog"
import { advisoryLabel, advisoryMeta } from "./advisory-tags"
import { AreaPreview } from "./area-preview"
import { UserAvatar } from "@/features/dashboard/components/home/user-avatar"
import {
  MediaLightbox,
} from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"

export type ContentListItem = { kind: "announcement"; item: Announcement }

type TypeFilter = "all" | "published" | "scheduled" | "drafts" | "flag-reports"

const AUDIENCE_LABELS: Record<Announcement["audience"], string> = {
  all: "All users",
  residents: "Residents",
  responders: "Responders",
  officials: "Officials",
}

/** "false_info" → "False Info". */
function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const factClass = {
  dt: "text-meta text-neutral-400",
  dd: "mt-0.5 text-meta text-brand-navy",
} as const

const REASON_LABELS: Record<ContentFlag["reason"], string> = {
  irrelevant: "Irrelevant",
  false_info: "False information",
  sensitive: "Sensitive content",
  abusive: "Abusive or harassing",
  other: "Other",
}

const NOTE_SEPARATOR = " — "

function flagNoteParts(flag: ContentFlag) {
  const index = flag.note.indexOf(NOTE_SEPARATOR)
  if (index === -1) return { title: REASON_LABELS[flag.reason], note: flag.note }
  return {
    title: flag.note.slice(0, index),
    note: flag.note.slice(index + NOTE_SEPARATOR.length),
  }
}

function decisionOptions(noun: string) {
  return [
    { key: "dismissed", label: "Dismiss", hint: `Keep the ${noun}, close this report` },
    { key: "taken_down", label: "Take down", hint: `Remove the ${noun}` },
  ] as const
}

type CombinedRow =
  | { kind: "announcement"; key: string; item: Announcement }
  | { kind: "flag"; key: string; flag: ContentFlag }

export function ContentList({
  items,
  flags,
  areaContext,
  onEdit,
  onDelete,
  onFlagsChange,
}: {
  items: ContentListItem[]
  flags: ContentFlag[]
  areaContext: AnnouncementAreaContext | null
  onEdit: (id: number) => void
  onDelete: (id: number) => void
  onFlagsChange: (next: ContentFlag[]) => void
}) {
  const navigate = useNavigate()
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState("")
  const [reviewTarget, setReviewTarget] = useState<ContentFlag | null>(null)
  const [decision, setDecision] = useState<"dismissed" | "taken_down" | null>(null)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [confirmTakeDown, setConfirmTakeDown] = useState(false)
  const decisionRef = useRef<HTMLDivElement>(null)
  const decisionTriggerRef = useRef<HTMLButtonElement>(null)
  const decisionOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (decisionRef.current && !decisionRef.current.contains(e.target as Node)) {
        setDecisionOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])
  const [concern, setConcern] = useState<Concern | null>(null)
  const [mediaPreview, setMediaPreview] = useState<{
    items: MediaPreviewItem[]
    index: number
  } | null>(null)
  const [concernLoading, setConcernLoading] = useState(false)
  const [concernError, setConcernError] = useState("")
  // A post that is already resolved or rejected cannot be taken down again.
  const concernClosed =
    !!concern && (isResolvedRecord(concern) || concern.status === "rejected")

  // A new filter or search starts back at page one.
  useEffect(() => {
    // This is a deliberate local pagination reset when the query changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOffset(0)
  }, [typeFilter, query])

  // Reset the decision picker each time the review dialog opens or closes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDecision(null)
    setDecisionOpen(false)
    setConfirmTakeDown(false)
  }, [reviewTarget])

  // Fetch the original report when the review dialog opens on a post-level
  // flag, so the official can see the full report without leaving the
  // dialog. Comment-level flags (of any kind) already carry everything the
  // dialog needs in `target` — no fetch required.
  useEffect(() => {
    if (!reviewTarget || reviewTarget.target.kind !== "concern" || reviewTarget.concern == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConcern(null)
      setConcernError("")
      return
    }
    let cancelled = false
    setConcernLoading(true)
    setConcernError("")
    setConcern(null)
    getConcern(reviewTarget.concern)
      .then((data) => {
        if (!cancelled) setConcern(data)
      })
      .catch(() => {
        if (!cancelled) setConcernError("Could not load the original report.")
      })
      .finally(() => {
        if (!cancelled) setConcernLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reviewTarget])

  const typeOptions: { key: TypeFilter; label: string }[] = useMemo(
    () => [
      { key: "all", label: "All" },
      { key: "published", label: "Published" },
      { key: "scheduled", label: "Scheduled" },
      { key: "drafts", label: "Drafts" },
      { key: "flag-reports", label: "Flagged concerns" },
    ],
    [],
  )

  const typeCounts = useMemo(() => {
    const published = items.filter((entry) => entry.item.is_published).length
    const scheduled = items.filter((entry) => entry.item.status_label === "scheduled").length
    const drafts = items.filter((entry) => !entry.item.is_published).length
    return {
      all: items.length + flags.length,
      published,
      scheduled,
      drafts,
      "flag-reports": flags.length,
    }
  }, [items, flags])

  const rows = useMemo<CombinedRow[]>(() => {
    const q = query.trim().toLowerCase()
    const showFlags = typeFilter === "all" || typeFilter === "flag-reports"
    const announcements: CombinedRow[] = items
      .filter((entry) => {
        if (typeFilter === "flag-reports") return false
        if (typeFilter === "all") return true
        if (typeFilter === "drafts") return !entry.item.is_published
        if (typeFilter === "published") {
          return (
            entry.item.is_published &&
            (entry.item.status_label === "published" || entry.item.status_label === "expired")
          )
        }
        if (typeFilter === "scheduled") return entry.item.status_label === "scheduled"
        return false
      })
      .filter(
        (entry) =>
          !q ||
          `${entry.item.title} ${entry.item.body} ${entry.item.tag}`
            .toLowerCase()
            .includes(q),
      )
      .map((entry) => ({ kind: "announcement", key: `announcement-${entry.item.id}`, item: entry.item }))
    const flagRows: CombinedRow[] = showFlags
      ? flags
          .filter((flag) => !q || `${flag.reason} ${flag.note}`.toLowerCase().includes(q))
          .map((flag) => ({ kind: "flag", key: `flag-${flag.id}`, flag }))
      : []
    return [...announcements, ...flagRows].sort((a, b) => {
      const time = (row: CombinedRow) =>
        row.kind === "announcement"
          ? new Date(row.item.created_at ?? row.item.updated_at ?? 0).getTime()
          : new Date(row.flag.created_at ?? 0).getTime()
      return time(b) - time(a)
    })
  }, [items, flags, typeFilter, query])

  const page = rows.slice(offset, offset + PAGE_SIZE)

  async function decide(flag: ContentFlag, status: "dismissed" | "taken_down") {
    const note = (notes[flag.id] || "").trim()
    if (note.length < 5) {
      toast.error("Add a decision note with at least 5 characters.")
      return
    }
    setBusy(`flag-${flag.id}`)
    try {
      const next = await reviewContentFlag(flag.id, { status, staff_note: note })
      onFlagsChange(flags.map((item) => (item.id === next.id ? next : item)))
      setNotes((current) => ({ ...current, [flag.id]: "" }))
      setReviewTarget(null)
      toast.success(status === "taken_down" ? "Post taken down" : "Flag report dismissed")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review content report.")
    } finally {
      setBusy("")
    }
  }

  const isCommentFlag = reviewTarget != null && reviewTarget.target.kind !== "concern"
  const takeDownNoun = isCommentFlag ? "comment" : "post"

  const emptyMessage =
    typeFilter === "flag-reports"
      ? "No flagged concerns yet."
      : typeFilter === "published"
        ? "No published announcements yet."
        : typeFilter === "scheduled"
          ? "No scheduled announcements."
          : typeFilter === "drafts"
            ? "No drafts yet."
            : query
              ? "Nothing matches your search."
              : "Nothing here yet — create your first announcement."

  return (
    <>
      {/* Search, with the filters on its right. */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search announcements and reports"
          className="flex-1 sm:max-w-xs"
        />
        <div className="flex items-center gap-6 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {typeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTypeFilter(option.key)}
              className={
                typeFilter === option.key
                  ? "shrink-0 text-read font-medium text-brand-navy"
                  : "shrink-0 text-read text-neutral-400 hover:text-brand-navy"
              }
            >
              {option.label}
              <span className="ml-1.5 tabular-nums text-neutral-400">
                {typeCounts[option.key] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {rows.length === 0 ? (
          <p className="py-14 text-center text-read text-neutral-500">{emptyMessage}</p>
        ) : (
          <>
            <div className="divide-y divide-neutral-200">
              {page.map((row) =>
                row.kind === "announcement" ? (
                  <AnnouncementRow
                    key={row.key}
                    item={row.item}
                    areaContext={areaContext}
                    expandedKey={expanded}
                    onToggleArea={(key) => setExpanded((current) => (current === key ? null : key))}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ) : (
                  <FlagRow
                    key={row.key}
                    flag={row.flag}
                    onReview={() => setReviewTarget(row.flag)}
                    onOpen={
                      row.flag.concern != null
                        ? () => navigate(`/dashboard/reports/${row.flag.concern}`)
                        : null
                    }
                  />
                ),
              )}
            </div>

            <Pager offset={offset} total={rows.length} onChange={setOffset} noun="items" />
          </>
        )}
      </div>

      <SheetDialog
        open={Boolean(reviewTarget)}
        onClose={() => setReviewTarget(null)}
        title="Flagged concern"
        size="wide"
      >
        {reviewTarget ? (
          <div className="space-y-6">
            <SheetSectionLabel>Original post</SheetSectionLabel>
            {concernLoading ? (
              <p className="py-6 text-center text-meta text-neutral-400">
                Loading the original report…
              </p>
            ) : concernError ? (
              <p className="rounded-xl bg-neutral-50 px-4 py-3 text-meta text-neutral-500">
                {concernError}
              </p>
            ) : concern ? (
              <div className="overflow-hidden rounded-[18px] bg-neutral-50">
                <div className="px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 text-meta text-neutral-500">
                      <UserAvatar user={concern.reporter} size="sm" className="!size-6 text-[12px]" />
                      <span className="truncate">
                        Posted by {concern.reporter_full_name || concern.reporter.full_name}
                      </span>
                    </p>
                    <span className="shrink-0 text-meta text-neutral-400">
                      {formatDate(concern.created_at)}
                    </span>
                  </div>
                  <h3 className="mt-3 text-section font-medium leading-snug text-brand-navy">
                    {concern.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-meta text-neutral-500">
                      {concernCategoryLabel(concern)}
                    </span>
                    {concern.address ? (
                      <>
                        <span className="text-meta text-neutral-300">·</span>
                        <span className="flex items-center gap-1 text-meta text-neutral-500">
                          <MapPinIcon className="size-3.5 shrink-0 text-neutral-400" />
                          {concern.address}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-3 text-read leading-relaxed text-neutral-700">
                    {concern.description}
                  </p>
                  {concern.media.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {concern.media.slice(0, 4).map((media, index) => (
                        <button
                          key={media.id}
                          type="button"
                          onClick={() =>
                            setMediaPreview({
                              items: concern.media.map((item) =>
                                toMediaPreviewItem(
                                  mediaDisplaySource(item),
                                  item.original_filename,
                                  item.mime_type,
                                ),
                              ),
                              index,
                            })
                          }
                          className="block cursor-zoom-in overflow-hidden rounded-lg"
                        >
                          <img
                            src={media.preview_url || media.raw_url}
                            alt={media.original_filename || ""}
                            className="h-28 w-40 object-cover transition-transform duration-200 hover:scale-[1.03]"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : isCommentFlag ? (
              <div className="overflow-hidden rounded-[18px] bg-neutral-50">
                <div className="px-4 py-4">
                  <p className="text-meta text-neutral-500">
                    {reviewTarget.target.post_title
                      ? `Comment on “${reviewTarget.target.post_title}”`
                      : "Flagged comment"}
                  </p>
                  <p className="mt-3 text-read leading-relaxed text-neutral-700">
                    “{reviewTarget.target.excerpt}”
                  </p>
                  <p className="mt-2 text-meta text-neutral-400">
                    — {reviewTarget.target.author_name}
                  </p>
                </div>
              </div>
            ) : null}

            <SheetSectionLabel>Reason for flagging</SheetSectionLabel>
            {(() => {
              const parts = flagNoteParts(reviewTarget)
              return (
                <div className="overflow-hidden rounded-[18px] bg-neutral-50">
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-meta text-neutral-500">
                        <UserAvatar
                          user={reviewTarget.reporter}
                          size="sm"
                          className="!size-6 text-[12px]"
                        />
                        <span className="truncate">
                          Flagged by {reviewTarget.reporter_full_name || reviewTarget.reporter.full_name}
                        </span>
                      </p>
                      <span className="shrink-0 text-meta text-neutral-400">
                        {formatDate(reviewTarget.created_at)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-section font-medium leading-snug text-brand-navy">
                      {parts.title}
                    </h3>
                    {parts.note ? (
                      <p className="mt-3 text-read leading-relaxed text-neutral-700">
                        {parts.note}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            })()}

            <div>
              <p className="mb-2 text-[13px] font-semibold text-neutral-500">
                Official decision note
              </p>
              <SheetTextarea
                value={notes[reviewTarget.id] || ""}
                onChange={(value) =>
                  setNotes((current) => ({ ...current, [reviewTarget.id]: value }))
                }
                max={255}
                rows={2}
                placeholder="Add a note for the record"
              />
            </div>

            <div ref={decisionRef} className="relative">
              <button
                ref={decisionTriggerRef}
                type="button"
                onClick={() => setDecisionOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault()
                    setDecisionOpen(true)
                    requestAnimationFrame(() => decisionOptionRefs.current[0]?.focus())
                  }
                  if (event.key === "Escape") setDecisionOpen(false)
                }}
                aria-haspopup="listbox"
                aria-expanded={decisionOpen}
                className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 outline-none transition-colors hover:border-neutral-400"
              >
                <span
                  className={cn(
                    "flex-1 truncate font-medium",
                    !decision && "text-neutral-400",
                  )}
                >
                  {decision === "dismissed"
                    ? "Dismiss"
                    : decision === "taken_down"
                      ? "Take down"
                      : "Choose a decision"}
                </span>
                {decisionOpen ? (
                  <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" />
                ) : (
                  <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />
                )}
              </button>
              {decisionOpen && (
                <div
                  role="listbox"
                  aria-label="Decision"
                  className="absolute z-50 mt-1 w-full overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg"
                >
                  <div className="py-1">
                    {decisionOptions(takeDownNoun).map((option, index) => {
                      const disabled = option.key === "taken_down" && !isCommentFlag && concernClosed
                      return (
                        <button
                          key={option.key}
                          ref={(node) => {
                            decisionOptionRefs.current[index] = node
                          }}
                          type="button"
                          role="option"
                          aria-selected={decision === option.key}
                          disabled={disabled}
                          onClick={() => {
                            setDecision(option.key)
                            setDecisionOpen(false)
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              setDecisionOpen(false)
                              decisionTriggerRef.current?.focus()
                            }
                            if (event.key === "ArrowDown") {
                              event.preventDefault()
                              decisionOptionRefs.current[(index + 1) % 2]?.focus()
                            }
                            if (event.key === "ArrowUp") {
                              event.preventDefault()
                              decisionOptionRefs.current[(index - 1 + 2) % 2]?.focus()
                            }
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] transition hover:bg-neutral-50",
                            disabled ? "text-neutral-400" : "text-neutral-700",
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium text-neutral-900">{option.label}</span>
                            <span className="block text-[13px] text-neutral-500">{option.hint}</span>
                          </span>
                          {decision === option.key && (
                            <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <SheetSecondaryButton onClick={() => setReviewTarget(null)} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
                Cancel
              </SheetSecondaryButton>
              <button
                type="button"
                disabled={busy === `flag-${reviewTarget.id}` || !decision}
                onClick={() => {
                  if (!decision) return
                  if (decision === "taken_down") setConfirmTakeDown(true)
                  else void decide(reviewTarget, decision)
                }}
                className={cn(
                  "flex h-[52px] flex-1 items-center justify-center rounded-full text-[15px] font-semibold text-white transition-colors disabled:opacity-40",
                  decision === "taken_down"
                    ? "bg-sos hover:bg-sos/90"
                    : "bg-brand-navy hover:bg-brand-navy/85",
                )}
              >
                {decision === "taken_down" ? `Take down ${takeDownNoun}` : "Submit decision"}
              </button>
            </div>
          </div>
        ) : null}
      </SheetDialog>

      <SheetDialog
        open={confirmTakeDown && Boolean(reviewTarget)}
        onClose={() => setConfirmTakeDown(false)}
        title={`Take down this ${takeDownNoun}?`}
        description={`The ${takeDownNoun} will be removed and its author notified. You can't undo this.`}
        footer={
          <div className="flex gap-2">
            <SheetPrimaryButton onClick={() => setConfirmTakeDown(false)} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
              Keep the {takeDownNoun}
            </SheetPrimaryButton>
            <SheetPrimaryButton
              tone="danger"
              disabled={busy === `flag-${reviewTarget?.id}`}
              onClick={() => {
                if (reviewTarget) void decide(reviewTarget, "taken_down")
              }}
              className="flex-1 text-[15px]"
            >
              Confirm take down
            </SheetPrimaryButton>
          </div>
        }
      />
      {mediaPreview ? (
        <MediaLightbox
          items={mediaPreview.items}
          index={mediaPreview.index}
          onClose={() => setMediaPreview(null)}
        />
      ) : null}
    </>
  )
}

function AnnouncementRow({
  item,
  areaContext,
  expandedKey,
  onToggleArea,
  onEdit,
  onDelete,
}: {
  item: Announcement
  areaContext: AnnouncementAreaContext | null
  expandedKey: string | null
  onToggleArea: (key: string) => void
  onEdit: (id: number) => void
  onDelete: (id: number) => void
}) {
  const key = `announcement-${item.id}`
  const isExpanded = expandedKey === key
  const TagIcon = advisoryMeta(item.tag).icon
  const hasArea = (item.affected_streets?.length ?? 0) > 0 || item.area_geometry != null
  const streets = item.affected_streets ?? []

  return (
    <div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 py-6 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
              <TagIcon className="size-4" strokeWidth={1.7} aria-hidden />
            </span>
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              className="min-w-0 text-left"
            >
              <span className="block truncate text-row text-brand-navy">
                {item.title}
              </span>
            </button>
            <span className="shrink-0 text-meta text-neutral-500">
              {humanize(item.status_label)}
            </span>
            {item.is_pinned ? (
              <span className="shrink-0 text-meta text-neutral-400">Pinned</span>
            ) : null}
          </div>

          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className={factClass.dt}>Type</dt>
              <dd className={factClass.dd}>{advisoryLabel(item.tag)}</dd>
            </div>
            <div>
              <dt className={factClass.dt}>Audience</dt>
              <dd className={factClass.dd}>{AUDIENCE_LABELS[item.audience]}</dd>
            </div>
            <div>
              <dt className={factClass.dt}>Affects</dt>
              <dd className={factClass.dd}>
                {streets.length ? streets.join(" · ") : "Whole barangay"}
              </dd>
            </div>
            <div>
              <dt className={factClass.dt}>Posted</dt>
              <dd className={factClass.dd}>{item.date_label}</dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
          {hasArea ? (
            <button
              type="button"
              onClick={() => onToggleArea(key)}
              className="flex items-center gap-1 text-meta text-neutral-500 transition-colors hover:text-brand-navy"
            >
              <MapPinIcon className="size-4" strokeWidth={1.9} aria-hidden />
              Area
              <ChevronDownIcon
                className={cn("size-4 transition-transform", isExpanded && "rotate-180")}
                aria-hidden
              />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onEdit(item.id)}
            className="text-meta text-neutral-500 transition-colors hover:text-accent"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="text-meta text-neutral-500 transition-colors hover:text-sos"
          >
            Delete
          </button>
        </div>
      </div>

      {isExpanded && item.area_geometry ? (
        <div className="pb-6">
          <AreaPreviewRow
            geometry={item.area_geometry}
            boundary={areaContext?.boundary ?? null}
            affectedStreets={streets}
            areaContext={areaContext}
            tag={item.tag}
          />
        </div>
      ) : null}
    </div>
  )
}

const TARGET_KIND_LABELS: Record<ContentFlag["target"]["kind"], string> = {
  concern: "Post",
  concern_comment: "Comment on a concern",
  announcement_comment: "Comment on an announcement",
  emergency_comment: "Comment on an emergency update",
}

const IMAGE_REVIEW_LABELS: Record<string, string> = {
  supports_flag: "Image supports the report",
  not_supported: "Image does not support the report",
  unclear: "Image needs staff review",
  unavailable: "Image could not be checked",
  checked: "Image was checked",
  not_present: "No image attached",
}

function FlagRow({
  flag,
  onReview,
  onOpen,
}: {
  flag: ContentFlag
  onReview: () => void
  onOpen: (() => void) | null
}) {
  // The post-level case still resolves the live title via a fetch (matches
  // today's behavior); every comment kind already carries its parent's title
  // on `target.post_title`, so no fetch is needed there.
  const [fetchedTitle, setFetchedTitle] = useState<string | null>(null)
  const isPostFlag = flag.target.kind === "concern"

  useEffect(() => {
    if (!isPostFlag || flag.concern == null) return
    let cancelled = false
    getConcern(flag.concern)
      .then((data) => {
        if (!cancelled) setFetchedTitle(data.title)
      })
      .catch(() => {
        if (!cancelled) setFetchedTitle("Report")
      })
    return () => {
      cancelled = true
    }
  }, [isPostFlag, flag.concern])

  const title = isPostFlag ? (fetchedTitle ?? "Loading report…") : flag.target.post_title || "Comment"

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
              <FileX className="size-4" strokeWidth={1.7} aria-hidden />
            </span>
            {onOpen ? (
              <button type="button" onClick={onOpen} className="min-w-0 text-left">
                <span className="block truncate text-row text-brand-navy">{title}</span>
              </button>
            ) : (
              <span className="block min-w-0 truncate text-row text-brand-navy">{title}</span>
            )}
            <span className="shrink-0 text-meta text-neutral-500">
              {flag.status === "submitted" ? (flag.llm_review ? "Checked" : "Checking") : "Decided"}
            </span>
            {flag.auto_moderated ? (
              <span className="shrink-0 text-meta text-neutral-400">System action</span>
            ) : null}
          </div>

          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            {!isPostFlag ? (
              <div>
                <dt className={factClass.dt}>Flagged</dt>
                <dd className={factClass.dd}>{TARGET_KIND_LABELS[flag.target.kind]}</dd>
              </div>
            ) : null}
            <div>
              <dt className={factClass.dt}>Reported by</dt>
              <dd className={factClass.dd}>{flag.reporter_full_name || flag.reporter.full_name}</dd>
            </div>
            <div>
              <dt className={factClass.dt}>Reported on</dt>
              <dd className={factClass.dd}>{formatDate(flag.created_at)}</dd>
            </div>
            <div>
              <dt className={factClass.dt}>Type</dt>
              <dd className={factClass.dd}>{flagNoteParts(flag).title}</dd>
            </div>
            {flag.llm_review ? (
              <div>
                <dt className={factClass.dt}>System check</dt>
                <dd className={factClass.dd}>{flag.llm_review.short_explanation || "Checked and held for staff."}</dd>
              </div>
            ) : null}
            {flag.llm_review?.image_review ? (
              <div>
                <dt className={factClass.dt}>Photo check</dt>
                <dd className={factClass.dd}>
                  {IMAGE_REVIEW_LABELS[flag.llm_review.image_review.status] || "Image needs staff review"}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex shrink-0 items-center gap-5">
          {flag.status === "submitted" ? (
            <button
              type="button"
              onClick={onReview}
              className="text-meta text-neutral-500 transition-colors hover:text-accent"
            >
              Review
            </button>
          ) : null}
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="text-meta text-neutral-500 transition-colors hover:text-accent"
            >
              Open report
            </button>
          ) : null}
        </div>
      </div>

      {flag.status !== "submitted" ? (
        <p className="mt-3 max-w-3xl rounded-lg border border-neutral-200 bg-white px-4 py-3 text-meta leading-relaxed text-navy-muted">
          <span className="font-semibold text-neutral-700">Decision: </span>
          {flag.staff_note}
        </p>
      ) : null}
    </div>
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
    <div>
      <AreaPreview geometry={geometry} boundary={boundary} streets={streets} tag={tag} />
      {affectedStreets.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {affectedStreets.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-full border border-brand-orange/30 bg-brand-orange-soft px-2 py-0.5 text-[10.5px] font-bold text-severity-high-ink"
            >
              <MapPinIcon className="size-3" aria-hidden />
              {name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
