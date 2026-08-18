import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

/**
 * Logo + wordmark on the form column — mobile / tablet only.
 * On desktop/laptop, branding lives on the left carousel (AuthSidePanel).
 * Clicking it returns to the landing page.
 */
export function AuthPageLogo({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "flex shrink-0 items-center gap-2 px-6 py-4 md:px-12 lg:hidden",
        className,
      )}
      aria-label="Boses — back to landing page"
    >
      <img src="/contents/logo.webp" alt="E-Boses" className="h-9 w-auto md:h-10" />
      <span className="text-2xl font-bold text-accent">Boses</span>
    </Link>
  )
}