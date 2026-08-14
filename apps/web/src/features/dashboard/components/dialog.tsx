import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

interface DialogProps {
  open: boolean
  onClose: () => void
  maxW?: string
  children: ReactNode
  containerClassName?: string
}

export function Dialog({ open, onClose, maxW = "max-w-lg", children, containerClassName }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // Always portal a stable host so open/close doesn't thrash body children
  // (avoids NotFoundError: removeChild when unmount races with Leaflet/portals).
  if (typeof document === "undefined") return null

  return createPortal(
    open ? (
      <div
        className={cn(
          "fixed inset-0 flex items-center justify-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
          containerClassName ?? "z-[200]",
        )}
      >
        {/* Overlay */}
        <div
          ref={overlayRef}
          className="absolute inset-0 bg-black/40"
          onClick={onClose}
        />

        {/* Content */}
        <div
          ref={contentRef}
          className={cn(
            "z-10 flex w-full flex-col overflow-hidden bg-background",
            "fixed inset-0 md:relative md:max-h-[90vh] md:rounded-2xl md:border md:border-border md:shadow-2xl",
            "motion-safe:md:animate-in motion-safe:md:fade-in motion-safe:md:zoom-in-95 motion-safe:md:duration-200 motion-safe:md:ease-out",
            maxW,
          )}
        >
          {children}
        </div>
      </div>
    ) : null,
    document.body,
  )
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("shrink-0 border-b border-border/50 px-6 py-4", className)}
      {...props}
    />
  )
}

export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("scrollbar-hide flex-1 overflow-y-auto px-6 py-5 space-y-5", className)}
      style={{ scrollbarWidth: "none" }}
      {...props}
    />
  )
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("shrink-0 border-t border-border/50 px-6 py-4", className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2 className={cn("text-lg font-semibold text-foreground", className)} {...props} />
  )
}

export function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <XIcon className="size-4" />
    </button>
  )
}
