import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

export function Avatar({ className, online = false, children, ...props }: React.ComponentProps<"span"> & { online?: boolean }) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative flex size-9 shrink-0 rounded-full bg-slate-soft",
        className,
      )}
      {...props}
    >
      <span className="flex size-full overflow-hidden rounded-full">
        {children}
      </span>
      <span
        className={cn(
          "pointer-events-none absolute right-[-1px] bottom-[-1px] z-10 size-2.5 rounded-full border-2 border-white",
          online ? "bg-emerald-500" : "bg-slate-400",
        )}
        title={online ? "Online" : "Offline"}
        aria-label={online ? "Online" : "Offline"}
      />
    </span>
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
        "flex size-full items-center justify-center rounded-full bg-slate-soft text-[12px] font-bold text-navy-muted",
        className,
      )}
      {...props}
    />
  )
}
