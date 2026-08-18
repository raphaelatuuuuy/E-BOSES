import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { getAccessToken } from "@/lib/api"
import {
  openAuthenticatedMedia,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"

function useAuthenticatedBlob(src: string) {
  const [objectUrl, setObjectUrl] = useState("")
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let nextObjectUrl = ""
    const token = getAccessToken()

    async function load() {
      setFailed(false)
      try {
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!response.ok) throw new Error("Media request failed")
        nextObjectUrl = URL.createObjectURL(await response.blob())
        if (!cancelled) setObjectUrl(nextObjectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl)
    }
  }, [src])

  return { objectUrl, failed }
}

export function AuthenticatedMediaImage({
  src,
  alt,
  className,
  draggable,
}: {
  src: string
  alt: string
  className?: string

  draggable?: boolean
}) {
  const { objectUrl, failed } = useAuthenticatedBlob(src)

  if (failed) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="size-5" aria-hidden="true" />
        <span className="sr-only">Preview unavailable</span>
      </span>
    )
  }
  if (!objectUrl) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading preview</span>
      </span>
    )
  }
  return <img src={objectUrl} alt={alt} className={className} draggable={draggable} />
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
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="size-5" aria-hidden="true" />
        <span className="sr-only">Video unavailable</span>
      </span>
    )
  }
  if (!objectUrl) {
    return (
      <span className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading video</span>
      </span>
    )
  }
  return <video src={objectUrl} controls playsInline className={className} />
}

export function MediaLightbox({
  items,
  index,
  onClose,
}: {
  items: MediaPreviewItem[]
  index: number
  onClose: () => void
}) {
  const [active, setActive] = useState(index)
  const [requestedIndex, setRequestedIndex] = useState(index)

  if (requestedIndex !== index) {
    setRequestedIndex(index)
    setActive(Math.max(0, Math.min(index, items.length - 1)))
  }

  useEffect(() => {
    if (items.length === 0) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
      if (event.key === "ArrowLeft") setActive((current) => Math.max(0, current - 1))
      if (event.key === "ArrowRight") setActive((current) => Math.min(items.length - 1, current + 1))
    }
    window.addEventListener("keydown", onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = previous
    }
  }, [items.length, onClose])

  const media = items[active]
  if (items.length === 0 || !media) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col items-center"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex w-full items-center justify-center gap-2 sm:gap-3">
          {active > 0 ? (
            <button
              type="button"
              aria-label="Previous media"
              onClick={() => setActive((current) => current - 1)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <ChevronLeftIcon className="size-5" />
            </button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            {media.kind === "image" ? (
              <AuthenticatedMediaImage
                src={media.src}
                alt={media.filename}
                className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain"
              />
            ) : media.kind === "video" ? (
              <AuthenticatedMediaVideo src={media.src} className="max-h-[80vh] w-auto max-w-full rounded-xl" />
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-10 py-10">
                <FileIcon className="size-10 text-white/70" aria-hidden="true" />
                <p className="max-w-60 text-center text-sm leading-5 text-white/70">
                  This file type can't be previewed in the browser — download it instead.
                </p>
              </div>
            )}
          </div>
          {active < items.length - 1 ? (
            <button
              type="button"
              aria-label="Next media"
              onClick={() => setActive((current) => current + 1)}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <ChevronRightIcon className="size-5" />
            </button>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void openAuthenticatedMedia(media.src, media.filename)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
          >
            <DownloadIcon className="size-4" />
            Download
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20"
          >
            <XIcon className="size-4" />
            Close
          </button>
          {items.length > 1 ? (
            <span className="ml-2 text-xs tabular-nums text-white/50">
              {active + 1} of {items.length}
            </span>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}