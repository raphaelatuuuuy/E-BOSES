import type { ReactNode } from "react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@workspace/ui/components/accordion"
import { cn } from "@workspace/ui/lib/utils"

type CollapsibleSectionProps = {
  value: string
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  contentClassName?: string
  defaultOpen?: boolean
}

/**
 * One section of the unified report-details surface. Many sections can be
 * open at once (the default state is "everything expanded"), each introduced
 * by a small-caps header with a chevron; the hairline dividers between
 * sections live on the caller's wrappers so the page reads as ONE surface,
 * not a stack of cards.
 */
export function CollapsibleSection({
  value,
  title,
  subtitle,
  children,
  className,
  contentClassName,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  return (
    <Accordion type="multiple" defaultValue={defaultOpen ? [value] : []} className={cn("min-w-0", className)}>
      <AccordionItem value={value} className="overflow-visible">
        <AccordionTrigger className="py-3 hover:no-underline [&>svg]:text-neutral-400">
          <span className="text-left">
            <span className="block text-[12px] font-semibold tracking-wide text-neutral-500">
              {title}
            </span>
            {subtitle ? (
              <span className="mt-1 block text-[12.5px] leading-4 font-medium tracking-normal text-neutral-400 normal-case">
                {subtitle}
              </span>
            ) : null}
          </span>
        </AccordionTrigger>
        <AccordionContent className={cn("pb-6", contentClassName)}>
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
