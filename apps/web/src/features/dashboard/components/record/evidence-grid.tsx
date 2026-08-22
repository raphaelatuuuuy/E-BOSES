import { FileIcon, PlayIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import type { Concern } from "@/features/dashboard/api"
import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import {
  mediaDisplaySource,
  toMediaPreviewItem,
  type MediaPreviewItem,
} from "@/features/dashboard/lib/authenticated-media"

export function EvidenceGrid({
  media,
  onPreview,
  variant = "light",
  fill = false,
  className,
}: {
  media: Concern["media"]
  onPreview: (items: MediaPreviewItem[], index: number) => void
  variant?: "light" | "ops"
  /** Disables the orange border-on-hover accent (used next to maps). */
  quiet?: boolean
  /** Stretches the tiles to fill the row height (used next to a map). */
  fill?: boolean
  className?: string
}) {
  const previewMedia = media.slice(0, 3)
  const moreCount = Math.max(0, media.length - previewMedia.length)
  const allItems: MediaPreviewItem[] = media.map((item) =>
    toMediaPreviewItem(mediaDisplaySource(item), item.original_filename, item.mime_type),
  )

  if (!media.length) return null

  const isLight = variant === "light"

  return (
    <div className={cn(fill ? "h-full space-y-2" : "mt-3 space-y-2")}>
      <div
        className={cn(
          "grid",
          fill ? "h-full auto-rows-fr gap-2" : isLight ? "grid-cols-2 gap-3 sm:grid-cols-3" : "gap-2 sm:grid-cols-2 xl:grid-cols-3",
          className,
        )}
      >
        {previewMedia.map((item, index) =>
          item.mime_type.startsWith("image/") ? (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreview(allItems, index)}
              className={cn(
                "overflow-hidden text-left transition-colors",

                isLight
                  ? "rounded-xl border border-neutral-200 bg-white"
                  : "rounded-control border border-card-line bg-canvas",
              )}
            >
              <AuthenticatedMediaImage
                src={item.preview_url}
                alt={`${item.original_filename} evidence photo`}
                className={fill ? "h-full w-full object-cover" : "h-28 w-full object-cover"}
              />
            </button>
          ) : (
            <button
              key={item.id}
              type="button"
              onClick={() => onPreview(allItems, index)}
              className={cn(
                cn("flex items-center justify-center gap-2 px-3 text-center text-[12px] font-semibold transition-colors", fill ? "h-full" : "h-28"),

                isLight
                  ? "rounded-xl border border-neutral-200 bg-white text-neutral-700 hover:text-neutral-900"
                  : "rounded-control border border-card-line bg-canvas text-muted-foreground hover:text-foreground",
              )}
            >
              {item.mime_type.startsWith("video/") ? (
                <>
                  <PlayIcon className="size-5" /> Preview video
                </>
              ) : (
                <>
                  <FileIcon className="size-5" /> Preview file
                </>
              )}
            </button>
          ),
        )}
      </div>
      {moreCount > 0 ? (
        <p className={cn("text-[12px] font-medium", isLight ? "text-neutral-500" : "text-muted-foreground")}>
          +{moreCount} more
        </p>
      ) : null}
    </div>
  )
}
