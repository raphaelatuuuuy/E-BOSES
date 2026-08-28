import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
function Input({ className, type, ...props }) {
    return (<input type={type} data-slot="input" className={cn("border-input bg-white ring-offset-background placeholder:text-muted-foreground flex h-9 w-full rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:cursor-not-allowed disabled:opacity-50 md:text-sm", "focus-visible:border-ring focus-visible:shadow-[0_0_0_3px_rgba(255,129,51,0.15)]", "aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(220,38,38,0.15)]", className)} {...props}/>);
}
export { Input };
