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
        "border-input bg-white text-foreground ring-offset-background relative flex h-14 min-w-0 flex-1 items-center justify-center border text-lg font-medium shadow-xs transition-[color,box-shadow] outline-none",
        "data-[active=true]:border-ring data-[active=true]:shadow-[0_0_0_3px_rgba(255,129,51,0.15)]",
        className,
      )}
      {...props}
    >
      {slot.char !== null ? slot.char : slot.placeholderChar}
      {slot.hasFakeCaret ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="bg-foreground h-5 w-px animate-caret-blink duration-1000" />
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
