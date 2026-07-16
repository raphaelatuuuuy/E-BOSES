"use client"

import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@workspace/ui/lib/utils"

interface PopoverContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
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
  const triggerRef = React.useRef<HTMLElement | null>(null)

  const setOpen = React.useCallback(
    (value: boolean) => {
      setInternalOpen(value)
      onOpenChange?.(value)
    },
    [onOpenChange],
  )

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
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
>(({ className, children, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopover()

  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref, triggerRef],
  )

  return (
    <button
      ref={setRefs}
      type="button"
      className={cn(className)}
      aria-expanded={open}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) setOpen(!open)
      }}
      {...props}
    >
      {children}
    </button>
  )
})
PopoverTrigger.displayName = "PopoverTrigger"

type PopoverSide = "bottom" | "top" | "auto"

function computePosition(
  trigger: HTMLElement,
  content: HTMLElement,
  side: PopoverSide = "bottom",
) {
  const rect = trigger.getBoundingClientRect()
  const contentHeight = content.offsetHeight || 320
  const contentWidth = Math.max(content.offsetWidth || 300, 280)
  const gap = 8
  const viewportPadding = 12

  const spaceBelow = window.innerHeight - rect.bottom - gap
  const spaceAbove = rect.top - gap

  let placeAbove = false
  if (side === "top") {
    placeAbove = true
  } else if (side === "auto") {
    placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
  } else {
    // Always prefer below the input (never cover it).
    placeAbove = false
  }

  let top = placeAbove
    ? Math.max(viewportPadding, rect.top - contentHeight - gap)
    : rect.bottom + gap

  // Keep panel starting below the trigger so it never covers the input.
  if (!placeAbove) {
    top = Math.max(top, rect.bottom + gap)
  }

  // Hard rule: never overlap the trigger when side is bottom.
  // Do not clamp upward — page can scroll so the full panel is visible.
  if (!placeAbove && top < rect.bottom + gap) {
    top = rect.bottom + gap
  }

  let left = rect.left
  left = Math.max(
    viewportPadding,
    Math.min(left, window.innerWidth - contentWidth - viewportPadding),
  )

  return { top, left, maxHeight: undefined as number | undefined }
}

const PopoverContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { side?: PopoverSide }
>(({ className, style, side = "bottom", ...props }, ref) => {
  const { open, setOpen, triggerRef } = usePopover()
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = React.useState<{
    top: number
    left: number
    maxHeight?: number
  } | null>(null)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!trigger || !content) return
    const next = computePosition(trigger, content, side)
    setCoords({ top: next.top, left: next.left, maxHeight: next.maxHeight })
  }, [triggerRef, side])

  React.useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    const t = window.setTimeout(updatePosition, 50)

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (contentRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }

    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("keydown", handleKeyDown)
    }, 0)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, setOpen, triggerRef])

  if (!open || !mounted) return null

  return createPortal(
    <div
      ref={(node) => {
        contentRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
      }}
      data-slot="popover-content"
      className={cn(
        "z-[200] w-auto overflow-visible rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        maxHeight: coords?.maxHeight,
        visibility: coords ? "visible" : "hidden",
        ...style,
      }}
      {...props}
    />,
    document.body,
  )
})
PopoverContent.displayName = "PopoverContent"

export { Popover, PopoverContent, PopoverTrigger }
