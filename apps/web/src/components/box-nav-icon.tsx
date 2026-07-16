import { cn } from "@workspace/ui/lib/utils"

/**
 * Boxicons icon that swaps regular → solid on hover / focus-visible / active.
 * When `solid` is true (e.g. active route), always renders the solid variant.
 *
 * Parent should include Tailwind `group` for hover/focus states.
 * Icon names without the `bx-` / `bxs-` prefix (e.g. "home", "news", "note").
 */
export function BoxNavIcon({
  name,
  solid = false,
  className,
  size = 22,
}: {
  name: string
  solid?: boolean
  className?: string
  size?: number
}) {
  const style = { fontSize: size, width: size, height: size, lineHeight: 1 }

  if (solid) {
    return (
      <i
        className={cn("bx shrink-0 leading-none", `bxs-${name}`, className)}
        style={style}
        aria-hidden="true"
      />
    )
  }

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={style}
      aria-hidden="true"
    >
      <i
        className={cn(
          "bx leading-none group-hover:hidden group-focus-visible:hidden group-active:hidden",
          `bx-${name}`,
        )}
        style={style}
      />
      <i
        className={cn(
          "bx absolute leading-none hidden group-hover:inline group-focus-visible:inline group-active:inline",
          `bxs-${name}`,
        )}
        style={style}
      />
    </span>
  )
}
