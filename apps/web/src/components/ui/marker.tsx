import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Marker({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker"
      className={cn("flex w-full justify-center py-1", className)}
      {...props}
    />
  )
}

export function MarkerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker-content"
      className={cn(
        "rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[11px] font-medium text-neutral-500 shadow-sm",
        className,
      )}
      {...props}
    />
  )
}
