"use client";
import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
const CHECKBOX_CHECKMARK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none'%3E%3Cpath d='M3.5 8.5 6.5 11.5 12.5 5.5' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";
const Checkbox = React.forwardRef(({ className, style, ...props }, ref) => {
    return (<input type="checkbox" className={cn(
        // Slightly square corners (sign-up style) + orange checked state (theme primary)
        "size-4 shrink-0 appearance-none rounded-[5px] border-2 border-input bg-white bg-center bg-no-repeat shadow-none transition-[color,box-shadow,border-color] checked:border-primary checked:bg-primary checked:bg-[image:var(--checkbox-checkmark)] checked:bg-[length:0.7rem_0.7rem] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)] aria-invalid:focus-visible:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50", className)} ref={ref} style={{
            ...style,
            ["--checkbox-checkmark"]: CHECKBOX_CHECKMARK,
        }} {...props}/>);
});
Checkbox.displayName = "Checkbox";
export { Checkbox };
