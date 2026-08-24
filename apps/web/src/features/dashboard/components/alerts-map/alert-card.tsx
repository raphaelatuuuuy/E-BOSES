import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

export type AlertCardModel = {
  kind: "emergency" | "concern" | "advisory"
  id: number
  live: boolean
  closed: boolean
  title: string
  meta: string
  status: string | null
  snippet: string
  actionLabel: string | null
}

export function AlertCard({
  model,
  icon,
  expanded,
  onOpen,
  onAction,
}: {
  model: AlertCardModel
  icon: ReactNode
  expanded: boolean
  onOpen: () => void
  onAction?: () => void
}) {
  const { closed } = model

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded ? "border-neutral-300 bg-neutral-50 shadow-sm" : "border-neutral-200",
      )}
    >
      <button type="button" onClick={onOpen} className="w-full px-3 py-3 text-left sm:px-3.5">
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              closed
                ? "bg-neutral-100 text-neutral-400"
                : model.kind === "emergency"
                  ? "bg-severity-critical-surface text-sos"
                  : "bg-brand-orange-soft text-accent",
            )}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 break-words text-[13px] font-bold leading-snug text-neutral-900 sm:text-[14px]">
                {model.title}
              </p>
              {closed ? (
                <span className="inline-flex shrink-0 items-center text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                  Resolved
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-[11px] text-neutral-500 sm:text-[12px]">
              {model.meta}
            </p>
            {model.status ? (
              <p className="mt-0.5 truncate text-[11px] font-semibold text-neutral-700 sm:text-[12px]">
                {model.status}
              </p>
            ) : null}
            {model.snippet ? (
              <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-snug text-neutral-600 sm:text-[13px]">
                {model.snippet}
              </p>
            ) : null}
          </div>
        </div>
      </button>

      {model.actionLabel && onAction ? (
        <div className="border-t border-neutral-100 px-3 py-2 sm:px-3.5 sm:py-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onAction()
            }}
            className="flex h-9 w-full items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12px] font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 sm:text-[13px]"
          >
            {model.actionLabel}
          </button>
        </div>
      ) : null}
    </div>
  )
}
