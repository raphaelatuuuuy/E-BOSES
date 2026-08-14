import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-x-8 gap-y-4", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-page-title text-brand-navy">{title}</h1>
        {subtitle ? <p className="mt-3 max-w-2xl text-read text-neutral-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  )
}

export function PageSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("mt-14", className)}>
      {title ? (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-section text-brand-navy">{title}</h2>
            {description ? (
              <p className="mt-2 max-w-2xl text-meta text-neutral-500">{description}</p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}
