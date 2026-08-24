import type { ButtonHTMLAttributes } from "react"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Filter chip, pill style: a filled rounded-pill container per option rather
 * than an underline indicator, matching OpsTabs' `pill` variant.
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
        "flex shrink-0 items-center whitespace-nowrap rounded-pill border px-4 py-1.5 text-label font-semibold transition-all duration-200 ease-out active:scale-95",
        active
          ? "border-brand-navy bg-brand-navy text-white shadow-sm"
          : "border-card-line-strong/100 text-subtle-foreground hover:border-card-line-strong hover:bg-card-raised hover:text-foreground",
        className,
      )}
    >
      {label}
      {count != null && count > 0 ? (
        <span
          className={cn(
            "ml-1.5 tabular-nums",
            active ? "text-white/70" : "text-faint-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
