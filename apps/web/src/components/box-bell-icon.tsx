import { Bell } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Notification bell icon using lucide-react.
 * Parent should include Tailwind `group` for hover opacity.
 * Idle: lower opacity; hover / focus / active (or `active` prop): full opacity.
 */
export function BoxBellIcon({
  className,
  sizeClass = "size-7",
  active = false,
}: {
  /** @deprecated Kept for call-site compatibility. */
  solid?: boolean
  className?: string
  sizeClass?: string
  /** Full opacity when the notifications panel is open */
  active?: boolean
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-neutral-700 transition-opacity duration-150",
        active
          ? "opacity-100"
          : "opacity-55 group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100",
        sizeClass,
        className,
      )}
      aria-hidden="true"
    >
      <Bell className="size-full" />
    </span>
  )
}
