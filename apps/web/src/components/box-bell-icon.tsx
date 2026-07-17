import { cn } from "@workspace/ui/lib/utils"

/**
 * Flaticon notification-bell glyph (id 8138390).
 * https://www.flaticon.com/free-icon/notification-bell_8138390
 * Static solid mark — no hover/focus glyph swap.
 */
export function BoxBellIcon({
  className,
  sizeClass = "size-6",
}: {
  /** @deprecated Kept for call-site compatibility; glyph is always solid. */
  solid?: boolean
  className?: string
  sizeClass?: string
}) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 bg-current text-[#07145f]",
        sizeClass,
        className,
      )}
      style={{
        WebkitMaskImage: "url(/contents/notification-bell.png)",
        maskImage: "url(/contents/notification-bell.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
      aria-hidden="true"
    />
  )
}
