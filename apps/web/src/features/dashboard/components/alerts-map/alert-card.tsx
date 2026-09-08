import type { ReactNode } from "react"
import { CircleCheckIcon } from "lucide-react"

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
  snippetLabel?: string | null
  priority?: {
    label: string
    icon: ReactNode
    className?: string
  }
  actionLabel: string | null
  resolved?: boolean
}

export function AlertCard({
  model,
  icon,
  expanded,
  onOpen,
  onAction,
  showRealIconWhenClosed,
}: {
  model: AlertCardModel
  icon: ReactNode
  expanded: boolean
  onOpen: () => void
  onAction?: () => void
  showRealIconWhenClosed?: boolean
}) {
  const { closed } = model

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white transition-colors",
        expanded
          ? "border-neutral-300 bg-neutral-50 shadow-sm"
          : "border-neutral-200"
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3 py-3 text-left sm:px-3.5"
      >
        <div className="flex items-start gap-2.5 sm:gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              closed
                ? "bg-neutral-100 text-neutral-500"
                  : model.kind === "emergency"
                    ? "bg-severity-critical-surface text-sos"
                    : "bg-brand-orange-soft text-accent"
            )}
          >
            {closed && !showRealIconWhenClosed ? (
              <CircleCheckIcon className="size-5" strokeWidth={1.9} />
            ) : (
              icon
            )}
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 text-[13px] leading-snug font-bold break-words text-neutral-900 sm:text-[14px]">
                {model.title}
              </p>
              {model.priority ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold sm:text-[12px]",
                    model.priority.className
                  )}
                  title={model.priority.label}
                >
                  {model.priority.icon}
                  {model.priority.label}
                </span>
              ) : closed ? (
                <span className="inline-flex shrink-0 items-center text-[11px] font-semibold text-neutral-500 sm:text-[12px]">
                  Resolved
                </span>
              ) : null}
            </div>
            <p
              className={cn(
                "mt-1 text-[11px] text-neutral-500 sm:text-[12px]",
                !expanded && "truncate"
              )}
            >
              {model.meta}
            </p>
            {model.status ? (
              <p
                className={cn(
                  "mt-0.5 text-[11px] font-semibold text-neutral-700 sm:text-[12px]",
                  !expanded && "truncate"
                )}
              >
                {model.status}
              </p>
            ) : null}
            {model.snippet ? (
              <div className="mt-1.5">
                {model.snippetLabel ? (
                  <p className="mb-0.5 text-[10px] font-bold tracking-[0.06em] text-neutral-400 uppercase">
                    {model.snippetLabel}
                  </p>
                ) : null}
                <p
                  className={cn(
                    "text-[12px] leading-snug break-words text-neutral-600 sm:text-[13px]",
                    !expanded && "line-clamp-2"
                  )}
                >
                  {model.snippet}
                </p>
              </div>
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
