import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function ConfigurationTable({
  children,
  label = "Configuration table",
  className,
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-neutral-200 bg-white", className)}>
      <table aria-label={label} className="w-full table-fixed border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
            <th scope="col" className="px-4 py-3 text-left sm:px-6">Information</th>
            <th scope="col" className="w-[112px] px-2 py-3 text-right sm:w-[120px] sm:px-4">Actions</th>
          </tr>
        </thead>
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
