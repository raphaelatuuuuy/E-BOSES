import { cn } from "@workspace/ui/lib/utils"

/** Boxicons regular `bell` — https://boxicons.com/?query=bell */
function BellRegular({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 13.586V10c0-3.217-2.185-5.927-5.145-6.742C13.562 2.52 12.846 2 12 2s-1.562.52-1.855 1.258C7.185 4.074 5 6.783 5 10v3.586l-1.707 1.707A.996.996 0 0 0 3 16v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a.996.996 0 0 0-.293-.707L19 13.586zM19 17H5v-.586l1.707-1.707A.996.996 0 0 0 7 14v-4c0-2.757 2.243-5 5-5s5 2.243 5 5v4c0 .266.105.52.293.707L19 16.414V17zm-7 5a2.98 2.98 0 0 0 2.818-2H9.182A2.98 2.98 0 0 0 12 22z" />
    </svg>
  )
}

/** Boxicons solid `bell` */
function BellSolid({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 22a2.98 2.98 0 0 0 2.818-2H9.182A2.98 2.98 0 0 0 12 22zm7-7.414V10c0-3.217-2.185-5.927-5.145-6.742C13.562 2.52 12.846 2 12 2s-1.562.52-1.855 1.258C7.185 4.074 5 6.783 5 10v4.586l-1.707 1.707A.996.996 0 0 0 3 17v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-1a.996.996 0 0 0-.293-.707L19 14.586z" />
    </svg>
  )
}

/**
 * Boxicons bell — regular by default, solid on hover / focus / active.
 * Parent should include Tailwind `group`.
 */
export function BoxBellIcon({
  solid = false,
  className,
  sizeClass = "size-6",
}: {
  solid?: boolean
  className?: string
  sizeClass?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-[#07145f]",
        sizeClass,
        className,
      )}
      aria-hidden="true"
    >
      {solid ? (
        <BellSolid className={sizeClass} />
      ) : (
        <>
          <BellRegular
            className={cn(
              sizeClass,
              "group-hover:hidden group-focus-visible:hidden group-active:hidden",
            )}
          />
          <BellSolid
            className={cn(
              sizeClass,
              "hidden group-hover:block group-focus-visible:block group-active:block",
            )}
          />
        </>
      )}
    </span>
  )
}
