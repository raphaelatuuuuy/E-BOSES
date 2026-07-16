"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface FloatingLabelInputProps extends React.ComponentProps<"input"> {
  label: string
}

function FloatingLabelInput({
  label,
  className,
  id,
  value,
  onFocus,
  onBlur,
  ...props
}: FloatingLabelInputProps) {
  const [focused, setFocused] = React.useState(false)
  const hasValue = value !== undefined && value !== ""
  const isFloating = focused || hasValue

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        placeholder=""
        {...props}
        onFocus={(e) => {
          setFocused(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        className={cn(
          "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
          // Value sits under the floating label band
          "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
          "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
          "shadow-none focus-visible:shadow-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
      <label
        htmlFor={id}
        className={cn(
          // Match input text: border inset + pl-4 so label and value share the same left edge
          "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
          // border-2 → +2px; focus border-[3px] → +3px
          "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
          isFloating
            ? "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]"
            : "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5",
          "peer-aria-invalid:text-destructive",
        )}
      >
        {label}
      </label>
    </div>
  )
}

export { FloatingLabelInput }
