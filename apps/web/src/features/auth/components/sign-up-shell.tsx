import { ChevronLeftIcon, LoaderCircleIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

/** Account step keeps the marketing nav; later steps use a compact wizard header. */
export type SignUpShellVariant = "account" | "wizard"

const CONTENT_MAX = "max-w-[600px]"
/** Narrower column for email/password account step only. */
const ACCOUNT_CONTENT_MAX = "max-w-[400px]"

interface SignUpShellProps {
  children: React.ReactNode
  onSignIn?: () => void
  showProgress?: boolean
  progressPercent?: number
  onBack?: () => void
  showBack?: boolean
  /** Full-bleed content (e.g. verified peek with left carousel on desktop). */
  wideContent?: boolean
  /** account = top nav + Sign in; wizard = back + progress only (no logo / Sign in). */
  variant?: SignUpShellVariant
  className?: string
}

export function SignUpShell({
  children,
  onSignIn,
  showProgress = false,
  progressPercent = 0,
  onBack,
  showBack = false,
  wideContent = false,
  variant = "account",
  className,
}: SignUpShellProps) {
  const isWizard = variant === "wizard"
  const contentMax = isWizard ? CONTENT_MAX : ACCOUNT_CONTENT_MAX

  return (
    <main
      className={cn(
        "flex min-h-svh w-full flex-col overflow-x-hidden overflow-y-auto bg-white",
        className,
      )}
    >
      {/* Account step keeps a subtle nav edge; wizard matches Nextdoor (no border). */}
      <div
        className={cn(
          "sticky top-0 z-50 w-full bg-white",
          !isWizard &&
            "border-b border-neutral-200/80 bg-white/95 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] backdrop-blur-sm supports-[backdrop-filter]:bg-white/90",
        )}
      >
        {isWizard ? (
          /*
           * Wizard steps: back control + progress only (no logo / Boses wordmark).
           * Same max-width + padding as the form column so edges align.
           */
          <div className={cn("mx-auto w-full px-5 pt-5 md:px-0 md:pt-6", CONTENT_MAX)}>
            {showBack && onBack ? (
              <header className="relative flex w-full items-center">
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex size-11 items-center justify-center rounded-full text-neutral-800 transition-colors hover:bg-neutral-100"
                  aria-label="Go back"
                >
                  <ChevronLeftIcon className="size-6 stroke-[2]" />
                </button>
              </header>
            ) : null}

            {showProgress ? (
              <div
                className={cn(
                  "w-full pb-5 md:pb-6",
                  showBack && onBack ? "mt-3 md:mt-4" : "mt-1",
                )}
              >
                <div className="h-[5px] w-full overflow-hidden rounded-full bg-orange-100 md:h-[7px]">
                  <div
                    className="h-full rounded-full bg-[#ff8133] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="pb-4" />
            )}
          </div>
        ) : (
          /* First step: full top nav with Sign in */
          <>
            <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-5 py-4 md:px-8">
              <div className="flex items-center gap-2">
                <img src="/contents/logo.png" alt="E-Boses" className="h-9 w-auto md:h-10" />
                <span className="font-heading text-xl font-semibold text-[#ff8133] md:text-2xl">
                  Boses
                </span>
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="rounded-full px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-100"
              >
                Sign in
              </button>
            </header>
            {showProgress ? (
              <div className={cn("mx-auto w-full px-5 pb-3", contentMax, "md:px-0")}>
                <div className="h-[5px] w-full overflow-hidden rounded-full bg-orange-100">
                  <div
                    className="h-full rounded-full bg-[#ff8133] transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                  />
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "flex w-full flex-1 flex-col",
            wideContent
              ? "max-w-none px-0 pb-0 pt-0"
              : cn(
                  // Extra bottom padding so open calendar + Continue can scroll into view
                  "mx-auto px-5 pb-16 md:px-0 md:pb-20",
                  isWizard ? "pt-8 md:pt-10" : "pt-6 md:pt-8",
                  contentMax,
                ),
          )}
        >
          {children}
        </div>
      </div>
    </main>
  )
}

interface StepContinueButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  fullWidth?: boolean
  loading?: boolean
  children: React.ReactNode
}

export function StepContinueButton({
  fullWidth = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: StepContinueButtonProps) {
  return (
    <div className={cn("mt-8 flex", fullWidth ? "w-full" : "w-full justify-end")}>
      <button
        type="button"
        disabled={disabled || loading}
        className={cn(
          "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff8133] px-8 text-base font-semibold text-white shadow-none transition-[transform,colors,filter] duration-150 ease-out hover:bg-[#e6732e] active:scale-[0.96] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading ? (
          <LoaderCircleIcon className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          children
        )}
      </button>
    </div>
  )
}

export function StepTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h1
      className={cn(
        "text-[1.5rem] font-medium leading-tight tracking-tight text-[#0f172a] md:text-[1.75rem]",
        className,
      )}
    >
      {children}
    </h1>
  )
}

export function StepDescription({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn("mt-2 text-sm leading-relaxed text-muted-foreground", className)}>{children}</p>
  )
}
