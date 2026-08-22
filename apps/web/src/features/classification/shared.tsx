import { useEffect, useRef, useState, type ReactNode } from "react"
import { Ban, Bell, ChevronDownIcon, CircleCheck, TriangleAlert } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import type { ConcernClassificationConfig } from "./api"

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{children}</p>
  )
}

export function readable(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not provided"
}

export function displayValue(value: string | null | undefined) {
  const normalized = readable(value)
  const labels: Record<string, string> = {
    "needs review": "Automatic result uncertain",
    "supports report": "Text and photo match",
    "partially supports report": "Photo partly supports the report",
    "contradicts report": "Text and photo may not match",
    "no useful image evidence": "Photo does not confirm the report",
    "image unavailable": "Photo could not be reviewed automatically",
    "image review failed": "Photo could not be reviewed automatically",
    accept: "Accept and continue processing",
    "accept with privacy review": "Continue using the protected image",
    "manual review": "Apply safe intake fallback",
    "request more information": "Request additional details",
    "escalate as emergency": "Notify the appropriate emergency personnel",
    "reject as irrelevant": "Review as a potentially unrelated submission",
  }
  return labels[normalized] ?? normalized
}

export function categoryLabel(config: ConcernClassificationConfig, key: string | null | undefined) {
  if (!key) return "Not clear"
  return config.categories.find((category) => category.key === key)?.label ?? readable(key)
}

export function RuleMenu({
  value,
  options,
  onChange,
  full = false,
  label,
  className,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  full?: boolean
  label?: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const current = options.find((option) => option.value === value)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white pl-3 pr-2 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300",
          full && "h-11 w-full rounded-[14px] border-[1.5px] border-neutral-300 px-4 text-[15px] font-medium text-neutral-900",
          open && "border-neutral-400",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">{label ?? current?.label ?? value}</span>
        <ChevronDownIcon className={cn("size-3.5 shrink-0 text-neutral-400 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          className={cn(
            "absolute top-full z-[1200] mt-1.5 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-1 shadow-xl",
            full ? "left-0 right-0" : "right-0 w-60",
          )}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[13px] font-medium text-neutral-900 transition-colors hover:bg-neutral-50"
            >
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.value === value ? (
                <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function verdictMeta(action: string | null | undefined) {
  const value = (action ?? "accept").replace(/_/g, " ")
  if (value === "reject as irrelevant") return { icon: Ban, tone: "text-sos" }
  if (["escalate as emergency", "request more information", "manual review"].includes(value)) {
    return { icon: TriangleAlert, tone: "text-amber-500" }
  }
  return { icon: CircleCheck, tone: "text-green-600" }
}

export const RESIDENT_MESSAGE_ICON = Bell
