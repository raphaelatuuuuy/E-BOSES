import { cn } from "@workspace/ui/lib/utils"
import { usePresenceStatus } from "@/features/dashboard/presence"

/**
 * Letter-only avatar (no image) shared by the Home feed page, the composer
 * card, and the post-comments UI.
 *
 * Typed on the two fields it actually reads rather than on `PublicUser`, so the
 * signed-in `AuthUser` (which has no `initials`) can be passed without a cast.
 */
export type AvatarUser = {
  id?: number
  full_name?: string | null
  initials?: string | null
  online?: boolean | null
  is_online?: boolean | null
}

export function UserAvatar({
  user,
  size = "md",
  className,
  online,
  title,
  showStatus = true,
}: {
  user?: AvatarUser | null
  size?: "sm" | "md" | "lg"
  className?: string
  online?: boolean
  title?: string
  showStatus?: boolean
}) {
  const sizeClass =
    size === "sm"
      ? "size-9 text-[16px]"
      : size === "lg"
        ? "size-11 text-[18px]"
        : "size-10 text-[17px]"

  const letter = (
    user?.full_name?.[0] ||
    user?.initials?.[0] ||
    "U"
  ).toUpperCase()
  const isOnline = usePresenceStatus(
    user?.id,
    online ?? user?.online ?? user?.is_online ?? false,
  )

  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full bg-slate-soft font-bold text-navy-muted",
        // sizeClass first so callers can override size; never strip the bg unless explicit
        sizeClass,
        className
      )}
      title={title}
    >
      <span className="flex size-full overflow-hidden rounded-full items-center justify-center">
        {letter}
      </span>
      {showStatus ? (
        <span
          className={cn(
            "absolute right-[-1px] bottom-[-1px] z-10 size-2.5 rounded-full border-2 border-white",
            isOnline ? "bg-emerald-500" : "bg-slate-400",
          )}
          title={isOnline ? "Online" : "Offline"}
          aria-label={isOnline ? "Online" : "Offline"}
        />
      ) : null}
    </span>
  )
}
