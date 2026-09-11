import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { useBottomSheetSnap } from "@/features/dashboard/lib/use-bottom-sheet-snap"

interface DialogProps {
  open: boolean
  onClose: () => void
  maxW?: string
  children: ReactNode
  containerClassName?: string
  mobileSheet?: boolean
}

export function Dialog({ open, onClose, maxW = "max-w-lg", children, containerClassName, mobileSheet }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  )
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)")
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const useSheet = mobileSheet && isMobile

  const sheet = useBottomSheetSnap({
    enabled: open && useSheet,
    initialMode: "expanded",
    onSettle: () => {
      if (sheet.mode === "hidden") onClose()
    },
  })

  useEffect(() => {
    if (useSheet && open) sheet.snapTo("expanded")
  }, [open, useSheet])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

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

        {useSheet ? (
          /* Mobile bottom sheet */
          <div
            ref={contentRef}
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-2xl border border-neutral-200 border-b-0 bg-background shadow-[0_-10px_36px_rgba(15,23,42,.18)]",
              !sheet.dragging && "transition-[height] duration-200 ease-out",
            )}
            style={{ height: sheet.height }}
          >
            {/* Drag handle */}
            <div
              onPointerDown={sheet.onHandlePointerDown}
              onPointerMove={sheet.onHandlePointerMove}
              onPointerUp={sheet.onHandlePointerUp}
              onPointerCancel={sheet.onHandlePointerUp}
              className="flex shrink-0 touch-none cursor-grab flex-col items-center bg-white px-3 pb-1 pt-2 active:cursor-grabbing"
            >
              <span className="mb-1 h-1.5 w-11 rounded-full bg-neutral-300" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {children}
            </div>
          </div>
        ) : (
          /* Normal centered dialog (desktop + non-mobileSheet) */
          <div
            ref={contentRef}
            className={cn(
              "z-10 flex w-full flex-col overflow-hidden bg-background",
              "fixed inset-0 md:relative md:max-h-[90vh] md:rounded-2xl md:border md:border-border md:shadow-2xl",
              "md:resize md:overflow-auto dialog-resize-grip md:min-w-[420px] md:min-h-[380px]",
              "motion-safe:transition-[max-width] motion-safe:duration-200 motion-safe:ease-out",
              "motion-safe:md:animate-in motion-safe:md:fade-in motion-safe:md:zoom-in-95 motion-safe:md:duration-200 motion-safe:md:ease-out",
              maxW,
            )}
            style={{ scrollbarWidth: "none" }}
          >
            {children}
          </div>
        )}
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
