import type { ReactNode } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/ui/components/accordion"
import { cn } from "@workspace/ui/lib/utils"

type CollapsibleSectionProps = {
  value: string
  title: string
  children: ReactNode
  className?: string
  contentClassName?: string
  defaultOpen?: boolean
}

export function CollapsibleSection({
  value,
  title,
  children,
  className,
  contentClassName,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  return (
    <Accordion type="single" defaultValue={defaultOpen ? [value] : []} className={className}>
      <AccordionItem
        value={value}
        className="overflow-hidden rounded-2xl border border-card-line bg-card"
      >
        <AccordionTrigger className="px-4 py-3 hover:no-underline [&>svg]:text-subtle-foreground">
          <span className="text-[13px] font-semibold tracking-wide text-subtle-foreground uppercase">
            {title}
          </span>
        </AccordionTrigger>
        <AccordionContent
          className={cn("border-t border-card-line px-4 pb-4 pt-4", contentClassName)}
        >
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
