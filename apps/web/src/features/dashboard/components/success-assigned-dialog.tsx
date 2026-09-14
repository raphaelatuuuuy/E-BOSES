import { CircleCheckIcon } from "lucide-react"

import { Dialog, DialogBody } from "@/features/dashboard/components/dialog"

export function SuccessAssignedDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxW="max-w-[420px]"
      mobileSheet
      mobileSheetFitContent
      desktopFitContent
    >
      <DialogBody className="!flex !min-h-0 !flex-none !flex-col !items-center !justify-center !space-y-0 bg-white !px-6 !pt-5 !pb-4 !text-center">
        <CircleCheckIcon
          className="size-16 text-emerald-600"
          strokeWidth={1.8}
          aria-hidden
        />
        <h2 className="mt-3 max-w-[360px] text-[18px] leading-snug font-bold text-neutral-900">
          Your report is successfully submitted and is now under review by
          barangay.
        </h2>
      </DialogBody>
      <div className="w-full shrink-0 bg-white px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onClose}
          className="h-12 w-full rounded-full bg-brand-orange px-6 text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong"
        >
          Continue
        </button>
        <p className="mt-3 text-center text-[13px] leading-snug text-neutral-500">
          Thank you for your cooperation.
        </p>
      </div>
    </Dialog>
  )
}
