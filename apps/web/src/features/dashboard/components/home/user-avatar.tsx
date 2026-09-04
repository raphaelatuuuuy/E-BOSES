import { cn } from "@workspace/ui/lib/utils"

/**
 * Letter-only avatar (no image) shared by the Home feed page, the composer
 * card, and the post-comments UI.
 *
 * Typed on the two fields it actually reads rather than on `PublicUser`, so the
 * signed-in `AuthUser` (which has no `initials`) can be passed without a cast.
 */
export type AvatarUser = { full_name?: string | null; initials?: string | null }

export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: AvatarUser | null
  size?: "sm" | "md" | "lg"
  className?: string
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

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-soft font-bold text-navy-muted",
        // sizeClass first so callers can override size; never strip the bg unless explicit
        sizeClass,
        className
      )}
    >
      {letter}
    </span>
  )
}
