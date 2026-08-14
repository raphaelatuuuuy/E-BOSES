import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-10 text-center sm:py-12", className)}>
      {icon ? <div className="mb-2 text-neutral-300">{icon}</div> : null}
      <p className="text-[14px] font-semibold text-neutral-800 sm:text-[15px]">{title}</p>
      {body ? <p className="mt-1 text-[12px] text-neutral-500 sm:text-[13px]">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}
