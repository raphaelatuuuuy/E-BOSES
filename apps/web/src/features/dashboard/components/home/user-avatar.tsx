import { cn } from "@workspace/ui/lib/utils"

import type { PublicUser } from "@/features/dashboard/api"

/**
 * Letter-only avatar (no image) shared by the Home feed page, the composer
 * card, and the post-comments UI.
 */
export function UserAvatar({
  user,
  size = "md",
  className,
}: {
  user?: PublicUser | null
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
    "?"
  ).toUpperCase()

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#c5d0e6] font-semibold text-[#2c3a5a]",
        // sizeClass first so callers can override size; never strip the bg unless explicit
        sizeClass,
        className,
      )}
    >
      {letter}
    </span>
  )
}
