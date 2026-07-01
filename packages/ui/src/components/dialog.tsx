"use client"

import * as React from "react"
import { XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialog() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog components must be used within a Dialog")
  return ctx
}

function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
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
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = useDialog()
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

function DialogOverlay() {
  const { setOpen } = useDialog()
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onClick={() => setOpen(false)}
    />
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { open } = useDialog()

  if (!open) return null

  return (
    <>
      <DialogOverlay />
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 top-auto z-50 flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-border/50 bg-background shadow-2xl",
          "sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:right-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-lg sm:rounded-2xl sm:max-h-[90vh]",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </>
  )
}

function DialogHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const { setOpen } = useDialog()
  const title = React.Children.toArray(children).find(
    (child) => React.isValidElement(child) && child.type === DialogTitle,
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
        className="ml-4 flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-8"
        aria-label="Close"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

function DialogBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto px-4 pb-4 pt-4 space-y-4",
        "sm:px-6 sm:py-5 sm:space-y-5",
        className,
      )}
      {...props}
    />
  )
}

function DialogFooter({
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

function DialogTitle({
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

function DialogClose({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = useDialog()
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
      {children ?? "Back"}
    </button>
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogClose,
}
