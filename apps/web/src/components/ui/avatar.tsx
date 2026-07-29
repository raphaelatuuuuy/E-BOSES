import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Avatar({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative flex size-9 shrink-0 overflow-hidden rounded-full bg-neutral-100",
        className,
      )}
      {...props}
    />
  )
}

export function AvatarImage({ className, alt, ...props }: React.ComponentProps<"img">) {
  return (
    <img
      data-slot="avatar-image"
      alt={alt}
      className={cn("aspect-square size-full object-cover", className)}
      {...props}
    />
  )
}

export function AvatarFallback({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-neutral-200 text-[12px] font-bold text-neutral-700",
        className,
      )}
      {...props}
    />
  )
}
