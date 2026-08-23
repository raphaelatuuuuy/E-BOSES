"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"

interface FloatingLabelInputProps extends React.ComponentProps<"input"> {
  label: string
  /** Fixed, unerasable text shown ahead of the value, e.g. a `+63` dial code. */
  prefix?: string
}

const AUTOFILL_ANIMATION = "eboses-autofill-start"

function FloatingLabelInput({
  label,
  prefix,
  className,
  id,
  value,
  placeholder,
  onFocus,
  onBlur,
  onChange,
  ...props
}: FloatingLabelInputProps) {
  const [focused, setFocused] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  // Derived, not mirrored: a controlled field already knows whether it holds a
  // value, so the state below only covers the uncontrolled and autofilled cases.
  const [domFilled, setDomFilled] = React.useState(false)
  const hasValue = (value != null && String(value) !== "") || domFilled

  /**
   * The browser fills a saved login before React has attached its listeners, so
   * no change event ever reaches this component: the label stayed centred over
   * the filled text, and — because these inputs are controlled — the form still
   * submitted the empty React value. Reading the DOM back and replaying it as a
   * change keeps both the label and the form state truthful.
   */
  const latest = React.useRef({ value, onChange })
  React.useEffect(() => {
    latest.current = { value, onChange }
  })

  const syncRef = React.useRef<() => void>(() => {})
  React.useEffect(() => {
    const sync = () => {
      const input = inputRef.current
      if (!input) return
      const filled = input.value
      if (filled === "") return
      setDomFilled(true)
      const { value: current, onChange: handler } = latest.current
      if (current != null && String(current) !== filled) {
        handler?.({ target: input, currentTarget: input } as React.ChangeEvent<HTMLInputElement>)
      }
    }
    syncRef.current = sync
    sync()
    // Chrome can fill after first paint, and again once the page is interacted
    // with, so one read on mount is not enough.
    const timers = [window.setTimeout(sync, 60), window.setTimeout(sync, 300)]
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  const isFloating = focused || hasValue

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        value={value}
        // A single space keeps `:placeholder-shown` meaningful for the CSS
        // float; a real hint only appears once the label is out of the way.
        placeholder={isFloating && placeholder ? placeholder : " "}
        {...props}
        onAnimationStart={(event) => {
          if (event.animationName === AUTOFILL_ANIMATION) syncRef.current()
        }}
        onChange={(event) => {
          setDomFilled(event.target.value !== "")
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
          "eboses-float-input peer box-border h-[60px] w-full rounded-[12px] bg-white pl-[0.7rem] pr-4 pt-[1.75rem] pb-2.5 text-base leading-5 text-neutral-800 outline-none transition-[border-width,border-color]",
          "border-2 border-input focus-visible:border-[3px] focus-visible:border-primary",
          "aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive",
          "shadow-none focus-visible:shadow-none",
          "disabled:cursor-not-allowed disabled:opacity-50",
          prefix && "pl-[calc(0.7rem+2.25rem)]",
          className,
        )}
      />
      {/* Only once the label has floated, or the two would sit on the same line. */}
      {prefix && isFloating ? (
        <span
          aria-hidden
          className="pointer-events-none absolute left-[calc(0.7rem+2px)] top-[calc(1.75rem+2px)] text-base leading-5 text-neutral-800"
        >
          {prefix}
        </span>
      ) : null}
      <label
        htmlFor={id}
        className={cn(
          "pointer-events-none absolute z-[1] overflow-hidden text-ellipsis whitespace-nowrap text-neutral-800 transition-all duration-150 ease-out",
          "left-[calc(0.7rem+2px)] right-[calc(1rem+2px)] peer-focus-visible:left-[calc(0.7rem+3px)] peer-focus-visible:right-[calc(1rem+3px)]",
          "top-1/2 -translate-y-1/2 text-[18px] font-normal leading-5",
          // The CSS fallbacks matter even with the sync above: they float the
          // label on the very first paint after an autofill, before any script
          // has had a chance to read the field.
          "peer-[:not(:placeholder-shown)]:top-2.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-medium peer-[:not(:placeholder-shown)]:leading-[14px]",
          "peer-[:-webkit-autofill]:top-2.5 peer-[:-webkit-autofill]:translate-y-0 peer-[:-webkit-autofill]:text-[11px] peer-[:-webkit-autofill]:font-medium peer-[:-webkit-autofill]:leading-[14px]",
          isFloating &&
            "top-2.5 translate-y-0 text-[11px] font-medium leading-[14px]",
          "peer-aria-invalid:text-destructive",
        )}
      >
        {label}
      </label>
    </div>
  )
}

export { FloatingLabelInput }
