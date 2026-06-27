"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface PopoverContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null)

function Popover({
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

  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      {children}
    </PopoverContext.Provider>
  )
}

function usePopover() {
  const ctx = React.useContext(PopoverContext)
  if (!ctx) throw new Error("Popover components must be used within a Popover")
  return ctx
}

const PopoverTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button">
>(({ className, children, ...props }, ref) => {
  const { open, setOpen } = usePopover()
  return (
    <button
      ref={ref}
      type="button"
      className={cn(className)}
      onClick={() => setOpen(!open)}
      {...props}
    >
      {children}
    </button>
  )
})
PopoverTrigger.displayName = "PopoverTrigger"

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  const { open, setOpen } = usePopover()
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      ref={(node) => {
        contentRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      className={cn(
        "z-50 w-auto rounded-none border bg-popover p-0 text-popover-foreground shadow-md outline-none",
        "absolute left-0 top-full mt-1",
        className,
      )}
      {...props}
    />
  )
})
PopoverContent.displayName = "PopoverContent"

export { Popover, PopoverContent, PopoverTrigger }
