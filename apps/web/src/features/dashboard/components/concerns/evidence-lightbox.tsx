import { useEffect } from "react"
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from "lucide-react"

import { openAuthenticatedMedia } from "@/features/dashboard/components/authenticated-media"
import type { ConcernMedia } from "@/features/dashboard/api"

/** Extracted verbatim from `pages/reports.tsx` (was `ReportDetailsSidebar`'s evidence viewer). */
export function EvidenceLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: {
  images: ConcernMedia[]
  currentIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}) {
  const image = images[currentIndex]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft" && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === "ArrowRight" && currentIndex < images.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [currentIndex, images.length, onClose, onNavigate])

  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  if (!image) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Evidence preview"
    >
      <div className="relative flex max-h-[90vh] max-w-[90vw] items-center" onClick={(e) => e.stopPropagation()}>
        {/* Previous */}
        {currentIndex > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(currentIndex - 1)}
            className="absolute left-2 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 md:-left-12"
            aria-label="Previous image"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        )}

        <div className="flex flex-col items-center gap-4">
          <img
            src={image.preview_url}
            alt={image.original_filename}
            className="max-h-[80vh] max-w-[85vw] rounded-lg object-contain"
          />

          {/* Controls */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void openAuthenticatedMedia(image.raw_url, image.original_filename)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <DownloadIcon className="size-4" />
              Download
            </button>
            <span className="text-sm text-white/60">
              {currentIndex + 1} / {images.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20"
            >
              <XIcon className="size-4" />
              Close
            </button>
          </div>
        </div>

        {/* Next */}
        {currentIndex < images.length - 1 && (
          <button
            type="button"
            onClick={() => onNavigate(currentIndex + 1)}
            className="absolute right-2 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 md:-right-12"
            aria-label="Next image"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        )}
      </div>
    </div>
  )
}
