import { cn } from "@workspace/ui/lib/utils"

/**
 * Logo + wordmark on the form column — mobile / tablet only.
 * On desktop/laptop, branding lives on the left carousel (AuthSidePanel).
 */
export function AuthPageLogo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 px-6 py-4 md:px-12 lg:hidden",
        className,
      )}
    >
      <img src="/contents/logo.png" alt="E-Boses" className="h-9 w-auto md:h-10" />
      <span className="font-heading text-xl font-bold text-[#ff8133] md:text-2xl">Boses</span>
    </div>
  )
}
