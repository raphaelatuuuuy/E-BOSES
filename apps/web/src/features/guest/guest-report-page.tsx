import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { SuccessAssignedDialog } from "@/features/dashboard/components/success-assigned-dialog"

export default function GuestReportPage() {
  const navigate = useNavigate()
  const [composerOpen, setComposerOpen] = useState(true)
  const [successOpen, setSuccessOpen] = useState(false)

  function closeComposer(open: boolean) {
    setComposerOpen(open)
    if (!open && !successOpen) navigate("/sign-in", { replace: true })
  }

  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      <header className="flex items-center justify-between gap-3 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <Link
          to="/sign-in"
          className="text-[14px] font-semibold text-neutral-600"
        >
          Back
        </Link>
        <h1 className="text-[16px] font-bold text-neutral-900">
          Report as guest
        </h1>
        <Link
          to="/sign-in"
          className="text-[14px] font-semibold text-brand-orange"
        >
          Sign in
        </Link>
      </header>
      <CreateReportDialog
        open={composerOpen}
        onOpenChange={closeComposer}
        guest
        initialLocation={null}
        onGuestSubmitted={() => setSuccessOpen(true)}
      />
      <SuccessAssignedDialog
        open={successOpen}
        onClose={() => navigate("/sign-in", { replace: true })}
      />
    </div>
  )
}
