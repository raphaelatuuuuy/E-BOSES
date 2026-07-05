import { useState } from "react"
import { CheckCircleIcon, CopyIcon, ClockIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogCloseButton,
} from "@/features/dashboard/components/dialog"
import type { Concern } from "@/features/dashboard/api"

const STATUS_DOTS = [
  { key: "submitted", label: "Received", color: "bg-green-500", border: "border-green-500" },
  { key: "under_review", label: "In Review", color: "bg-orange-500", border: "border-orange-500" },
  { key: "in_progress", label: "Assigned", color: "bg-blue-500", border: "border-blue-500" },
  { key: "resolved", label: "Resolved", color: "bg-green-500", border: "border-green-500" },
] as const

export function ReportReceivedDialog({
  open,
  onOpenChange,
  report,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: Concern
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(report.tracking_id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const activeIdx = STATUS_DOTS.findIndex((d) => d.key === report.status)

  function handleClose() {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onClose={handleClose} maxW="max-w-xl" containerClassName="z-[300]">
      <DialogHeader className="border-[#0a1a5e] bg-[#020c4e]">
        <div className="flex items-center justify-between">
          <DialogTitle className="text-white">Report Received</DialogTitle>
          <DialogCloseButton onClose={handleClose} />
        </div>
      </DialogHeader>

      <DialogBody className="flex flex-col items-center px-6 py-8 space-y-6 pb-6 md:pb-6">
        {/* Header image */}
        <div className="flex flex-col items-center gap-3">
          <img src="/contents/report-received.png" alt="" className="w-48 h-auto translate-x-4" />
          <h3 className="text-lg font-bold text-foreground text-center" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>Report is under review...</h3>
          <p className="text-sm text-muted-foreground text-center max-w-xs mx-auto">
            Your report has been received and is being reviewed by the barangay.
          </p>
        </div>

        {/* Tracking card */}
        <div className="w-full rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tracking number</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? <CheckCircleIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-bold text-foreground font-mono tracking-wider">{report.tracking_id || "EB-20260704-XXXX"}</span>
            <Badge variant="outline" className="text-xs shrink-0 border-orange-500 text-orange-600 bg-orange-50">
              <ClockIcon className="size-3 mr-1" />
              In Review
            </Badge>
          </div>

          {/* Status dots */}
          <div className="relative flex items-start justify-between">
            {/* Connecting line — only between dots, not past edges */}
            <div className="absolute left-[18px] right-[18px] h-0.5" style={{ top: "8px", background: "linear-gradient(to right, #22c55e 0%, #f97316 33%, #e5e7eb 33%, #e5e7eb 100%)" }} />
            {STATUS_DOTS.map((dot, idx) => {
              const isActive = idx <= 1
              const isCurrent = idx === 1
              return (
                <div key={dot.key} className="relative flex flex-col items-center z-10">
                  <div
                    className={cn(
                      "size-4 rounded-full border-2 transition-all",
                      isCurrent
                        ? `${dot.key === "under_review" ? "bg-orange-500 border-orange-500" : `${dot.color} ${dot.border}`}`
                        : isActive
                          ? dot.color + " border-transparent"
                          : "bg-gray-200 border-gray-300",
                    )}
                  />
                  <span className={cn(
                    "mt-1.5 text-[10px] font-medium whitespace-nowrap",
                    isActive ? "text-foreground" : "text-gray-400",
                  )}>
                    {dot.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
          >
            Done
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-muted active:scale-[0.98]"
          >
            Track Report
          </button>
        </div>
      </DialogBody>
    </Dialog>
  )
}
