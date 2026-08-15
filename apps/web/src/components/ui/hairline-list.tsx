import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function HairlineList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <ul className={cn("overflow-hidden rounded-xl border border-neutral-200", className)}>
      {children}
    </ul>
  )
}

export function HairlineRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  to,
  onClick,
  dense = false,
  className,
}: {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  to?: string
  onClick?: () => void
  dense?: boolean
  className?: string
}) {
  const interactive = Boolean(to || onClick)
  const body = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-row text-brand-navy">{title}</span>
        {subtitle ? (
          <span className="mt-2 block text-meta leading-relaxed text-neutral-500">{subtitle}</span>
        ) : null}
      </span>
      {meta ? <span className="shrink-0">{meta}</span> : null}
      {trailing ??
        (interactive ? (
          <ChevronRightIcon
            className="size-6 shrink-0 text-neutral-400 transition-colors duration-200 group-hover:text-accent"
            strokeWidth={1.7}
            aria-hidden
          />
        ) : null)}
    </>
  )

  const inner = cn(
    "group flex w-full items-center gap-4 text-left no-underline transition-colors",
    dense ? "px-6 py-5" : "px-8 py-7",
    interactive && "hover:bg-neutral-100",
    className,
  )

  return (
    <li className="border-b border-neutral-200 last:border-b-0">
      {to ? (
        <Link to={to} className={inner}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={inner}>
          {body}
        </button>
      ) : (
        <div className={inner}>{body}</div>
      )}
    </li>
  )
}

export function HairlineEmpty({ children }: { children: ReactNode }) {
  return (
    <li className="px-8 py-14 text-center text-read text-neutral-500">{children}</li>
  )
}
