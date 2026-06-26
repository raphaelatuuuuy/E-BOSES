import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        "has-[[aria-disabled=true]]:pointer-events-none has-[[aria-disabled=true]]:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
