import { SunIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useOpsContrast } from "@/features/dashboard/lib/ops-contrast"

/** 44px icon button that flips the responder console into sunlight mode. */
export function OpsContrastToggle({ className }: { className?: string }) {
  const { enabled, toggle } = useOpsContrast()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      aria-label={enabled ? "Turn sunlight contrast off" : "Turn sunlight contrast on"}
      title={enabled ? "Sunlight contrast: on" : "Sunlight contrast: off"}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-subtle-foreground transition-colors duration-[--duration-micro] hover:bg-card-raised hover:text-foreground",
        enabled && "bg-card-raised text-ice",
        className,
      )}
    >
      <SunIcon className="size-5" />
    </button>
  )
}
