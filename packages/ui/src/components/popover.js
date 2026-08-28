"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@workspace/ui/lib/utils";
const PopoverContext = React.createContext(null);
function Popover({ children, open: controlledOpen, onOpenChange, }) {
    const [internalOpen, setInternalOpen] = React.useState(false);
    const open = controlledOpen ?? internalOpen;
    const triggerRef = React.useRef(null);
    const setOpen = React.useCallback((value) => {
        setInternalOpen(value);
        onOpenChange?.(value);
    }, [onOpenChange]);
    return (<PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </PopoverContext.Provider>);
}
function usePopover() {
    const ctx = React.useContext(PopoverContext);
    if (!ctx)
        throw new Error("Popover components must be used within a Popover");
    return ctx;
}
const PopoverTrigger = React.forwardRef(({ className, children, onClick, ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();
    const setRefs = React.useCallback((node) => {
        triggerRef.current = node;
        if (typeof ref === "function")
            ref(node);
        else if (ref)
            ref.current = node;
    }, [ref, triggerRef]);
    return (<button ref={setRefs} type="button" className={cn(className)} aria-expanded={open} onClick={(event) => {
            onClick?.(event);
            if (!event.defaultPrevented)
                setOpen(!open);
        }} {...props}>
      {children}
    </button>);
});
PopoverTrigger.displayName = "PopoverTrigger";
function computePosition(trigger, content, side = "bottom") {
    const rect = trigger.getBoundingClientRect();
    const contentHeight = content.offsetHeight || 320;
    const contentWidth = Math.max(content.offsetWidth || 300, 280);
    const gap = 8;
    const viewportPadding = 12;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const placeAbove = side === "top" || (side === "auto" && spaceBelow < 160 && spaceAbove > spaceBelow);
    const top = placeAbove
        ? Math.max(viewportPadding, rect.top - contentHeight - gap)
        : rect.bottom + gap;
    let left = rect.left;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - contentWidth - viewportPadding));
    return { top, left, maxHeight: undefined };
}
const PopoverContent = React.forwardRef(({ className, style, side = "bottom", ...props }, ref) => {
    const { open, setOpen, triggerRef } = usePopover();
    const contentRef = React.useRef(null);
    const [coords, setCoords] = React.useState(null);
    const updatePosition = React.useCallback(() => {
        const trigger = triggerRef.current;
        const content = contentRef.current;
        if (!trigger || !content)
            return;
        const next = computePosition(trigger, content, side);
        setCoords({ top: next.top, left: next.left, maxHeight: next.maxHeight });
    }, [triggerRef, side]);
    React.useLayoutEffect(() => {
        if (!open)
            return;
        updatePosition();
        const raf = requestAnimationFrame(updatePosition);
        const t = window.setTimeout(updatePosition, 50);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            cancelAnimationFrame(raf);
            window.clearTimeout(t);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [open, updatePosition]);
    React.useEffect(() => {
        if (!open)
            return;
        function handleClickOutside(e) {
            const target = e.target;
            if (contentRef.current?.contains(target))
                return;
            if (triggerRef.current?.contains(target))
                return;
            setOpen(false);
        }
        function handleKeyDown(e) {
            if (e.key === "Escape")
                setOpen(false);
        }
        const timer = window.setTimeout(() => {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleKeyDown);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open, setOpen, triggerRef]);
    if (!open || typeof document === "undefined")
        return null;
    return createPortal(<div ref={(node) => {
            contentRef.current = node;
            if (typeof ref === "function")
                ref(node);
            else if (ref)
                ref.current = node;
        }} data-slot="popover-content" className={cn("z-[200] w-auto overflow-visible rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden", className)} style={{
            position: "fixed",
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            maxHeight: coords?.maxHeight,
            visibility: coords ? "visible" : "hidden",
            ...style,
        }} {...props}/>, document.body);
});
PopoverContent.displayName = "PopoverContent";
export { Popover, PopoverContent, PopoverTrigger };
