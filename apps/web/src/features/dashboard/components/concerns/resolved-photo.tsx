import { cn } from "@workspace/ui/lib/utils"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"

export function ResolvedPhoto({
  originalSrc,
  resolutionSrc,
  alt,
  className,
  imageClassName,
  onOpen,
}: {
  originalSrc?: string | null
  resolutionSrc?: string | null
  resolutionCount?: number
  alt: string
  className?: string
  imageClassName?: string
  onOpen: () => void
}) {
  const displaySrc = resolutionSrc || originalSrc
  if (!displaySrc) return null

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open photo preview"
      className={cn(
        "block w-full cursor-zoom-in overflow-hidden bg-card-raised text-left focus-visible:ring-2 focus-visible:ring-status-closed focus-visible:ring-offset-2 focus-visible:outline-none",
        className
      )}
    >
      <AuthenticatedMediaImage
        src={displaySrc}
        alt={resolutionSrc ? "Resolved condition" : alt}
        className={cn("w-full object-cover", imageClassName)}
      />
    </button>
  )
}

export function ReportPhotoPreview({
  originalSrc,
  resolutionSrc,
  alt,
  onOpen,
}: {
  originalSrc?: string | null
  resolutionSrc?: string | null
  alt: string
  onOpen: () => void
}) {
  if (!originalSrc && !resolutionSrc) return null
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200">
      {resolutionSrc ? (
        <ResolvedPhoto
          originalSrc={originalSrc}
          resolutionSrc={resolutionSrc}
          alt={alt}
          imageClassName="h-auto w-full object-contain"
          onOpen={onOpen}
        />
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Preview photo"
          className="block w-full cursor-zoom-in"
        >
          <AuthenticatedMediaImage
            src={originalSrc ?? ""}
            alt={alt}
            className="h-auto w-full object-contain"
          />
        </button>
      )}
    </div>
  )
}
