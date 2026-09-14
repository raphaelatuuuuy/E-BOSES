import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheck,
  EyeOffIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

import { toast } from "sonner"
import { EraserIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { getAccessToken } from "@/lib/api"
import {
  invalidateAuthenticatedMedia,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import {
  addConcernMediaRedactions,
  removeConcernMediaRedaction,
  type ConcernMedia,
} from "@/features/dashboard/api"

const blobCache = new Map<string, string>()
const BLOB_CACHE_MAX = 120

function cacheGet(src: string) {
  const hit = blobCache.get(src)
  if (hit) {
    blobCache.delete(src)
    blobCache.set(src, hit)
  }
  return hit
}

function cachePut(src: string, url: string) {
  const existing = blobCache.get(src)
  if (existing) URL.revokeObjectURL(existing)
  blobCache.set(src, url)
  while (blobCache.size > BLOB_CACHE_MAX) {
    const oldestKey = blobCache.keys().next().value as string
    const oldest = blobCache.get(oldestKey)
    blobCache.delete(oldestKey)
    if (oldest) URL.revokeObjectURL(oldest)
  }
}

function cacheDelete(src: string) {
  const existing = blobCache.get(src)
  if (existing) URL.revokeObjectURL(existing)
  blobCache.delete(src)
}

function useAuthenticatedBlob(src: string) {
  const [objectUrl, setObjectUrl] = useState("")
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    function onInvalidate(event: Event) {
      const detail = (event as CustomEvent<{ src?: string }>).detail
      if (!detail?.src || detail.src === src) {
        cacheDelete(src)
        setObjectUrl("")
        setFailed(false)
        setVersion((value) => value + 1)
      }
    }
    window.addEventListener("eboses:media-invalidate", onInvalidate)
    return () =>
      window.removeEventListener("eboses:media-invalidate", onInvalidate)
  }, [src])

  useEffect(() => {
    let cancelled = false
    let retryTimer: number | undefined
    const token = getAccessToken()

    async function load() {
      const cached = cacheGet(src)
      if (cached) {
        setObjectUrl(cached)
        return
      }
      setFailed(false)
      try {
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: "no-store",
        })
        if (!response.ok) throw new Error("Media request failed")
        const blob = await response.blob()
        if (response.headers.get("X-EBOSES-Preview-Status") === "pending") {
          // Never cache the server's placeholder JPEG. Keep polling until the
          // worker has written the real preview.
          if (!cancelled)
            retryTimer = window.setTimeout(() => void load(), 1500)
          return
        }
        const url = URL.createObjectURL(blob)
        cachePut(src, url)
        if (!cancelled) setObjectUrl(url)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    }
  }, [src, version])

  return { objectUrl, failed }
}

export function AuthenticatedMediaImage({
  src,
  alt,
  className,
  draggable,
  hideOnError = false,
}: {
  src: string
  alt: string
  className?: string

  draggable?: boolean
  hideOnError?: boolean
}) {
  const { objectUrl, failed } = useAuthenticatedBlob(src)

  if (failed) {
    if (hideOnError) return null
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageIcon className="size-5" aria-hidden="true" />
        <span className="sr-only">Preview unavailable</span>
      </span>
    )
  }
  if (!objectUrl) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
      >
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading preview</span>
      </span>
    )
  }
  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      draggable={draggable}
    />
  )
}

export function AuthenticatedMediaVideo({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const { objectUrl, failed } = useAuthenticatedBlob(src)

  if (failed) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
      >
        <ImageIcon className="size-5" aria-hidden="true" />
        <span className="sr-only">Video unavailable</span>
      </span>
    )
  }
  if (!objectUrl) {
    return (
      <span
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
      >
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading video</span>
      </span>
    )
  }
  return <video src={objectUrl} controls playsInline className={className} />
}

interface BlurDraft {
  x: number
  y: number
  width: number
  height: number
}

function normalisedBlurPoint(
  event: React.PointerEvent<HTMLDivElement>,
  element: HTMLDivElement
) {
  const rect = element.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
  }
}

type PreviewFilter = "concern" | "resolution"

function previewFilterFor(item: MediaPreviewItem): PreviewFilter | null {
  const badge = (item.badge ?? "").trim().toLowerCase()
  if (badge === "reported issue") return "concern"
  if (badge === "resolved case") return "resolution"
  return null
}

