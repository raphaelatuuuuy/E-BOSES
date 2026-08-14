import type { ButtonHTMLAttributes } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Filter chip with underline tab style, matching OpsTabs design.
 */
export function FilterChip({
  label,
  active,
  count,
  disabled,
  onClick,
  className,
  ...rest
}: {
  label: string
  active: boolean
  count?: number
  disabled?: boolean
  onClick: () => void
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className" | "disabled" | "type">) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      {...rest}
      className={cn(
        "relative shrink-0 whitespace-nowrap px-3 py-2.5 text-label transition-colors duration-[--duration-micro]",
        active
          ? "text-foreground"
          : "text-subtle-foreground hover:text-muted-foreground",
        className,
      )}
    >
      {label}
      {count != null && count > 0 ? (
        <span className="ml-1.5 tabular-nums text-faint-foreground">{count}</span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-2 -bottom-px h-0.5 rounded-pill transition-opacity duration-[--duration-micro]",
          active ? "bg-brand-orange opacity-100" : "opacity-0",
        )}
      />
    </button>
  )
}
