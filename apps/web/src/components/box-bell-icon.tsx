import { cn } from "@workspace/ui/lib/utils"

/**
 * Flaticon notification glyph (id 10419420).
 * https://www.flaticon.com/free-icon/notification_10419420
 * Parent should include Tailwind `group` for hover opacity.
 * Idle: lower opacity; hover / focus / active (or `active` prop): full opacity.
 */
export function BoxBellIcon({
  className,
  sizeClass = "size-7",
  active = false,
}: {
  /** @deprecated Kept for call-site compatibility; glyph is always solid. */
  solid?: boolean
  className?: string
  sizeClass?: string
  /** Full opacity when the notifications panel is open */
  active?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 bg-current text-neutral-700 transition-opacity duration-150",
        active
          ? "opacity-100"
          : "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
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
