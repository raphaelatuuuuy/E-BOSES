import {
  ArrowRightIcon,
  DropletsIcon,
  HomeIcon,
  LeafIcon,
  LightbulbIcon,
  MapPinIcon,
  MegaphoneIcon,
  PawPrintIcon,
  ShieldAlertIcon,
  TagsIcon,
  Trash2Icon,
  WrenchIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { AuthenticatedMediaImage } from "@/features/dashboard/components/authenticated-media"
import { categoryStyles } from "@/features/dashboard/components/concerns/concern-display"
import type { Concern } from "@/features/dashboard/api"

const CATEGORY_ICON_BY_KEY = {
  tag: TagsIcon,
  wrench: WrenchIcon,
  leaf: LeafIcon,
  "shield-alert": ShieldAlertIcon,
  trash: Trash2Icon,
  lightbulb: LightbulbIcon,
  road: ArrowRightIcon,
  droplets: DropletsIcon,
  home: HomeIcon,
  "map-pin": MapPinIcon,
  "paw-print": PawPrintIcon,
  megaphone: MegaphoneIcon,
} as const

/**
 * The thumbnail for a concern row: its first photo, or the category glyph.
 *
 * Split out of `concern-display.tsx`, which exported this component alongside
 * sixteen helpers and constants. A module that mixes components with other
 * exports is not a valid Fast Refresh boundary, so every edit to any of those
 * helpers forced a full page reload instead of a hot update — painful on the
 * concerns workspace, where reproducing state means re-selecting a report.
 */
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
      <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-black text-neutral-700", size === "sm" ? "size-9" : "size-10")}>
        {report.category_ref.custom_icon_label}
      </span>
    )
  }

  const configuredIcon = CATEGORY_ICON_BY_KEY[report.category_ref?.icon_key as keyof typeof CATEGORY_ICON_BY_KEY]
  const style = categoryStyles[report.category]
  const Icon = style.icon

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-600",
        size === "sm" ? "size-9" : "size-10",
      )}
    >
      {configuredIcon ? (
        (() => {
          const ConfiguredIcon = configuredIcon
          return <ConfiguredIcon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2} />
        })()
      ) : (
        <Icon className={size === "sm" ? "size-4" : "size-5"} strokeWidth={2} />
      )}
    </span>
  )
}
