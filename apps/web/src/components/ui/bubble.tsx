import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

type BubbleVariant = "default" | "muted"

export function Bubble({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: BubbleVariant }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(
        "relative w-fit max-w-full rounded-2xl border border-neutral-200 px-3 py-2 text-[13px] leading-5 text-neutral-900",
        variant === "default" ? "rounded-br-md bg-white" : "rounded-bl-md bg-white",
        className,
      )}
      {...props}
    />
  )
}

export function BubbleContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-content" className={cn("whitespace-pre-wrap", className)} {...props} />
}

export function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-group" className={cn("flex flex-col gap-1.5", className)} {...props} />
}

export function BubbleReactions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-reactions"
      className={cn(
        "absolute -bottom-3 right-2 inline-flex min-h-6 items-center gap-1 rounded-full border border-neutral-200 bg-white px-1.5 text-[11px] shadow-sm",
        className,
      )}
      {...props}
    />
  )
}