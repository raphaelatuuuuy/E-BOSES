import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Fact({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode
  value: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-meta text-neutral-400">{label}</p>
      <div className="mt-1 text-row text-brand-navy">{value}</div>
      {hint ? <p className="mt-1 text-meta leading-relaxed text-neutral-500">{hint}</p> : null}
    </div>
  )
}

export function FactRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap gap-x-12 gap-y-6", className)}>{children}</div>
}

export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("divide-y divide-neutral-200", className)}>{children}</dl>
}

export function FactListRow({
  label,
  value,
  className,
}: {
  label: ReactNode
  value: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-5", className)}>
      <dt className="text-meta text-neutral-500">{label}</dt>
      <dd className="min-w-0 text-read text-brand-navy">{value}</dd>
    </div>
  )
}
