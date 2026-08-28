"use client";
import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
const AccordionContext = React.createContext(null);
function useAccordion() {
    const ctx = React.useContext(AccordionContext);
    if (!ctx)
        throw new Error("Accordion components must be used within Accordion");
    return ctx;
}
function Accordion({ children, type = "single", defaultValue = [], className, }) {
    const [openItems, setOpenItems] = React.useState(defaultValue);
    const toggle = React.useCallback((value) => {
        setOpenItems((prev) => {
            if (type === "single") {
                return prev.includes(value) ? [] : [value];
            }
            return prev.includes(value)
                ? prev.filter((v) => v !== value)
                : [...prev, value];
        });
    }, [type]);
    return (<AccordionContext.Provider value={{ openItems, toggle, type }}>
      <div className={cn("flex flex-col", className)}>{children}</div>
    </AccordionContext.Provider>);
}
function AccordionItem({ value, children, className, }) {
    const { openItems } = useAccordion();
    const isOpen = openItems.includes(value);
    return (<AccordionItemContext.Provider value={value}>
      <div className={cn("", className)} data-state={isOpen ? "open" : "closed"}>
        {children}
      </div>
    </AccordionItemContext.Provider>);
}
const AccordionTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
    const { openItems, toggle } = useAccordion();
    const parentValue = React.useContext(AccordionItemContext);
    const isOpen = parentValue ? openItems.includes(parentValue) : false;
    return (<button ref={ref} type="button" onClick={() => parentValue && toggle(parentValue)} className={cn("flex w-full items-center justify-between py-4 text-left text-sm font-medium transition-all hover:underline", className)} {...props}>
      {children}
      <ChevronDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")}/>
    </button>);
});
AccordionTrigger.displayName = "AccordionTrigger";
const AccordionItemContext = React.createContext(null);
function AccordionContent({ children, className, }) {
    const { openItems } = useAccordion();
    const parentValue = React.useContext(AccordionItemContext);
    const isOpen = parentValue ? openItems.includes(parentValue) : false;
    return (<div className={cn(isOpen ? "block" : "hidden", className)}>
      {children}
    </div>);
}
export { Accordion, AccordionItem, AccordionTrigger, AccordionContent, AccordionItemContext };
