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
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleOpen = React.useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setOpen(true)
  }, [])

  const handleClose = React.useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }, [])

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
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

interface HoverCardContentProps extends React.ComponentProps<"div"> {
  side?: "top" | "bottom"
}

const HoverCardContent = React.forwardRef<
  HTMLDivElement,
  HoverCardContentProps
>(({ className, side = "top", ...props }, ref) => {
  const { open } = useHoverCard()

  if (!open) return null

  return (
    <div
      ref={ref}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",
        "absolute left-1/2 -translate-x-1/2",
        side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
        className,
      )}
      {...props}
    />
  )
})
HoverCardContent.displayName = "HoverCardContent"

export { HoverCard, HoverCardContent, HoverCardTrigger }
