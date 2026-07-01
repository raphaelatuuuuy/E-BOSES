import * as React from "react"
import type { VariantProps } from "class-variance-authority"

import { buttonVariants } from "@workspace/ui/components/button-variants"
import { cn } from "@workspace/ui/lib/utils"

function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      type={type}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
