import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

function InputOTP({ className, containerClassName, ...props }: React.ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "flex w-full items-center gap-3 has-disabled:opacity-50",
        containerClassName,
      )}
      className={cn("w-full disabled:cursor-not-allowed", className)}
      inputMode="numeric"
      pattern="[0-9]*"
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn("flex w-full items-center gap-3", className)}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & { index: number }) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const slot = inputOTPContext.slots[index]

  return (
    <div
      data-slot="input-otp-slot"
      data-active={slot.isActive}
      className={cn(
        "border-input bg-white text-foreground ring-offset-background relative flex h-14 min-w-0 flex-1 items-center justify-center border-2 text-lg font-medium outline-none rounded-lg transition-[border-color]",
        "data-[active=true]:border-[3px] data-[active=true]:border-primary",
        className,
      )}
      {...props}
    >
      {slot.char !== null ? (
        <span className="text-inherit">{slot.char}</span>
      ) : slot.placeholderChar ? (
        <span className="text-inherit">{slot.placeholderChar}</span>
      ) : null}
      {slot.hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* Soft caret — avoid heavy black “skeleton” flash in empty slots */}
          <div className="h-5 w-px animate-pulse bg-neutral-400 duration-1000" />
        </div>
      ) : null}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="input-otp-separator" role="separator" {...props}>
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot }
