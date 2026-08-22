import { TagsIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import type { Concern } from "@/features/dashboard/api"

export function ReportIcon({
  report,
  size = "md",
  forceIcon = false,
}: {
  report: Concern
  size?: "sm" | "md"
  forceIcon?: boolean
}) {
  const firstImage = !forceIcon
    ? report.media?.find((m) => m.mime_type?.startsWith("image/"))
    : undefined

  if (firstImage) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
          size === "sm" ? "size-11" : "size-12",
        )}
      >
        <AuthenticatedMediaImage
          src={firstImage.preview_url}
          alt=""
          className="size-full object-cover"
        />
      </span>
    )
  }

  if (report.category_ref?.icon_image_url) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full", size === "sm" ? "size-9" : "size-10")}>
        <img src={report.category_ref.icon_image_url} alt="" className="size-full object-cover" />
      </span>
    )
  }

  if (report.category_ref?.custom_icon_label) {
    return (
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700", size === "sm" ? "size-9" : "size-10")}>
        {report.category_ref.custom_icon_label}
      </span>
    )
  }

  const ResolvedIcon = resolveIconByKey(report.category_ref?.icon_key) ?? TagsIcon

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600",
        size === "sm" ? "size-9" : "size-10",
      )}
    >
      <ResolvedIcon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2} />
    </span>
  )
}
