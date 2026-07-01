"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface HoverCardContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const HoverCardContext = React.createContext<HoverCardContextValue | null>(null)

function HoverCard({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>()

  const handleOpen = React.useCallback(() => {
    clearTimeout(timeoutRef.current)
    setOpen(true)
  }, [])

  const handleClose = React.useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }, [])

  React.useEffect(() => {
    return () => clearTimeout(timeoutRef.current)
  }, [])

  return (
    <HoverCardContext.Provider value={{ open, setOpen }}>
      <div
        className="relative inline-flex"
        onMouseEnter={handleOpen}
        onMouseLeave={handleClose}
        onFocus={handleOpen}
        onBlur={handleClose}
      >
        {children}
      </div>
    </HoverCardContext.Provider>
  )
}

function useHoverCard() {
  const ctx = React.useContext(HoverCardContext)
  if (!ctx) throw new Error("HoverCard components must be used within a HoverCard")
  return ctx
}

const HoverCardTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button">
>(({ className, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(className)}
      {...props}
    >
      {children}
    </button>
  )
})
HoverCardTrigger.displayName = "HoverCardTrigger"

const HoverCardContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
  const { open } = useHoverCard()

  if (!open) return null

  return (
    <div
      ref={ref}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
        "absolute bottom-full left-1/2 mb-2 -translate-x-1/2",
        className,
      )}
      {...props}
    />
  )
})
HoverCardContent.displayName = "HoverCardContent"

export { HoverCard, HoverCardContent, HoverCardTrigger }
