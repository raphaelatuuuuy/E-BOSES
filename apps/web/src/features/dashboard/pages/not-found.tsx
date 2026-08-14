import { Link } from "react-router-dom"
import { CompassIcon } from "lucide-react"

import { buttonVariants } from "@workspace/ui/components/button"

export default function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-5 bg-canvas px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-pill bg-brand-orange-soft text-brand-orange">
        <CompassIcon className="size-6" strokeWidth={1.75} />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-title text-foreground">This page does not exist</h1>
        <p className="max-w-sm text-body text-subtle-foreground">
          The link may be out of date, or the page may have moved. Nothing you
          submitted was lost.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link to="/dashboard" className={buttonVariants()}>
          Go to dashboard
        </Link>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Back to home
        </Link>
      </div>
    </main>
  )
}
