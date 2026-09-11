import { CircleCheckIcon } from "lucide-react"

import { Dialog, DialogBody } from "@/features/dashboard/components/dialog"

export function SuccessAssignedDialog({
  open,
  onClose,
  unitName,
}: {
  open: boolean
  onClose: () => void
  unitName: string | null
}) {
  return (
    <Dialog open={open} onClose={onClose} maxW="max-w-[420px]">
      <DialogBody className="!flex !flex-col !items-center !justify-center !px-6 !py-10 !text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CircleCheckIcon className="size-8" strokeWidth={2} />
        </span>
        <h2 className="mt-5 text-[18px] font-bold leading-snug text-neutral-900">
          {unitName
            ? `Your submitted report was successfully assigned to ${unitName}`
            : "Your submitted report is in review queue."}
        </h2>
        <p className="mt-2 text-[13px] leading-5 text-neutral-500">
          It is now under review by barangay.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 h-11 w-full rounded-full bg-brand-orange px-6 text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong"
        >
          Continue
        </button>
      </DialogBody>
    </Dialog>
  )
}
