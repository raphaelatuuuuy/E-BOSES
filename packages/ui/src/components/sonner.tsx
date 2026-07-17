"use client"

import { XIcon } from "lucide-react"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      position="top-right"
      className="toaster group font-sans"
      closeButton
      icons={{
        close: <XIcon className="size-3.5 shrink-0 text-black" strokeWidth={2.5} aria-hidden />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg font-sans",
          description: "group-[.toast]:text-muted-foreground font-sans",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-sans",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground font-sans",
          // Black X in-flow on the right, aligned with toast text (see globals.css)
          closeButton:
            "!static !order-20 !ml-auto !border-0 !bg-transparent !text-black !shadow-none hover:!bg-neutral-100 [&>svg]:!text-black",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