export function MediaLightbox({
  items,
  index,
  onClose,
  simpleCounter = false,
}: {
  items: MediaPreviewItem[]
  index: number
  onClose: () => void
  /** Report previews use a centered image counter instead of status pills. */
  simpleCounter?: boolean
}) {
  const { user } = useAuthSession()
  const canBlur = isOfficialUser(user) || isResponderUser(user)
  const [active, setActive] = useState(index)
  const [requestedIndex, setRequestedIndex] = useState(index)
  const [renderedActive, setRenderedActive] = useState(active)
  const [blurMode, setBlurMode] = useState(false)
  const [draft, setDraft] = useState<BlurDraft | null>(null)
  const [pending, setPending] = useState<BlurDraft[]>([])
  const [overrides, setOverrides] = useState<Record<number, ConcernMedia>>({})
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const originRef = useRef<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)

  if (requestedIndex !== index) {
    setRequestedIndex(index)
    setActive(Math.max(0, Math.min(index, items.length - 1)))
  }
  if (renderedActive !== active) {
    setRenderedActive(active)
    setPending([])
    setDraft(null)
  }

  const media = items[active]
  const currentMedia = media?.media
    ? (overrides[media.media.id] ?? media.media)
    : undefined
  const blurTarget =
    blurMode && media?.kind === "image" ? (currentMedia ?? null) : null
  const saved = blurTarget?.redactions ?? []

  useEffect(() => {
    if (items.length === 0) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (blurMode) {
          setBlurMode(false)
          setPending([])
          return
        }
        onClose()
      }
      if (blurMode) return
      if (event.key === "ArrowLeft")
        setActive((current) => Math.max(0, current - 1))
      if (event.key === "ArrowRight")
        setActive((current) => Math.min(items.length - 1, current + 1))
    }
    window.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [items.length, onClose, blurMode])

  if (items.length === 0 || !media) return null

  function onSurfacePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!surfaceRef.current || busy || !blurTarget) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    originRef.current = normalisedBlurPoint(event, surfaceRef.current)
    setDraft({ ...originRef.current, width: 0, height: 0 })
  }

  function onSurfacePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = originRef.current
    if (!origin || !surfaceRef.current) return
    const point = normalisedBlurPoint(event, surfaceRef.current)
    setDraft({
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    })
  }

  function onSurfacePointerUp() {
    const box = draft
    originRef.current = null
    setDraft(null)
    if (!box || box.width < 0.01 || box.height < 0.01) return
    setPending((current) => [...current, box])
  }

  async function saveBlur() {
    if (!blurTarget || !pending.length) return
    setBusy(true)
    try {
      const next = await addConcernMediaRedactions(blurTarget.id, pending)
      applyMediaUpdate(next)
      setPending([])
      toast.success("The photo was updated with your blurred areas.")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The blurred areas could not be saved."
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeBlur(redactionId: number) {
    if (!blurTarget) return
    setBusy(true)
    try {
      const next = await removeConcernMediaRedaction(blurTarget.id, redactionId)
      applyMediaUpdate(next)
      toast.success("The blurred area was removed.")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The blurred area could not be removed."
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeAllBlur() {
    if (!blurTarget) return
    const regions = saved.slice()
    if (!regions.length) return
    setBusy(true)
    try {
      let next = blurTarget
      for (const region of regions) {
        next = await removeConcernMediaRedaction(blurTarget.id, region.id)
      }
      applyMediaUpdate(next)
      toast.success("All blurred areas were removed.")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The blurred areas could not be removed."
      )
    } finally {
      setBusy(false)
    }
  }

  function applyMediaUpdate(next: ConcernMedia) {
    setOverrides((prev) => ({ ...prev, [next.id]: next }))
    setPending([])
    invalidateAuthenticatedMedia(items[active].src)
  }

  const boxes = [...saved, ...pending, ...(draft && blurTarget ? [draft] : [])]
  const badgeText = (media.badge ?? "").trim().toLowerCase()
  const isResolvedBadge = badgeText === "resolved case"
  const isReportedBadge = badgeText === "reported issue"
  const concernPhotoIndexes = simpleCounter
    ? items.flatMap((item, itemIndex) =>
        previewFilterFor(item) === "concern" ? [itemIndex] : []
      )
    : []
  const resolutionPhotoIndexes = simpleCounter
    ? items.flatMap((item, itemIndex) =>
        previewFilterFor(item) === "resolution" ? [itemIndex] : []
      )
    : []
  const previewFilters: Array<{
    key: PreviewFilter
    label: string
    indexes: number[]
  }> = [
    {
      key: "concern" as const,
      label: "Concern Photo",
      indexes: concernPhotoIndexes,
    },
    {
      key: "resolution" as const,
      label: "Resolution Photo",
      indexes: resolutionPhotoIndexes,
    },
  ].filter((filter) => filter.indexes.length > 0)
  const activeFilter = previewFilterFor(media)
  const activeFilterIndexes =
    previewFilters.find((filter) => filter.key === activeFilter)?.indexes ?? []
  const filterNavigationIndexes = activeFilterIndexes.length
    ? activeFilterIndexes
    : items.map((_, itemIndex) => itemIndex)
  const filterNavigationPosition = Math.max(
    0,
    filterNavigationIndexes.indexOf(active)
  )

  function moveWithinFilter(offset: number) {
    const nextPosition = Math.min(
      filterNavigationIndexes.length - 1,
      Math.max(0, filterNavigationPosition + offset)
    )
    setActive(filterNavigationIndexes[nextPosition] ?? active)
  }

  function handleClose() {
    setBlurMode(false)
    setPending([])
    setDraft(null)
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      onClick={blurMode ? undefined : onClose}
    >
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close preview"
        className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <XIcon className="size-5" />
      </button>
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col items-center"
        onClick={(event) => event.stopPropagation()}
      >
        {blurMode ? (
          <p className="mb-2 text-center text-[13px] text-white/70">
            Drag across anything that should not be public. The blur is applied
            to the copy residents see; the original stays available to you.
          </p>
        ) : null}

        {!blurMode && !simpleCounter && !isResolvedBadge && !isReportedBadge ? (
          <div className="mb-3 w-full text-white">
            {media.eyebrow ? (
              <p className="text-center text-[12px] text-white/55">
                {media.eyebrow}
              </p>
            ) : null}
            {media.postedLabel ? (
              <p className="mt-0.5 text-center text-[12px] text-white/55">
                Posted on {media.postedLabel}
              </p>
            ) : null}
            {media.heading ? (
              <h2 className="mt-1.5 min-w-0 text-center text-[17px] font-bold break-words text-white">
                {media.heading}
              </h2>
            ) : null}
            {media.blurb ? (
              <p className="mx-auto mt-1 line-clamp-3 max-w-md text-center text-[13px] leading-snug text-white/70">
                {media.blurb}
              </p>
            ) : null}
          </div>
        ) : null}

        {!blurMode && simpleCounter ? (
          <div className="mb-3 flex w-full items-center justify-center gap-1 text-white">
            <button
              type="button"
              aria-label="Previous photo in this filter"
              disabled={filterNavigationPosition === 0}
              onClick={() => moveWithinFilter(-1)}
              className="flex size-6 items-center justify-center text-white/80 transition-colors hover:text-white disabled:opacity-30"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span
              aria-live="polite"
              className="min-w-10 text-center text-[12px] font-normal tabular-nums"
            >
              {filterNavigationPosition + 1}/{filterNavigationIndexes.length}
            </span>
            <button
              type="button"
              aria-label="Next photo in this filter"
              disabled={
                filterNavigationPosition === filterNavigationIndexes.length - 1
              }
              onClick={() => moveWithinFilter(1)}
              className="flex size-6 items-center justify-center text-white/80 transition-colors hover:text-white disabled:opacity-30"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        ) : null}

        <div className="flex w-full items-center justify-center gap-2 sm:gap-3">
          <div className="relative flex min-w-0 flex-1 items-center justify-center">
            {blurTarget ? (
              <div
                ref={surfaceRef}
                onPointerDown={onSurfacePointerDown}
                onPointerMove={onSurfacePointerMove}
                onPointerUp={onSurfacePointerUp}
                onPointerCancel={onSurfacePointerUp}
                onDragStart={(event) => event.preventDefault()}
                className="relative max-h-[80vh] cursor-crosshair touch-none overflow-hidden rounded-xl select-none"
              >
                <AuthenticatedMediaImage
                  src={media.src}
                  alt={media.filename}
                  className="pointer-events-none max-h-[80vh] w-auto max-w-full object-contain"
                />
                {boxes.map((box, boxIndex) => {
                  const savedRegion =
                    boxIndex < saved.length ? saved[boxIndex] : null
                  return savedRegion ? (
                    <button
                      key={`${box.x}-${box.y}-${boxIndex}`}
                      type="button"
                      disabled={busy}
                      title="Remove this blurred area"
                      onClick={() => void removeBlur(savedRegion.id)}
                      className="absolute border-2 border-status-closed bg-status-closed/35"
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                      }}
                    />
                  ) : (
                    <span
                      key={`${box.x}-${box.y}-${boxIndex}`}
                      aria-hidden
                      className="pointer-events-none absolute border-2 border-brand-orange bg-brand-orange/35"
                      style={{
                        left: `${box.x * 100}%`,
                        top: `${box.y * 100}%`,
                        width: `${box.width * 100}%`,
                        height: `${box.height * 100}%`,
                      }}
                    />
                  )
                })}
              </div>
            ) : media.kind === "image" ? (
              <div className="relative max-h-[80vh] overflow-hidden rounded-xl">
                <AuthenticatedMediaImage
                  src={media.src}
                  alt={media.filename}
                  className="max-h-[80vh] w-auto max-w-full object-contain"
                />
              </div>
            ) : media.kind === "video" ? (
              <AuthenticatedMediaVideo
                src={media.src}
                className="max-h-[80vh] w-auto max-w-full rounded-xl"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-10 py-10">
                <FileIcon
                  className="size-10 text-white/70"
                  aria-hidden="true"
                />
                <p className="max-w-60 text-center text-sm leading-5 text-white/70">
                  This file type can't be previewed in the browser — download it
                  instead.
                </p>
              </div>
            )}
          </div>
        </div>

        {!blurMode &&
        !simpleCounter &&
        (items.length > 1 || isResolvedBadge || isReportedBadge) ? (
          <div className="mt-3 flex items-center justify-center gap-2">
            {items.length > 1 ? (
              <button
                type="button"
                aria-label="Previous media"
                disabled={active === 0}
                onClick={() => setActive((current) => Math.max(0, current - 1))}
                className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronLeftIcon className="size-5" />
              </button>
            ) : null}
            {isResolvedBadge || isReportedBadge ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] font-semibold text-white">
                {isResolvedBadge ? (
                  <CircleCheck
                    className="size-4 text-emerald-300"
                    aria-hidden="true"
                  />
                ) : (
                  <TriangleAlertIcon
                    className="size-4 text-orange-300"
                    aria-hidden="true"
                  />
                )}
                {isResolvedBadge ? "After" : "Before"}
              </span>
            ) : null}
            {items.length > 1 ? (
              <button
                type="button"
                aria-label="Next media"
                disabled={active === items.length - 1}
                onClick={() =>
                  setActive((current) =>
                    Math.min(items.length - 1, current + 1)
                  )
                }
                className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
              >
                <ChevronRightIcon className="size-5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {!blurMode && simpleCounter && previewFilters.length > 0 ? (
          <div className="mt-3 flex items-center justify-center gap-6 text-[13px] text-white">
            {previewFilters.map((filter) => {
              const selected = activeFilter === filter.key
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActive(filter.indexes[0] ?? 0)}
                  className="inline-flex items-center gap-2 text-white/85 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 rounded-full",
                      selected
                        ? "bg-white"
                        : "border border-white/75 bg-transparent"
                    )}
                  />
                  <span>{filter.label}</span>
                </button>
              )
            })}
          </div>
        ) : null}

        {blurMode || (canBlur && media.kind === "image" && media.media) ? (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {blurMode ? (
              <>
                {pending.length ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPending([])}
                    className="inline-flex h-9 items-center rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                  >
                    Clear
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !pending.length}
                  onClick={() => void saveBlur()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-orange px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : null}
                  Save blurred areas
                </button>
                {saved.length ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeAllBlur()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                  >
                    <EraserIcon className="size-4" />
                    Remove all blur
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setBlurMode(false)
                    setPending([])
                  }}
                  className="inline-flex h-9 items-center rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setBlurMode(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
              >
                <EyeOffIcon className="size-4" />
                Blur an area
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
