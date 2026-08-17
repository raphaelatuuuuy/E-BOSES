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
  onChange,
  ...props
}: FloatingLabelInputProps) {
  const [focused, setFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [hasValue, setHasValue] = React.useState(() => value != null && String(value) !== "")

  React.useEffect(() => {
    const el = inputRef.current
    if (!el) return
    setHasValue(el.value !== "")
  }, [id])

  const isFloating = focused || hasValue

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        value={value}
        placeholder=""
        {...props}
        onChange={(event) => {
          setHasValue(event.target.value !== "")
          onChange?.(event)
        }}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        className={cn(
          "peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
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
          "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
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
