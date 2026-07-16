import { cn } from "@workspace/ui/lib/utils"

interface IdCardIconProps {
  /** Force solid (selected / clicked). Hover & focus still work via parent `group`. */
  solid?: boolean
  className?: string
}

/** Boxicons regular `id-card` path data — https://v2.boxicons.com/?query=card */
function IdCardRegular({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.715 12c1.151 0 2-.849 2-2s-.849-2-2-2-2 .849-2 2 .848 2 2 2z" />
      <path d="M20 4H4c-1.103 0-2 .841-2 1.875v12.25C2 19.159 2.897 20 4 20h16c1.103 0 2-.841 2-1.875V5.875C22 4.841 21.103 4 20 4zm0 14-16-.011V6l16 .011V18z" />
      <path d="M14 9h4v2h-4zm1 4h3v2h-3zm-1.57 2.536c0-1.374-1.676-2.786-3.715-2.786S6 14.162 6 15.536V16h7.43v-.464z" />
    </svg>
  )
}

/** Boxicons solid `id-card` path data — https://v2.boxicons.com/?query=card */
function IdCardSolid({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M20 4H4c-1.103 0-2 .897-2 2v12c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V6c0-1.103-.897-2-2-2zM8.715 8c1.151 0 2 .849 2 2s-.849 2-2 2-2-.849-2-2 .848-2 2-2zm3.715 8H5v-.465c0-1.373 1.676-2.785 3.715-2.785s3.715 1.412 3.715 2.785V16zM19 15h-4v-2h4v2zm0-4h-5V9h5v2z" />
    </svg>
  )
}

/**
 * Boxicons `id-card` (regular → solid on hover / focus / active / selected).
 * Parent control should include `group` for hover/focus styles.
 */
export function BoxIdCardIcon({ solid = false, className }: IdCardIconProps) {
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center text-black",
        className,
      )}
      aria-hidden="true"
    >
      {solid ? (
        <IdCardSolid className="size-5" />
      ) : (
        <>
          <IdCardRegular className="size-5 group-hover:hidden group-focus-visible:hidden group-active:hidden" />
          <IdCardSolid className="hidden size-5 group-hover:block group-focus-visible:block group-active:block" />
        </>
      )}
    </span>
  )
}
