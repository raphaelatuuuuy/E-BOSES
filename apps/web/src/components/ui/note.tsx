import type { ReactNode } from "react"
import { InfoIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border border-brand-orange-soft bg-brand-orange-soft/60 px-4 py-3",
        className,
      )}
    >
      <InfoIcon className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.9} aria-hidden />
      <div className="min-w-0 flex-1 text-read leading-relaxed text-brand-navy">{children}</div>
    </div>
  )
}
