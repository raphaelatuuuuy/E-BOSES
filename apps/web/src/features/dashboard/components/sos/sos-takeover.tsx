import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { cn } from "@workspace/ui/lib/utils"

export function SosTakeover({
  open,
  onClose,
  label,
  labelledBy,
  describedBy,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  label?: string
  labelledBy?: string
  describedBy?: string
  className?: string
  children: ReactNode
}) {
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

  if (typeof document === "undefined" || !open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={cn("fixed inset-0 z-[400] flex flex-col", className)}
    >
      {children}
    </div>,
    document.body
  )
}
