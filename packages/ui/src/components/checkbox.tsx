"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 rounded-none border border-primary shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
