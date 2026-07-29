import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "flex w-full gap-2",
        align === "end" ? "flex-row-reverse" : "flex-row",
        className,
      )}
      {...props}
    />
  )
}

export function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-avatar" className={cn("shrink-0 self-start", className)} {...props} />
}

export function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="message-content" className={cn("flex max-w-[82%] min-w-0 flex-col gap-1", className)} {...props} />
}

export function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn("px-0.5 text-[10px] font-medium leading-4 text-neutral-400", className)}
      {...props}
    />
  )
}
