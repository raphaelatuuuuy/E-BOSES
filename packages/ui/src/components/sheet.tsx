"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

type SheetSide = "bottom" | "top" | "left" | "right"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheet() {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error("Sheet components must be used within a Sheet")
  return ctx
}

function Sheet({
  children,
  open: controlledOpen,
  onOpenChange,
  lockScroll = true,
}: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Locks `document.body` scroll while the sheet is open (default `true`,
   * matching every existing modal-style usage). Set to `false` for
   * persistently-open, non-modal docks — e.g. an always-`open` bottom panel
   * over a full-bleed page that never scrolls the body itself — so mounting
   * the sheet doesn't leave body scroll locked for the page's whole
   * lifetime. Restored on unmount either way.
   */
  lockScroll?: boolean
}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = controlledOpen ?? internalOpen

  const setOpen = React.useCallback(
    (value: boolean) => {
      setInternalOpen(value)
      onOpenChange?.(value)
    },
    [onOpenChange],
  )

  React.useEffect(() => {
    if (!lockScroll) return
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open, lockScroll])

  React.useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open, setOpen])

  return (
    <SheetContext.Provider value={{ open, setOpen }}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = useSheet()
  return (
    <button
      type="button"
      className={className}
      onClick={() => setOpen(true)}
      {...props}
    >
      {children}
    </button>
  )
}

function SheetOverlay({ className }: { className?: string }) {
  const { setOpen } = useSheet()
  return (
    <div
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      onClick={() => setOpen(false)}
    />
  )
}

const sidePanelClass: Record<SheetSide, string> = {
  bottom:
    "inset-x-0 bottom-0 top-auto max-h-[85vh] w-full rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
  top: "inset-x-0 top-0 bottom-auto max-h-[85vh] w-full rounded-b-2xl",
  left: "inset-y-0 left-0 right-auto h-full w-full max-w-sm rounded-r-2xl",
  right: "inset-y-0 right-0 left-auto h-full w-full max-w-sm rounded-l-2xl",
}

function SheetContent({
  className,
  children,
  overlayClassName,
  side = "bottom",
  showHandle = true,
  ...props
}: React.ComponentProps<"div"> & {
  overlayClassName?: string
  side?: SheetSide
  showHandle?: boolean
}) {
  const { open } = useSheet()

  if (!open) return null

  return (
    <>
      <SheetOverlay className={overlayClassName} />
      <div
        className={cn(
          "fixed z-50 flex flex-col border border-border/50 bg-background shadow-2xl",
          sidePanelClass[side],
          className,
        )}
        {...props}
      >
        {side === "bottom" && showHandle ? (
          <div className="flex shrink-0 items-center justify-center pt-2.5 pb-1">
            <span className="h-1.5 w-10 rounded-full bg-neutral-300" aria-hidden />
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </>
  )
}

function SheetHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { setOpen } = useSheet()
  const title = React.Children.toArray(children).find(
    (child) => React.isValidElement(child) && child.type === SheetTitle,
  )

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border/50 px-4 py-3 sm:px-6 sm:py-4",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{title || children}</div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="ml-4 flex size-7 shrink-0 items-center justify-center rounded-lg text-black transition-colors hover:bg-muted hover:text-black sm:size-8"
        aria-label="Close"
      >
        <XIcon className="size-4 text-black" />
      </button>
    </div>
  )
}

function SheetBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex-1 px-4 pb-4 pt-4 space-y-4",
        "sm:px-6 sm:py-5 sm:space-y-5",
        className,
      )}
      {...props}
    />
  )
}

function SheetFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "shrink-0 border-t border-border/50 px-4 py-3",
        "sm:px-6 sm:py-4",
        className,
      )}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("text-base font-semibold text-foreground sm:text-lg", className)}
      {...props}
    />
  )
}

function SheetClose({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = useSheet()
  return (
    <button
      type="button"
      onClick={() => setOpen(false)}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted",
        className,
      )}
      {...props}
    >
      {children ?? "Close"}
    </button>
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetClose,
  useSheet,
}
