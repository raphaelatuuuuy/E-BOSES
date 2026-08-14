"use client"

import { AlertTriangleIcon, XIcon } from "lucide-react"
import { Toaster as Sonner } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

type ToasterProps = React.ComponentProps<typeof Sonner> & {
  /** "responder" styles the toast for the dark dispatch console. */
  variant?: "default" | "responder"
}

const DEFAULT_CLASSES = {
  toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg font-sans",
  description: "group-[.toast]:text-muted-foreground font-sans",
  actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-sans",
  cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground font-sans",
  closeButton:
    "!static !order-20 !ml-auto !border-0 !bg-transparent !text-black !shadow-none hover:!bg-neutral-100 [&>svg]:!text-black",
}

/**
 * Responder console variant — the dark card of the dispatch screens, with the
 * SOS red reserved for the icons and actions that mean "press me now". A
 * dispatch alert arriving as a white card with a black close button would be
 * the one light element in a dark console.
 */
const RESPONDER_CLASSES = {
  toast: "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-card-line-strong group-[.toaster]:shadow-[0_10px_32px_rgba(15,23,42,0.5)] font-sans",
  title: "group-[.toast]:font-bold",
  description: "group-[.toast]:text-muted-foreground font-sans",
  actionButton: "group-[.toast]:bg-sos group-[.toast]:text-white font-sans font-bold",
  cancelButton: "group-[.toast]:bg-card-raised group-[.toast]:text-foreground font-sans",
  closeButton:
    "!static !order-20 !ml-auto !border-0 !bg-transparent !text-white !shadow-none hover:!bg-card-raised [&>svg]:!text-white",
}

const Toaster = ({ variant = "default", ...props }: ToasterProps) => {
  const responder = variant === "responder"
  return (
    <Sonner
      position="top-right"
      className="toaster group font-sans"
      closeButton
      icons={{
        warning: (
          <AlertTriangleIcon
            className="size-4 shrink-0 text-sos"
            strokeWidth={2.2}
            aria-hidden
          />
        ),
        close: (
          <XIcon
            className={cn(
              "size-3.5 shrink-0",
              responder ? "text-white" : "text-black",
            )}
            strokeWidth={2.5}
            aria-hidden
          />
        ),
      }}
      toastOptions={{
        classNames: responder ? RESPONDER_CLASSES : DEFAULT_CLASSES,
      }}
      {...props}
    />
  )
}

export { Toaster }
