"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

const Separator = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("shrink-0 bg-border h-px w-full", className)}
      role="separator"
      aria-orientation="horizontal"
      {...props}
    />
  )
})
Separator.displayName = "Separator"

export { Separator }
