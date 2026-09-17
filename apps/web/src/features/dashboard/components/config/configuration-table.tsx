import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function ConfigurationTable({
  children,
  label = "Configuration table",
  className,
  actionsHeader = "Actions",
  hideHeader = false,
}: {
  children: ReactNode
  label?: string
  className?: string
  actionsHeader?: string | null
  hideHeader?: boolean
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-neutral-200 bg-white", className)}>
      <table aria-label={label} className="w-full table-fixed border-collapse">
        {hideHeader ? null : (
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
            <th scope="col" className="px-4 py-3 text-left sm:px-6">Information</th>
            <th scope="col" className="w-[112px] px-2 py-3 text-right sm:w-[120px] sm:px-4">{actionsHeader ?? <span className="sr-only">Actions</span>}</th>
          </tr>
        </thead>
        )}
        <tbody className="divide-y divide-neutral-100">{children}</tbody>
      </table>
    </div>
  )
}

export function ConfigurationTableRow({
  children,
  actions,
  className,
}: {
  children: ReactNode
  actions: ReactNode
  className?: string
}) {
  return (
    <tr className={cn("transition-colors hover:bg-neutral-50", className)}>
      <td className="min-w-0 max-w-0 px-4 py-4 align-middle sm:px-6 sm:py-5">{children}</td>
      <td className="w-[112px] px-2 py-4 align-middle sm:w-[120px] sm:px-4 sm:py-5">
        <div className="flex items-center justify-end gap-1">{actions}</div>
      </td>
    </tr>
  )
}

export function ConfigurationTableEmpty({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={2} className="px-4 py-14 text-center text-read text-neutral-500 sm:px-6">
        {children}
      </td>
    </tr>
  )
}

export interface ConfigurationRowContentProps {
  icon: LucideIcon
  title: ReactNode
  subtext?: ReactNode
  badge?: ReactNode
  description?: ReactNode
  className?: string
}

/** One row body for every configuration list: icon, header, subtext, description. */
export function ConfigurationRowContent({
  icon: Icon,
  title,
  subtext,
  badge,
  description,
  className,
}: ConfigurationRowContentProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 text-[15px] leading-snug font-bold text-neutral-900">
          <Icon className="size-5 shrink-0 text-neutral-700" strokeWidth={1.9} aria-hidden />
          {title}
        </span>
        {subtext ? <span className="text-meta text-neutral-400">{subtext}</span> : null}
        {badge}
      </div>
      {description ? (
        <p className="mt-1 break-words text-[13px] text-neutral-500">{description}</p>
      ) : null}
    </div>
  )
}

export function ConfigurationInfoRow({
  actions,
  ...content
}: ConfigurationRowContentProps & { actions: ReactNode }) {
  return (
    <ConfigurationTableRow actions={actions} className={content.className}>
      <ConfigurationRowContent {...content} />
    </ConfigurationTableRow>
  )
}

